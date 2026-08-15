import { getPlayer, getPlayableCards, getTargetOptions, requiredDiscards } from "./engine";
import type { DingCard, DingState, PlayerId } from "./types";

function cardType(card: DingCard): DingCard["type"] {
  return card.type;
}

function chooseStrikeTarget(state: DingState, actorId: PlayerId, card: DingCard): PlayerId | undefined {
  const actor = getPlayer(state.players, actorId);
  const options = getTargetOptions(state, actorId, card);
  if (options.length === 0) return undefined;
  const targets = options
    .map((id) => getPlayer(state.players, id))
    .sort((left, right) =>
      left.hp - right.hp
      || left.hand.length - right.hand.length
      || left.seat - right.seat,
    );
  const best = targets[0];
  // M0 AI 不读取隐藏身份；只按体力和手牌压力施压。
  const pressure = best.hp <= 2 || actor.hand.length >= 6;
  return pressure ? best.id : undefined;
}

export function chooseAiMove(state: DingState, actorId: PlayerId): { kind: "play"; cardUid: string; targetId?: PlayerId } | { kind: "end" } {
  const actor = getPlayer(state.players, actorId);
  if (state.status !== "playing" || state.phase !== "play" || state.pending || state.activePlayerId !== actorId) return { kind: "end" };
  const playable = getPlayableCards(state, actorId);

  const salve = playable.find((card) => card.type === "salve" && actor.hp < actor.maxHp);
  if (salve) return { kind: "play", cardUid: salve.id, targetId: actor.id };

  const focus = playable.find((card) => card.type === "focus");
  if (focus && actor.hand.length <= 5) return { kind: "play", cardUid: focus.id, targetId: actor.id };

  const equipment = playable.find((card) => card.type === "weapon" || card.type === "minus-horse" || card.type === "plus-horse");
  if (equipment) return { kind: "play", cardUid: equipment.id, targetId: actor.id };

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

export function chooseAiDiscards(state: DingState, actorId: PlayerId): string[] {
  const actor = getPlayer(state.players, actorId);
  const required = requiredDiscards(state, actorId);
  if (required <= 0) return [];
  const priority: Record<DingCard["type"], number> = {
    strike: 0,
    dismantle: 1,
    snatch: 2,
    focus: 3,
    weapon: 4,
    "minus-horse": 5,
    "plus-horse": 6,
    evade: 7,
    salve: 8,
  };
  return [...actor.hand]
    .sort((left, right) => priority[cardType(left)] - priority[cardType(right)] || left.id.localeCompare(right.id))
    .slice(0, required)
    .map((card) => card.id);
}
