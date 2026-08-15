import { getActiveSkillUse, getPlayer, getPlayableCards, getTargetOptions, requiredDiscards } from "./engine";
import { heroOf } from "./heroes";
import type { DingAiMove, DingCard, DingDifficulty, DingPlayer, DingState, PendingTrick, PlayerId } from "./types";

export interface DingIdentityBelief {
  readonly lord: number;
  readonly loyalist: number;
  readonly rebel: number;
  readonly renegade: number;
}

function exactBelief(identity: DingPlayer["identity"]): DingIdentityBelief {
  return {
    lord: identity === "lord" ? 1 : 0,
    loyalist: identity === "loyalist" ? 1 : 0,
    rebel: identity === "rebel" ? 1 : 0,
    renegade: identity === "renegade" ? 1 : 0,
  };
}

/**
 * 轻量身份信念：只使用观察者自己的身份、公开主君、已揭示身份与
 * 当前公开牌面压力，不读取任何隐藏身份。战术 AI 用它选择目标。
 */
export function identityBelief(
  state: DingState,
  observerId: PlayerId,
  targetId: PlayerId,
): DingIdentityBelief {
  const observer = getPlayer(state.players, observerId);
  const target = getPlayer(state.players, targetId);
  if (target.id === observer.id || target.revealed || !target.alive) return exactBelief(target.identity);

  const pressure = Math.max(0, target.hp / target.maxHp)
    + Math.min(1, target.hand.length / 6)
    + (target.equipment.weapon ? 0.15 : 0);
  const lord = 0;
  let loyalist = pressure * 0.25;
  let rebel = pressure * 0.25;
  let renegade = pressure * 0.25;

  if (observer.identity === "lord" || observer.identity === "loyalist") {
    rebel += 0.4;
    renegade += 0.28;
    loyalist += 0.08;
  } else if (observer.identity === "rebel") {
    loyalist += 0.4;
    renegade += 0.3;
  } else {
    rebel += 0.35;
    loyalist += 0.35;
  }

  const total = lord + loyalist + rebel + renegade;
  return { lord, loyalist: loyalist / total, rebel: rebel / total, renegade: renegade / total };
}

function threatScore(state: DingState, observerId: PlayerId, targetId: PlayerId): number {
  const belief = identityBelief(state, observerId, targetId);
  const observer = getPlayer(state.players, observerId);
  const target = getPlayer(state.players, targetId);
  if (observer.identity === "lord" || observer.identity === "loyalist") {
    return belief.rebel + belief.renegade - belief.loyalist;
  }
  if (observer.identity === "rebel") {
    if (target.revealed && target.identity === "lord") return 10;
    return target.hp + target.hand.length;
  }
  // 流谋的目标顺序：先减少其他非主君存活者，再在只剩主君时收掉主君。
  const lord = state.players.find((player) => player.identity === "lord");
  const otherLiving = state.players.filter((player) => player.alive && player.id !== observer.id);
  const nonLordLiving = otherLiving.filter((player) => player.id !== lord?.id);
  if (target.revealed && target.identity === "lord") {
    return nonLordLiving.length <= 1 ? 10 : -10;
  }
  if (nonLordLiving.length <= 1) return -target.hp;
  return -target.hp - target.hand.length;
}

function tacticalTarget(state: DingState, actorId: PlayerId, options: readonly PlayerId[]): PlayerId | undefined {
  return options
    .map((id) => ({ id, score: threatScore(state, actorId, id) }))
    .sort((left, right) => right.score - left.score
      || getPlayer(state.players, left.id).hp - getPlayer(state.players, right.id).hp
      || left.id.localeCompare(right.id))[0]?.id;
}

const DISCARD_PRIORITY: Readonly<Record<DingCard["type"], number>> = {
  strike: 0,
  dismantle: 1,
  snatch: 2,
  duel: 3,
  horde: 4,
  volley: 5,
  focus: 6,
  aid: 7,
  weapon: 8,
  "minus-horse": 8,
  "plus-horse": 9,
  grove: 10,
  "delay-play": 11,
  "delay-draw": 12,
  "delay-burn": 13,
  nullify: 14,
  evade: 15,
  salve: 16,
};

