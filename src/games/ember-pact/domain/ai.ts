import { CARD_CATALOG } from "./data";
import {
  declineResponse,
  enumerateLegalMoves,
  getCard,
  getCombatant,
  getResponseCards,
  HAND_LIMIT,
  hasStatus,
  playCard,
  respondToAttack,
} from "./engine";
import type { AiMove, Combatant, Difficulty, EmberPactState, StatusId } from "./types";

function statusCount(combatants: readonly Combatant[], team: Combatant["team"], statusId: StatusId): number {
  return combatants.filter((combatant) =>
    combatant.team === team && combatant.hp > 0 && hasStatus(combatant, statusId)
  ).length;
}

function predictedIncomingDamage(state: EmberPactState): number {
  const pending = state.pendingAttack;
  if (!pending) return 0;
  const actor = getCombatant(state, pending.actorId);
  const target = getCombatant(state, pending.targetId);
  const card = CARD_CATALOG[pending.definitionId];
  if (!actor || !target || !card) return 0;
  const damageEffect = card.effects.find((effect) => effect.kind === "damage" && effect.target === "chosen");
  let amount = damageEffect?.kind === "damage" ? damageEffect.amount : 0;
  if (hasStatus(actor, "tempered")) amount += 2;
  if (hasStatus(target, "exposed")) amount += 2;
  if (actor.passiveId === "siegebreaker" && target.block > 0) amount += 1;
  if (actor.passiveId === "firehunt" && hasStatus(target, "burning")) amount += 2;
  return Math.max(0, amount - target.block);
}

/** Returns a response card id, or undefined when preserving the card is worth the risk. */
export function chooseAiResponse(
  state: EmberPactState,
  responderId: string,
  difficulty: Difficulty = "standard",
): string | undefined {
  const responder = getCombatant(state, responderId);
  const cards = [...getResponseCards(state, responderId)]
    .sort((left, right) => (getCard(left).responsePower ?? 0) - (getCard(right).responsePower ?? 0));
  if (!responder || cards.length === 0) return undefined;
  const incoming = predictedIncomingDamage(state);
  const lethal = incoming >= responder.hp;
  if (lethal) {
    return cards.find((card) => {
      const remaining = Math.max(0, incoming - (getCard(card).responsePower ?? 0));
      return remaining < responder.hp;
    })?.uid;
  }
  if (difficulty === "novice") {
    return (state.revision + responderId.length) % 2 === 0 ? cards[0].uid : undefined;
  }
  if (difficulty === "tactician") return incoming >= 2 ? cards[0].uid : undefined;
  return incoming >= 3 && (responder.hp <= responder.maxHp * 0.7 || responder.hand.length >= 4)
    ? cards[0].uid
    : undefined;
}

function settleSimulatedResponse(state: EmberPactState): EmberPactState {
  const responderId = state.pendingAttack?.targetId;
  if (!responderId) return state;
  const response = chooseAiResponse(state, responderId, "standard");
  return response ? respondToAttack(state, responderId, response) : declineResponse(state, responderId);
}

export function scoreMove(state: EmberPactState, actorId: string, move: AiMove): number {
  const actor = getCombatant(state, actorId);
  if (!actor) return Number.NEGATIVE_INFINITY;
  let result = playCard(state, actorId, move.cardUid, move.targetId);
  if (result === state) return Number.NEGATIVE_INFINITY;
  if (result.phase === "response") result = settleSimulatedResponse(result);
  if (result.winner === actor.team) return 100_000;
  if (result.winner && result.winner !== actor.team && result.winner !== "draw") return -100_000;

  const enemyTeam = actor.team === "dawn" ? "dusk" : "dawn";
  let score = 0;
  for (const before of state.combatants) {
    const after = result.combatants.find((combatant) => combatant.id === before.id)!;
    const damage = before.hp - after.hp;
    const healing = after.hp - before.hp;
    const blockGain = after.block - before.block;
    const blockLost = before.block - after.block;
    const isAlly = before.team === actor.team;

    if (damage > 0) score += isAlly ? damage * -30 : damage * 25;
    if (healing > 0) score += isAlly ? healing * 13 : healing * -24;
    if (blockGain > 0) score += isAlly ? blockGain * 4 : blockGain * -6;
    if (blockLost > 0) score += isAlly ? blockLost * -8 : blockLost * 6;
    if (before.hp > 0 && after.hp === 0) score += isAlly ? -1_000 : 1_000;
    if (before.hp === 0 && after.hp > 0) score += isAlly ? 900 : -900;
    if (isAlly && healing > 0 && before.hp / before.maxHp < 0.35) score += 30;
  }

  const harmfulBefore = statusCount(state.combatants, enemyTeam, "exposed")
    + statusCount(state.combatants, enemyTeam, "burning");
  const harmfulAfter = statusCount(result.combatants, enemyTeam, "exposed")
    + statusCount(result.combatants, enemyTeam, "burning");
  const allyHarmBefore = statusCount(state.combatants, actor.team, "exposed")
    + statusCount(state.combatants, actor.team, "burning");
  const allyHarmAfter = statusCount(result.combatants, actor.team, "exposed")
    + statusCount(result.combatants, actor.team, "burning");
  const temperedBefore = statusCount(state.combatants, actor.team, "tempered");
  const temperedAfter = statusCount(result.combatants, actor.team, "tempered");

  score += (harmfulAfter - harmfulBefore) * 28;
  score += (allyHarmBefore - allyHarmAfter) * 35;
  score += (temperedAfter - temperedBefore) * 18;

  const instance = actor.hand.find((card) => card.uid === move.cardUid);
  const card = instance ? getCard(instance) : undefined;
  const heldResponses = actor.hand.filter((candidate) => (getCard(candidate)?.responsePower ?? 0) > 0).length;
  if (card?.responsePower) {
    score -= heldResponses <= 1 ? (actor.hp <= actor.maxHp * 0.65 ? 42 : 26) : 12;
  }

  // A defended attack still traded one enemy response card for the attack.
  // Without this value the one-ply AI incorrectly treats pressure as zero and
  // both teams hoard shields until overheat decides the table.
  const beforeEnemyCards = state.combatants
    .filter((combatant) => combatant.team !== actor.team)
    .reduce((sum, combatant) => sum + combatant.hand.length, 0);
  const afterEnemyCards = result.combatants
    .filter((combatant) => combatant.team !== actor.team)
    .reduce((sum, combatant) => sum + combatant.hand.length, 0);
  score += Math.max(0, beforeEnemyCards - afterEnemyCards) * 30;

  const target = getCombatant(state, move.targetId);
  if (target && target.team !== actor.team) {
    score += Math.max(0, 8 - target.hp);
    if (actor.passiveId === "firehunt" && hasStatus(target, "burning")) score += 14;
  }
  if (result.lastAction?.events.some((event) => event.combo)) score += 24;
  return score;
}

