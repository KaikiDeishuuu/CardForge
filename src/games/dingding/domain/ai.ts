import { getPlayer, getPlayableCards, getTargetOptions, requiredDiscards } from "./engine";
import type { DingCard, DingState, PendingTrick, PlayerId } from "./types";

function cardType(card: DingCard): DingCard["type"] {
  return card.type;
}

function topTrickFrame(state: DingState): PendingTrick | undefined {
  const top = state.stack.at(-1);
  return top?.kind === "trick" ? top : undefined;
}

function weakestTarget(state: DingState, options: readonly PlayerId[]): PlayerId | undefined {
  return options
    .map((id) => getPlayer(state.players, id))
    .sort((left, right) =>
      left.hp - right.hp
      || left.hand.length - right.hand.length
      || left.seat - right.seat,
    )[0]?.id;
}

function chooseStrikeTarget(state: DingState, actorId: PlayerId, card: DingCard): PlayerId | undefined {
  const actor = getPlayer(state.players, actorId);
  const options = getTargetOptions(state, actorId, card);
  if (options.length === 0) return undefined;
  const bestId = weakestTarget(state, options);
  if (!bestId) return undefined;
  const best = getPlayer(state.players, bestId);
  // 技能框架落地前，AI 不读取其他角色的隐藏身份；只按体力和手牌压力施压。
  const strikesInHand = actor.hand.filter((entry) => entry.type === "strike").length;
  const pressure = best.hp <= 2 || actor.hand.length >= 5 || strikesInHand >= 2;
  return pressure ? best.id : undefined;
}

export function chooseAiMove(state: DingState, actorId: PlayerId): { kind: "play"; cardUid: string; targetId?: PlayerId } | { kind: "end" } {
  const actor = getPlayer(state.players, actorId);
  if (state.status !== "playing" || state.phase !== "play" || state.stack.length > 0 || state.activePlayerId !== actorId) return { kind: "end" };
  const playable = getPlayableCards(state, actorId);

  const salve = playable.find((card) => card.type === "salve" && actor.hp < actor.maxHp);
  if (salve) return { kind: "play", cardUid: salve.id, targetId: actor.id };

  const focus = playable.find((card) => card.type === "focus");
  if (focus && actor.hand.length <= 5) return { kind: "play", cardUid: focus.id, targetId: actor.id };

  const grove = playable.find((card) => card.type === "grove");
  if (grove && actor.hp < actor.maxHp) return { kind: "play", cardUid: grove.id, targetId: actor.id };

  const equipment = playable.find((card) => card.type === "weapon" || card.type === "minus-horse" || card.type === "plus-horse");
  if (equipment) return { kind: "play", cardUid: equipment.id, targetId: actor.id };

  const duel = playable.find((card) => card.type === "duel");
  if (duel) {
    const targetId = weakestTarget(state, getTargetOptions(state, actorId, duel));
    const target = targetId ? getPlayer(state.players, targetId) : undefined;
    const strikesInHand = actor.hand.filter((card) => card.type === "strike").length;
    if (target && (target.hp <= 2 || strikesInHand >= 2)) {
      return { kind: "play", cardUid: duel.id, targetId: target.id };
    }
  }

  // 叛锋与流谋更愿意把局面搅乱；主君方不使用无差别群体牌。
  if (actor.identity === "rebel" || actor.identity === "renegade") {
    const othersAlive = state.players.filter((player) => player.id !== actor.id && player.alive);
    if (othersAlive.length >= 2) {
      const horde = playable.find((card) => card.type === "horde");
      if (horde) return { kind: "play", cardUid: horde.id, targetId: actor.id };
      const volley = playable.find((card) => card.type === "volley");
      if (volley) return { kind: "play", cardUid: volley.id, targetId: actor.id };
    }
  }

  const dismantle = playable.find((card) => card.type === "dismantle");
  if (dismantle) {
    const options = getTargetOptions(state, actorId, dismantle);
    const targetId = options.find((id) => getPlayer(state.players, id).hand.length >= 3) ?? options[0];
    if (targetId) return { kind: "play", cardUid: dismantle.id, targetId };
  }

  const snatch = playable.find((card) => card.type === "snatch");
  if (snatch) {
    const options = getTargetOptions(state, actorId, snatch);
    const targetId = options[0];
    if (targetId) return { kind: "play", cardUid: snatch.id, targetId };
  }

  const strike = playable.find((card) => card.type === "strike");
  if (strike) {
    const targetId = chooseStrikeTarget(state, actorId, strike);
    if (targetId) return { kind: "play", cardUid: strike.id, targetId };
  }

  return { kind: "end" };
}