function cardType(card: DingCard): DingCard["type"] {
  return card.type;
}

function sortForDiscard(cards: readonly DingCard[]): DingCard[] {
  return [...cards].sort((left, right) =>
    DISCARD_PRIORITY[cardType(left)] - DISCARD_PRIORITY[cardType(right)]
    || left.id.localeCompare(right.id),
  );
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

function chooseStrikeTarget(
  state: DingState,
  actorId: PlayerId,
  card: DingCard,
  difficulty: DingDifficulty,
): PlayerId | undefined {
  const actor = getPlayer(state.players, actorId);
  const options = getTargetOptions(state, actorId, card);
  if (options.length === 0) return undefined;
  const useBelief = difficulty !== "relaxed";
  const bestId = useBelief
    ? tacticalTarget(state, actorId, options)
    : weakestTarget(state, options);
  if (!bestId) return undefined;
  const best = getPlayer(state.players, bestId);
  // AI 不读取其他角色的隐藏身份，只按体力和手牌压力施压；残局时
  // 不再囤刺击，避免双方互相回血造成极长拉锯。
  const livingCount = state.players.filter((entry) => entry.alive).length;
  const strikesInHand = actor.hand.filter((entry) => entry.type === "strike").length;
  if (difficulty === "relaxed") {
    return (best.hp <= 2 || livingCount <= 3 || strikesInHand >= 2)
      && (state.revision + actorId.length + bestId.length) % 2 === 0
      ? best.id
      : undefined;
  }
  const pressure = best.hp <= 2 || strikesInHand >= 2 || livingCount <= 3
    || (difficulty === "standard" && (actor.hand.length >= 4 || actor.hp >= 3))
    || (difficulty === "tactician" && actor.hand.length >= 3);
  return pressure ? best.id : undefined;
}

export function chooseAiMove(
  state: DingState,
  actorId: PlayerId,
  difficulty: DingDifficulty = state.difficulty,
): DingAiMove {
  const actor = getPlayer(state.players, actorId);
  if (state.status !== "playing" || state.phase !== "play" || state.stack.length > 0 || state.activePlayerId !== actorId) return { kind: "end" };
  const playable = getPlayableCards(state, actorId);
  const useBelief = difficulty !== "relaxed";

  const skillUse = getActiveSkillUse(state, actorId);
  if (skillUse) {
    const { skill } = skillUse;
    if (difficulty === "relaxed") {
      if (skill.cost.kind === "none") return { kind: "skill", skillId: skill.id };
      if (skill.target === "wounded" && actor.hp < actor.maxHp) return { kind: "skill", skillId: skill.id };
    } else if (skill.target === "wounded") {
      const lord = state.players.find((player) => player.identity === "lord");
      const canHelpLord = actor.identity === "lord" || actor.identity === "loyalist";
      const selfWounded = actor.hp < actor.maxHp;
      const lordWounded = Boolean(lord?.alive && lord.hp < lord.maxHp);
      if (selfWounded || (canHelpLord && lordWounded)) {
        return { kind: "skill", skillId: skill.id };
      }
    } else if (skill.cost.kind === "none") {
      return { kind: "skill", skillId: skill.id };
    } else if (skill.effect.kind === "draw") {
      if (actor.hand.length <= 5) return { kind: "skill", skillId: skill.id };
    } else if (skill.effect.kind === "buff") {
      const enemiesAlive = state.players.some((player) => player.id !== actor.id && player.alive);
      if (skill.id === "pojun") {
        if (actor.hand.filter((card) => card.type === "strike").length >= 2) return { kind: "skill", skillId: skill.id };
      } else if (skill.id === "jianbi") {
        if (actor.hp <= 3 || actor.hand.length >= 4) return { kind: "skill", skillId: skill.id };
      } else if (enemiesAlive && actor.hand.length >= 3) {
        return { kind: "skill", skillId: skill.id };
      }
    }
  }

  const salve = playable.find((card) => card.type === "salve" && actor.hp < actor.maxHp);
  if (salve) return { kind: "play", cardUid: salve.id, targetId: actor.id };

  const aid = playable.find((card) => card.type === "aid");
  if (aid) {
    const options = getTargetOptions(state, actorId, aid);
    const lord = state.players.find((player) => player.identity === "lord");
    const canHelpLord = actor.identity === "lord" || actor.identity === "loyalist";
    const targetId = options.includes(actor.id)
      ? actor.id
      : canHelpLord && lord && options.includes(lord.id)
        ? lord.id
        : options[0];
    if (targetId) return { kind: "play", cardUid: aid.id, targetId };
  }

  const focus = playable.find((card) => card.type === "focus");
  if (focus && actor.hand.length <= 5) return { kind: "play", cardUid: focus.id, targetId: actor.id };

  const grove = playable.find((card) => card.type === "grove");
  if (grove) {
    const lord = state.players.find((player) => player.identity === "lord");
    const canHelpLord = actor.identity === "lord" || actor.identity === "loyalist";
    const lordWounded = Boolean(lord?.alive && lord.hp < lord.maxHp);
    if (actor.hp < actor.maxHp || (canHelpLord && lordWounded)) {
      return { kind: "play", cardUid: grove.id, targetId: actor.id };
    }
  }

  const equipment = playable.find((card) => card.type === "weapon" || card.type === "minus-horse" || card.type === "plus-horse");
  if (equipment) return { kind: "play", cardUid: equipment.id, targetId: actor.id };

  const duel = playable.find((card) => card.type === "duel");
  if (duel) {
    const options = getTargetOptions(state, actorId, duel);
    const targetId = useBelief
      ? tacticalTarget(state, actorId, options)
      : weakestTarget(state, options);
    const target = targetId ? getPlayer(state.players, targetId) : undefined;
    const strikesInHand = actor.hand.filter((card) => card.type === "strike").length;
    if (target && (target.hp <= 2 || strikesInHand >= 2 || difficulty === "tactician")) {
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
    const targetId = useBelief
      ? tacticalTarget(state, actorId, options)
      : options.find((id) => getPlayer(state.players, id).hand.length >= 3) ?? options[0];
    if (targetId) return { kind: "play", cardUid: dismantle.id, targetId };
  }

  const snatch = playable.find((card) => card.type === "snatch");
  if (snatch) {
    const options = getTargetOptions(state, actorId, snatch);
    const targetId = useBelief
      ? tacticalTarget(state, actorId, options)
      : options[0];
    if (targetId) return { kind: "play", cardUid: snatch.id, targetId };
  }

  const delayed = playable.find((card) => card.type === "delay-play" || card.type === "delay-draw" || card.type === "delay-burn");
  if (delayed) {
    const options = getTargetOptions(state, actorId, delayed);
    const targetId = useBelief
      ? tacticalTarget(state, actorId, options)
      : options[0];
    if (targetId) return { kind: "play", cardUid: delayed.id, targetId };
  }

  const strike = playable.find((card) => card.type === "strike");
  if (strike) {
    const targetId = chooseStrikeTarget(state, actorId, strike, difficulty);
    if (targetId) return { kind: "play", cardUid: strike.id, targetId };
  }

  return { kind: "end" };
}

export function chooseAiStrikeResponse(
  state: DingState,
  responderId: PlayerId,
  difficulty: DingDifficulty = state.difficulty,
): string | undefined {
  const responder = getPlayer(state.players, responderId);
  const evade = responder.hand.find((card) => card.type === "evade");
  if (!evade) return undefined;
  if (responder.hp <= 1) return evade.id;
  if (difficulty === "tactician") return responder.hp <= 2 ? evade.id : undefined;
  if (difficulty === "relaxed") return (state.revision + responderId.length) % 3 === 0 ? evade.id : undefined;
  const deterministic = (state.revision + responderId.length) % 4 === 0;
  return deterministic ? evade.id : undefined;
}

export function chooseAiDyingResponse(state: DingState, responderId: PlayerId): string | undefined {
  const responder = getPlayer(state.players, responderId);
  return responder.hand.find((card) => card.type === "salve")?.id;
}

export function chooseAiDuelResponse(
  state: DingState,
  responderId: PlayerId,
  difficulty: DingDifficulty = state.difficulty,
): string | undefined {
  const responder = getPlayer(state.players, responderId);
  const strike = responder.hand.find((card) => card.type === "strike");
  if (!strike) return undefined;
  if (difficulty === "relaxed" && responder.hand.length <= 2) return undefined;
  return strike.id;
}

export function chooseAiHordeResponse(
  state: DingState,
  responderId: PlayerId,
  difficulty: DingDifficulty = state.difficulty,
): string | undefined {
  const responder = getPlayer(state.players, responderId);
  const strike = responder.hand.find((card) => card.type === "strike");
  if (!strike) return undefined;
  if (difficulty === "tactician") return responder.hp <= 3 || responder.hand.length >= 3 ? strike.id : undefined;
  if (difficulty === "relaxed") return responder.hp <= 1 ? strike.id : undefined;
  // 有富余时保留刺击也没意义：合围只消耗一张，挨一下通常更亏。
  if (responder.hp <= 2 || responder.hand.length >= 4) return strike.id;
  const deterministic = (state.revision + responderId.length) % 3 === 0;
  return deterministic ? strike.id : undefined;
}

export function chooseAiVolleyResponse(
  state: DingState,
  responderId: PlayerId,
  difficulty: DingDifficulty = state.difficulty,
): string | undefined {
  return chooseAiStrikeResponse(state, responderId, difficulty);
}

/** 选择主动技消耗与目标。当前所有主动技只使用公开信息与自身阵营判断。 */
export function chooseAiSkillDecision(
  state: DingState,
  responderId: PlayerId,
): { readonly cardUid?: string; readonly targetId?: PlayerId } | undefined {
  const pending = state.stack.at(-1);
  if (!pending || pending.kind !== "skill" || pending.ownerId !== responderId) return undefined;
  const owner = getPlayer(state.players, responderId);
  const skill = heroOf(owner)?.activeSkill;
  if (!skill || skill.id !== pending.skillId) return undefined;

  const chooseCost = () => {
    if (skill.cost.kind === "none") return undefined;
    const filter = skill.cost.kind === "discard" ? skill.cost.filter : undefined;
    return sortForDiscard(owner.hand.filter((card) => {
      if (filter === "strike") return card.type === "strike";
      if (filter === "evade") return card.type === "evade";
      if (filter === "trick") return card.kind === "trick";
      return true;
    }))[0];
  };

  if (skill.target === "self") {
    const costCard = chooseCost();
    if (skill.cost.kind === "discard" && !costCard) return undefined;
    return costCard ? { cardUid: costCard.id } : {};
  }

  const costCard = chooseCost();
  if (!costCard) return undefined;
  const targetIds = [...pending.targetIds];
  const self = targetIds.find((id) => id === owner.id);
  if (self) return { cardUid: costCard.id, targetId: self };

  const lord = state.players.find((player) => player.identity === "lord");
  if ((owner.identity === "lord" || owner.identity === "loyalist")
    && lord && targetIds.includes(lord.id)) {
    return { cardUid: costCard.id, targetId: lord.id };
  }

  const target = targetIds
    .map((id) => getPlayer(state.players, id))
    .sort((left, right) => left.hp - right.hp || left.hand.length - right.hand.length || left.seat - right.seat)[0];
  return target ? { cardUid: costCard.id, targetId: target.id } : undefined;
}

/**
 * M1 AI 的无懈可击决策仍然只使用公开信息：自己的身份、公开的主君、
 * 以及锦囊是否指向自己。它保护自己的锦囊与目标，也按阵营保护/干扰公开主君。
 */
export function chooseAiNullifyResponse(
  state: DingState,
  responderId: PlayerId,
  difficulty: DingDifficulty = state.difficulty,
): string | undefined {
  const top = topTrickFrame(state);
  if (!top || !top.awaitingResponse) return undefined;
  const responder = getPlayer(state.players, responderId);
  const nullify = responder.hand.find((card) => card.type === "nullify");
  if (!nullify) return undefined;

  if (difficulty === "relaxed" && top.cardType !== "nullify" && top.targetId !== responderId) return undefined;

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
  return sortForDiscard(actor.hand)
    .slice(0, required)
    .map((card) => card.id);
}
