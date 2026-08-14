import { enumerateLegalMoves, getCombatant, hasStatus, playCard } from "./engine";
import type { AiMove, Combatant, EmberPactState, StatusId } from "./types";

function statusCount(combatants: readonly Combatant[], team: Combatant["team"], statusId: StatusId): number {
  return combatants.filter((combatant) =>
    combatant.team === team && combatant.hp > 0 && hasStatus(combatant, statusId)
  ).length;
}

export function scoreMove(state: EmberPactState, actorId: string, move: AiMove): number {
  const actor = getCombatant(state, actorId);
  if (!actor) return Number.NEGATIVE_INFINITY;
  const result = playCard(state, actorId, move.cardUid, move.targetId);
  if (result === state) return Number.NEGATIVE_INFINITY;
  if (result.winner === actor.team) return 100_000;
  if (result.winner && result.winner !== actor.team) return -100_000;

  const enemyTeam = actor.team === "dawn" ? "dusk" : "dawn";
  let score = 0;
  for (const before of state.combatants) {
    const after = result.combatants.find((combatant) => combatant.id === before.id)!;
    const damage = before.hp - after.hp;
    const healing = after.hp - before.hp;
    const blockGain = after.block - before.block;
    const isAlly = before.team === actor.team;

    if (damage > 0) score += isAlly ? damage * -24 : damage * 18;
    if (healing > 0) score += isAlly ? healing * 17 : healing * -20;
    if (blockGain > 0) score += isAlly ? blockGain * 5 : blockGain * -5;
    if (before.hp > 0 && after.hp === 0) score += isAlly ? -800 : 800;
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

  score += (harmfulAfter - harmfulBefore) * 22;
  score += (allyHarmBefore - allyHarmAfter) * 30;
  score += (temperedAfter - temperedBefore) * 14;

  if (actor.passiveId === "afterglow") score += Math.max(0, allyHarmBefore - allyHarmAfter) * 4;
  if (actor.passiveId === "siegebreaker") score += result.lastAction?.events.some((event) => event.kind === "damage") ? 5 : 0;
  if (actor.passiveId === "firehunt") {
    const target = getCombatant(state, move.targetId);
    if (target && hasStatus(target, "burning")) score += 10;
  }

  return score;
}

export function chooseBestMove(state: EmberPactState, actorId: string): AiMove | undefined {
  const moves = enumerateLegalMoves(state, actorId);
  let bestMove: AiMove | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const move of moves) {
    const score = scoreMove(state, actorId, move);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

export function chooseAiMove(state: EmberPactState, actorId: string): AiMove | undefined {
  const actor = getCombatant(state, actorId);
  if (!actor || actor.controller !== "ai" || actor.hp <= 0) return undefined;
  return chooseBestMove(state, actorId);
}