export function chooseAiStrikeResponse(state: DingState, responderId: PlayerId): string | undefined {
  const responder = getPlayer(state.players, responderId);
  const evade = responder.hand.find((card) => card.type === "evade");
  if (!evade) return undefined;
  if (responder.hp <= 1) return evade.id;
  const deterministic = (state.revision + responderId.length) % 4 === 0;
  return deterministic ? evade.id : undefined;
}

export function chooseAiDyingResponse(state: DingState, responderId: PlayerId): string | undefined {
  const responder = getPlayer(state.players, responderId);
  return responder.hand.find((card) => card.type === "salve")?.id;
}

export function chooseAiDuelResponse(state: DingState, responderId: PlayerId): string | undefined {
  const responder = getPlayer(state.players, responderId);
  return responder.hand.find((card) => card.type === "strike")?.id;
}

export function chooseAiHordeResponse(state: DingState, responderId: PlayerId): string | undefined {
  const responder = getPlayer(state.players, responderId);
  const strike = responder.hand.find((card) => card.type === "strike");
  if (!strike) return undefined;
  // 有富余时保留刺击也没意义：合围只消耗一张，挨一下通常更亏。
  if (responder.hp <= 2 || responder.hand.length >= 4) return strike.id;
  const deterministic = (state.revision + responderId.length) % 3 === 0;
  return deterministic ? strike.id : undefined;
}

export function chooseAiVolleyResponse(state: DingState, responderId: PlayerId): string | undefined {
  return chooseAiStrikeResponse(state, responderId);
}

/**
 * M1 AI 的无懈可击决策仍然只使用公开信息：自己的身份、公开的主君、
 * 以及锦囊是否指向自己。它保护自己的锦囊与目标，也按阵营保护/干扰公开主君。
 */
export function chooseAiNullifyResponse(state: DingState, responderId: PlayerId): string | undefined {
  const top = topTrickFrame(state);
  if (!top || !top.awaitingResponse) return undefined;
  const responder = getPlayer(state.players, responderId);
  const nullify = responder.hand.find((card) => card.type === "nullify");
  if (!nullify) return undefined;

  if (top.cardType === "nullify") {
    const target = state.stack.find((entry) => entry.kind === "trick" && entry.frameId === top.counterFrameId);
    if (!target || target.kind !== "trick") return undefined;
    // 反制链：只保护自己使用的锦囊；别人抵消落向自己的牌是好事，不必反制。
    return target.actorId === responderId ? nullify.id : undefined;
  }

  // 指向自己的拆解/牵袭/约斗：直接抵消。
  if (top.targetId === responderId) return nullify.id;

  if (top.cardType === "focus") {
    const actor = getPlayer(state.players, top.actorId);
    if (actor.revealed && actor.identity === "lord" && (responder.identity === "rebel" || responder.identity === "renegade")) {
      return nullify.id;
    }
    return undefined;
  }

  // 主君方保护公开主君；叛锋/流谋不替主君挡指向性锦囊。
  if (responder.identity === "loyalist" || responder.identity === "lord") {
    const target = top.targetId ? getPlayer(state.players, top.targetId) : undefined;
    if (target?.revealed && target.identity === "lord") return nullify.id;
  }
  return undefined;
}

export function chooseAiDiscards(state: DingState, actorId: PlayerId): string[] {
  const actor = getPlayer(state.players, actorId);
  const required = requiredDiscards(state, actorId);
  if (required <= 0) return [];
  const priority: Record<DingCard["type"], number> = {
    strike: 0,
    dismantle: 1,
    snatch: 2,
    duel: 3,
    horde: 4,
    volley: 5,
    focus: 6,
    weapon: 7,
    "minus-horse": 8,
    "plus-horse": 9,
    grove: 10,
    nullify: 11,
    evade: 12,
    salve: 13,
  };
  return [...actor.hand]
    .sort((left, right) => priority[cardType(left)] - priority[cardType(right)] || left.id.localeCompare(right.id))
    .slice(0, required)
    .map((card) => card.id);
}