function tacticianBonus(state: EmberPactState, actorId: string, move: AiMove): number {
  const actor = getCombatant(state, actorId);
  const target = getCombatant(state, move.targetId);
  const instance = actor?.hand.find((card) => card.uid === move.cardUid);
  if (!actor || !target || !instance) return 0;
  const card = getCard(instance);
  let bonus = 0;
  if (target.team !== actor.team) {
    const livingEnemies = state.combatants.filter((candidate) => candidate.team !== actor.team && candidate.hp > 0);
    const focus = [...livingEnemies].sort((left, right) => left.hp - right.hp)[0];
    if (focus?.id === target.id) bonus += 12;
  }
  if (card.effects.some((effect) => effect.kind === "apply-status" && effect.status === "exposed")) bonus += 8;
  if (card.cost === 2 && state.actionsRemaining === 2) bonus -= 2;
  return bonus;
}

function rankedMoves(
  state: EmberPactState,
  actorId: string,
  difficulty: Difficulty,
): readonly { move: AiMove; score: number }[] {
  return enumerateLegalMoves(state, actorId)
    .map((move) => ({
      move,
      score: scoreMove(state, actorId, move)
        + (difficulty === "tactician" ? tacticianBonus(state, actorId, move) : 0),
    }))
    .sort((left, right) => right.score - left.score || left.move.cardUid.localeCompare(right.move.cardUid));
}

function spendsLastResponseCard(state: EmberPactState, actorId: string, move: AiMove): boolean {
  const actor = getCombatant(state, actorId);
  if (!actor) return false;
  const instance = actor.hand.find((card) => card.uid === move.cardUid);
  if (!instance || (getCard(instance).responsePower ?? 0) <= 0) return false;
  return actor.hand.filter((card) => (getCard(card).responsePower ?? 0) > 0).length <= 1;
}

function movesPreferredToEndingTurn(
  state: EmberPactState,
  actorId: string,
  ranked: readonly { move: AiMove; score: number }[],
): readonly { move: AiMove; score: number }[] {
  const worthwhile = ranked.filter((candidate) => candidate.score > 0);
  if (worthwhile.length > 0) return worthwhile;

  const actor = getCombatant(state, actorId);
  if (!actor || actor.hand.length < HAND_LIMIT) return [];

  // A full hand must cycle eventually or every future draw will overflow. Even
  // then, keep the final response card when another legal card can be cycled.
  return ranked.filter((candidate) => !spendsLastResponseCard(state, actorId, candidate.move));
}

function chooseRankedMove(
  state: EmberPactState,
  actorId: string,
  difficulty: Difficulty,
): AiMove | undefined {
  const candidates = movesPreferredToEndingTurn(state, actorId, rankedMoves(state, actorId, difficulty));
  if (candidates.length === 0) return undefined;
  if (difficulty !== "novice") return candidates[0].move;
  const pool = candidates.slice(0, 3);
  return pool[(state.rngSeed + state.revision + actorId.length) % pool.length].move;
}

export function chooseBestMove(state: EmberPactState, actorId: string): AiMove | undefined {
  return chooseRankedMove(state, actorId, "standard");
}

export function chooseAiMove(
  state: EmberPactState,
  actorId: string,
  difficulty: Difficulty = state.difficulty,
): AiMove | undefined {
  const actor = getCombatant(state, actorId);
  if (!actor || actor.controller !== "ai" || actor.hp <= 0 || state.phase !== "action") return undefined;
  return chooseRankedMove(state, actorId, difficulty);
}
