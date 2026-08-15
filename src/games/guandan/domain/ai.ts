import { generateLegalCombos, getPlayer, isWild } from "./engine";
import type { AiMove, CardCombo, GuandanDifficulty, GuandanState, PlayerId } from "./types";

function comboScore(combo: CardCombo, leading: boolean, handSize: number): number {
  if (combo.cards.length === handSize) return -100_000;
  const bombPenalty = combo.type === "bomb" ? 10_000 : 0;
  return leading
    ? bombPenalty - combo.cards.length * 100 + combo.power
    : bombPenalty + combo.power * 10 + combo.cards.length;
}

/** 战术档在基础牌力之上，保护百搭并给接近收尾的牌型加权。 */
function tacticianScore(
  state: GuandanState,
  actorId: PlayerId,
  combo: CardCombo,
  handSize: number,
): number {
  let score = comboScore(combo, !state.trick, handSize);
  const remaining = handSize - combo.cards.length;
  const wildsUsed = combo.cards.filter((card) => isWild(card, state.levelRank)).length;

  // 百搭是整副手牌的调度资源，非必要时不轻易拆出去。
  score += wildsUsed * 55;
  // 手里越接近走完，越愿意留一手干净的小牌型收尾。
  if (remaining > 0 && remaining <= 4) score -= (4 - remaining) * 160;
  return score;
}

function sortCandidates(
  state: GuandanState,
  actorId: PlayerId,
  candidates: readonly CardCombo[],
  difficulty: GuandanDifficulty,
): CardCombo[] {
  const actor = getPlayer(state, actorId);
  const scoreFor = (combo: CardCombo) => difficulty === "tactician"
    ? tacticianScore(state, actorId, combo, actor.hand.length)
    : comboScore(combo, !state.trick, actor.hand.length);
  return [...candidates].sort((left, right) => scoreFor(left) - scoreFor(right));
}

function opponentsCloseToFinishing(state: GuandanState, actorId: PlayerId): boolean {
  const actor = getPlayer(state, actorId);
  return state.players.some((player) => player.team !== actor.team && player.hand.length <= 2);
}

/**
 * 三档本地 AI：
 * - 见习：在较优候选中带确定性抖动，偶尔打得不那么精准。
 * - 标准：沿用基础牌力启发式，优先跟最小能压的牌并保留炸弹。
 * - 战术：额外保护百搭、规划收尾；只有炸弹能压时，除非对手逼近走完，
 *   否则宁可过牌也不拆炸。
 */
export function chooseAiMove(
  state: GuandanState,
  actorId: PlayerId,
  difficulty: GuandanDifficulty = "standard",
): AiMove | undefined {
  if (state.status !== "playing" || state.activePlayerId !== actorId) return undefined;
  const actor = getPlayer(state, actorId);
  const partnerLeads = state.trick !== undefined
    && getPlayer(state, state.trick.actorId).team === actor.team;

  // Never take a trick off a partner — except by emptying our own hand, which
  // always advances the team toward the win and is what comboScore already
  // ranks highest.
  const candidates = generateLegalCombos(state, actorId)
    .filter((combo) => !partnerLeads || combo.cards.length === actor.hand.length);

  if (candidates.length === 0) return { kind: "pass" };
  const ranked = sortCandidates(state, actorId, candidates, difficulty);

  if (difficulty === "tactician" && state.trick && !partnerLeads) {
    const winningWithoutBomb = ranked.find((combo) => combo.type !== "bomb");
    if (winningWithoutBomb) {
      return { kind: "play", cardIds: winningWithoutBomb.cards.map((card) => card.id) };
    }
    // 只剩炸弹能压：手牌不多且能直接走完，或对手即将走完时才动用。
    const finishWithBomb = ranked.some((combo) => combo.cards.length === actor.hand.length);
    if (!finishWithBomb && !opponentsCloseToFinishing(state, actorId)) return { kind: "pass" };
  }

  if (difficulty === "relaxed") {
    const pool = ranked.slice(0, 3);
    const choice = pool[(state.revision + actorId.length + actor.hand.length) % pool.length];
    return { kind: "play", cardIds: choice.cards.map((card) => card.id) };
  }

  const choice = ranked[0];
  return choice ? { kind: "play", cardIds: choice.cards.map((card) => card.id) } : { kind: "pass" };
}
