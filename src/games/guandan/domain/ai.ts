import { generateLegalCombos, getPlayer } from "./engine";
import type { AiMove, CardCombo, GuandanState, PlayerId } from "./types";

function comboScore(combo: CardCombo, leading: boolean, handSize: number): number {
  if (combo.cards.length === handSize) return -100_000;
  const bombPenalty = combo.type === "bomb" ? 10_000 : 0;
  return leading
    ? bombPenalty - combo.cards.length * 100 + combo.power
    : bombPenalty + combo.power * 10 + combo.cards.length;
}

export function chooseAiMove(state: GuandanState, actorId: PlayerId): AiMove | undefined {
  if (state.status !== "playing" || state.activePlayerId !== actorId) return undefined;
  const actor = getPlayer(state, actorId);

  if (state.trick) {
    const trickActor = getPlayer(state, state.trick.actorId);
    if (trickActor.team === actor.team) return { kind: "pass" };
  }

  const candidates = generateLegalCombos(state, actorId)
    .sort((left, right) => comboScore(left, !state.trick, actor.hand.length) - comboScore(right, !state.trick, actor.hand.length));
  const choice = candidates[0];
  return choice ? { kind: "play", cardIds: choice.cards.map((card) => card.id) } : { kind: "pass" };
}
