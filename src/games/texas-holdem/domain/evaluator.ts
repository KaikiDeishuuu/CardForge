import { texasRankValue } from "./cards";
import type { EvaluatedHand, HandCategory, TexasCard } from "./types";

const CATEGORY_POWER: Readonly<Record<HandCategory, number>> = {
  "high-card": 0,
  pair: 1,
  "two-pair": 2,
  "three-kind": 3,
  straight: 4,
  flush: 5,
  "full-house": 6,
  "four-kind": 7,
  "straight-flush": 8,
};

function rankLabel(value: number): string {
  if (value === 14) return "A";
  if (value === 13) return "K";
  if (value === 12) return "Q";
  if (value === 11) return "J";
  return String(value);
}

function straightHigh(values: readonly number[]): number | undefined {
  const unique = [...new Set(values)].sort((left, right) => right - left);
  if (unique.includes(14)) unique.push(1);
  for (let index = 0; index <= unique.length - 5; index += 1) {
    const window = unique.slice(index, index + 5);
    if (window.every((value, offset) => value === window[0] - offset)) return window[0] === 1 ? 5 : window[0];
  }
  return undefined;
}

function groupRanks(cards: readonly TexasCard[]) {
  const counts = new Map<number, number>();
  for (const card of cards) {
    const value = texasRankValue(card.rank);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0]);
}

function result(
  category: HandCategory,
  tiebreak: readonly number[],
  bestFive: readonly TexasCard[],
  label: string,
): EvaluatedHand {
  return { category, tiebreak, bestFive, label };
}

export function evaluateFiveCardHand(cards: readonly TexasCard[]): EvaluatedHand {
  if (cards.length !== 5) throw new Error("Texas hand evaluation requires exactly five cards.");
  const values = cards.map((card) => texasRankValue(card.rank)).sort((left, right) => right - left);
  const groups = groupRanks(cards);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straight = straightHigh(values);

  if (flush && straight !== undefined) {
    return result(
      "straight-flush",
      [straight],
      cards,
      straight === 14 ? "皇家同花顺" : `${rankLabel(straight)} 高同花顺`,
    );
  }

  const four = groups.find(([, count]) => count === 4);
  if (four) {
    const kicker = groups.find(([, count]) => count === 1)![0];
    return result("four-kind", [four[0], kicker], cards, `四条 ${rankLabel(four[0])}`);
  }

  const three = groups.find(([, count]) => count === 3);
  const pairForHouse = groups.find(([, count]) => count === 2);
  if (three && pairForHouse) {
    return result(
      "full-house",
      [three[0], pairForHouse[0]],
      cards,
      `${rankLabel(three[0])} 满堂红`,
    );
  }

  if (flush) return result("flush", values, cards, `${rankLabel(values[0])} 高同花`);
  if (straight !== undefined) return result("straight", [straight], cards, `${rankLabel(straight)} 高顺子`);

  if (three) {
    const kickers = groups.filter(([, count]) => count === 1).map(([rank]) => rank).sort((a, b) => b - a);
    return result("three-kind", [three[0], ...kickers], cards, `三条 ${rankLabel(three[0])}`);
  }

  const pairs = groups.filter(([, count]) => count === 2).map(([rank]) => rank).sort((a, b) => b - a);
  if (pairs.length === 2) {
    const kicker = groups.find(([, count]) => count === 1)![0];
    return result("two-pair", [pairs[0], pairs[1], kicker], cards, `${rankLabel(pairs[0])}、${rankLabel(pairs[1])} 两对`);
  }

  if (pairs.length === 1) {
    const kickers = groups.filter(([, count]) => count === 1).map(([rank]) => rank).sort((a, b) => b - a);
    return result("pair", [pairs[0], ...kickers], cards, `一对 ${rankLabel(pairs[0])}`);
  }

  return result("high-card", values, cards, `${rankLabel(values[0])} 高牌`);
}

function fiveCardCombinations(cards: readonly TexasCard[]): TexasCard[][] {
  const combinations: TexasCard[][] = [];
  function visit(start: number, selected: TexasCard[]) {
    if (selected.length === 5) {
      combinations.push(selected);
      return;
    }
    for (let index = start; index <= cards.length - (5 - selected.length); index += 1) {
      visit(index + 1, [...selected, cards[index]]);
    }
  }
  visit(0, []);
  return combinations;
}

export function compareEvaluatedHands(left: EvaluatedHand, right: EvaluatedHand): number {
  const categoryDifference = CATEGORY_POWER[left.category] - CATEGORY_POWER[right.category];
  if (categoryDifference !== 0) return Math.sign(categoryDifference);
  const length = Math.max(left.tiebreak.length, right.tiebreak.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.tiebreak[index] ?? 0) - (right.tiebreak[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function evaluateTexasHand(cards: readonly TexasCard[]): EvaluatedHand {
  if (cards.length < 5 || cards.length > 7) throw new Error("Texas hand evaluation requires five to seven cards.");
  const combinations = fiveCardCombinations(cards);
  let best = evaluateFiveCardHand(combinations[0]);
  for (const combination of combinations.slice(1)) {
    const candidate = evaluateFiveCardHand(combination);
    if (compareEvaluatedHands(candidate, best) > 0) best = candidate;
  }
  return best;
}
