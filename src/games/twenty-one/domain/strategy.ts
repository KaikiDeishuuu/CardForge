import { evaluateHand, legalActions } from "./engine";
import type {
  PlayingCard,
  TwentyOneAction,
  TwentyOneLegalActions,
  TwentyOneState,
} from "./types";

type DecisionAction = Extract<
  TwentyOneAction["type"],
  "hit" | "stand" | "double" | "split" | "surrender"
>;
type DealerRow = readonly [
  DecisionAction,
  DecisionAction,
  DecisionAction,
  DecisionAction,
  DecisionAction,
  DecisionAction,
  DecisionAction,
  DecisionAction,
  DecisionAction,
  DecisionAction,
];

export interface StrategyHint {
  readonly action: TwentyOneAction["type"];
  readonly reason: string;
}

const H = "hit";
const S = "stand";
const D = "double";
const P = "split";

function row(...actions: DealerRow): DealerRow {
  return actions;
}

/** Dealer columns are 2, 3, 4, 5, 6, 7, 8, 9, 10, A. */
const MULTI_DECK_HARD_TABLE: Readonly<Partial<Record<number, DealerRow>>> = {
  9: row(H, D, D, D, D, H, H, H, H, H),
  10: row(D, D, D, D, D, D, D, D, H, H),
  11: row(D, D, D, D, D, D, D, D, D, H),
  12: row(H, H, S, S, S, H, H, H, H, H),
  13: row(S, S, S, S, S, H, H, H, H, H),
  14: row(S, S, S, S, S, H, H, H, H, H),
  15: row(S, S, S, S, S, H, H, H, H, H),
  16: row(S, S, S, S, S, H, H, H, H, H),
};

const SINGLE_DECK_HARD_TABLE: Readonly<Partial<Record<number, DealerRow>>> = {
  8: row(H, H, H, D, D, H, H, H, H, H),
  9: row(D, D, D, D, D, H, H, H, H, H),
  10: row(D, D, D, D, D, D, D, D, H, H),
  11: row(D, D, D, D, D, D, D, D, D, D),
  12: row(H, H, S, S, S, H, H, H, H, H),
  13: row(S, S, S, S, S, H, H, H, H, H),
  14: row(S, S, S, S, S, H, H, H, H, H),
  15: row(S, S, S, S, S, H, H, H, H, H),
  16: row(S, S, S, S, S, H, H, H, H, H),
};

const MULTI_DECK_SOFT_TABLE: Readonly<Partial<Record<number, DealerRow>>> = {
  13: row(H, H, H, D, D, H, H, H, H, H),
  14: row(H, H, H, D, D, H, H, H, H, H),
  15: row(H, H, D, D, D, H, H, H, H, H),
  16: row(H, H, D, D, D, H, H, H, H, H),
  17: row(H, D, D, D, D, H, H, H, H, H),
  18: row(S, D, D, D, D, S, S, H, H, H),
};

const SINGLE_DECK_SOFT_TABLE: Readonly<Partial<Record<number, DealerRow>>> = {
  13: row(H, H, H, D, D, H, H, H, H, H),
  14: row(H, H, D, D, D, H, H, H, H, H),
  15: row(H, H, D, D, D, H, H, H, H, H),
  16: row(H, H, D, D, D, H, H, H, H, H),
  17: row(D, D, D, D, D, H, H, H, H, H),
  18: row(S, D, D, D, D, S, S, H, H, H),
};

const MULTI_DECK_DAS_PAIR_TABLE: Readonly<Partial<Record<number, DealerRow>>> = {
  2: row(P, P, P, P, P, P, H, H, H, H),
  3: row(P, P, P, P, P, P, H, H, H, H),
  4: row(H, H, H, P, P, H, H, H, H, H),
  6: row(P, P, P, P, P, H, H, H, H, H),
  7: row(P, P, P, P, P, P, H, H, H, H),
  8: row(P, P, P, P, P, P, P, P, P, P),
  9: row(P, P, P, P, P, S, P, P, S, S),
  10: row(S, S, S, S, S, S, S, S, S, S),
  11: row(P, P, P, P, P, P, P, P, P, P),
};

const MULTI_DECK_NO_DAS_PAIR_TABLE: Readonly<Partial<Record<number, DealerRow>>> = {
  2: row(H, H, P, P, P, P, H, H, H, H),
  3: row(H, H, P, P, P, P, H, H, H, H),
  4: row(H, H, H, H, H, H, H, H, H, H),
  6: row(H, P, P, P, P, H, H, H, H, H),
  7: row(P, P, P, P, P, P, H, H, H, H),
  8: row(P, P, P, P, P, P, P, P, P, P),
  9: row(P, P, P, P, P, S, P, P, S, S),
  10: row(S, S, S, S, S, S, S, S, S, S),
  11: row(P, P, P, P, P, P, P, P, P, P),
};

const SINGLE_DECK_DAS_PAIR_TABLE: Readonly<Partial<Record<number, DealerRow>>> = {
  2: row(P, P, P, P, P, P, H, H, H, H),
  3: row(P, P, P, P, P, P, P, H, H, H),
  4: row(H, H, P, P, P, H, H, H, H, H),
  6: row(P, P, P, P, P, P, H, H, H, H),
  7: row(P, P, P, P, P, P, P, H, H, H),
  8: row(P, P, P, P, P, P, P, P, P, P),
  9: row(P, P, P, P, P, S, P, P, S, S),
  10: row(S, S, S, S, S, S, S, S, S, S),
  11: row(P, P, P, P, P, P, P, P, P, P),
};

const SINGLE_DECK_NO_DAS_PAIR_TABLE: Readonly<Partial<Record<number, DealerRow>>> = {
  2: row(H, P, P, P, P, P, H, H, H, H),
  3: row(H, H, P, P, P, P, P, H, H, H),
  4: row(H, H, H, H, H, H, H, H, H, H),
  6: row(H, P, P, P, P, H, H, H, H, H),
  7: row(P, P, P, P, P, P, P, H, H, H),
  8: row(P, P, P, P, P, P, P, P, P, P),
  9: row(P, P, P, P, P, S, P, P, S, S),
  10: row(S, S, S, S, S, S, S, S, S, S),
  11: row(P, P, P, P, P, P, P, P, P, P),
};

function cardValue(card: PlayingCard): number {
  if (card.rank === "A") return 11;
  if (card.rank === "J" || card.rank === "Q" || card.rank === "K") return 10;
  return Number(card.rank);
}

function dealerColumn(card: PlayingCard): number {
  return cardValue(card) === 11 ? 9 : cardValue(card) - 2;
}

function pairValue(cards: readonly PlayingCard[]): number | undefined {
  if (cards.length !== 2) return undefined;
  const first = cardValue(cards[0]);
  return first === cardValue(cards[1]) ? first : undefined;
}

function hardDecision(total: number, column: number, singleDeck: boolean, hitsSoft17: boolean): DecisionAction {
  if (total >= 17) return S;
  if (total <= 7) return H;

  const table = singleDeck ? SINGLE_DECK_HARD_TABLE : MULTI_DECK_HARD_TABLE;
  let decision = table[total]?.[column] ?? H;
  // The dealer hitting soft 17 makes doubling 11 against an Ace worthwhile in multi-deck games.
  if (!singleDeck && hitsSoft17 && total === 11 && column === 9) decision = D;
  return decision;
}

function softDecision(total: number, column: number, singleDeck: boolean, hitsSoft17: boolean): DecisionAction {
  if (total >= 20) return S;
  if (total <= 12) return H;

  const table = singleDeck ? SINGLE_DECK_SOFT_TABLE : MULTI_DECK_SOFT_TABLE;
  let decision = table[total]?.[column] ?? S;
  if (hitsSoft17 && total === 18 && column === 0) decision = D;
  if (hitsSoft17 && total === 19 && column === 4) decision = D;
  return decision;
}

function pairDecision(
  value: number | undefined,
  column: number,
  singleDeck: boolean,
  doubleAfterSplit: boolean,
): DecisionAction | undefined {
  if (value === undefined || value === 5) return undefined;
  const table = singleDeck
    ? doubleAfterSplit ? SINGLE_DECK_DAS_PAIR_TABLE : SINGLE_DECK_NO_DAS_PAIR_TABLE
    : doubleAfterSplit ? MULTI_DECK_DAS_PAIR_TABLE : MULTI_DECK_NO_DAS_PAIR_TABLE;
  return table[value]?.[column];
}

function shouldSurrender(
  total: number,
  pair: number | undefined,
  dealer: number,
  singleDeck: boolean,
  hitsSoft17: boolean,
): boolean {
  // Paired eights normally split; under multi-deck H17, 8,8 vs A is the surrender exception.
  if (pair === 8) return !singleDeck && hitsSoft17 && dealer === 11;
  if (singleDeck) {
    if (hitsSoft17 && total === 17 && dealer === 11) return true;
    if (hitsSoft17 && total === 15 && (dealer === 10 || dealer === 11)) return true;
    return total === 16 && (dealer === 10 || (hitsSoft17 && (dealer === 9 || dealer === 11)));
  }
  if (hitsSoft17 && total === 17 && dealer === 11) return true;
  if (total === 15) return dealer === 10 || (hitsSoft17 && dealer === 11);
  return total === 16 && dealer >= 9;
}

function isLegal(action: DecisionAction, legal: TwentyOneLegalActions): boolean {
  return legal[action];
}

function firstLegal(legal: TwentyOneLegalActions, actions: readonly DecisionAction[]): DecisionAction | undefined {
  return actions.find((action) => isLegal(action, legal));
}

function actionCopy(action: DecisionAction): string {
  switch (action) {
    case "hit": return "要牌";
    case "stand": return "停牌";
    case "double": return "加倍";
    case "split": return "拆牌";
    case "surrender": return "迟投降";
  }
}

/**
 * Return a local, deterministic basic-strategy suggestion for the active hand.
 * It never mutates state, never calls an external service, and never returns an illegal action.
 */
export function getStrategyHint(state: TwentyOneState): StrategyHint | undefined {
  const legal = legalActions(state);
  if (state.phase === "insurance") {
    return legal.declineInsurance
      ? { action: "decline-insurance", reason: "保险的长期期望值为负，基础策略建议拒绝保险。" }
      : undefined;
  }
  if (state.phase !== "player-turn" || state.activeHandIndex === null) return undefined;

  const hand = state.hands[state.activeHandIndex];
  const dealerUpcard = state.dealerHand[0];
  if (!hand || !dealerUpcard) return undefined;

  const value = evaluateHand(hand.cards);
  const dealer = cardValue(dealerUpcard);
  const column = dealerColumn(dealerUpcard);
  const pair = pairValue(hand.cards);
  const singleDeck = state.rules.deckCount === 1;
  const hitsSoft17 = state.rules.dealerSoft17 === "hit";
  const handLabel = pair !== undefined ? `对子 ${pair === 11 ? "A" : pair}` : `${value.soft ? "软" : "硬"} ${value.total}`;
  const matchup = `${singleDeck ? "单副牌" : "多副牌"}：${handLabel} 对庄家 ${dealer === 11 ? "A" : dealer}`;

  if (state.rules.allowLateSurrender && shouldSurrender(value.total, pair, dealer, singleDeck, hitsSoft17)) {
    if (legal.surrender) return { action: "surrender", reason: `${matchup}，建议迟投降。` };
    const fallback = firstLegal(legal, [H, S]);
    if (fallback) {
      return { action: fallback, reason: `${matchup}，当前不可迟投降，改为${actionCopy(fallback)}。` };
    }
  }

  const preferredPair = pairDecision(pair, column, singleDeck, state.rules.doubleAfterSplit);
  if (preferredPair === P) {
    if (legal.split) return { action: P, reason: `${matchup}，建议拆牌。` };
    const fallbackBase = value.soft
      ? softDecision(value.total, column, singleDeck, hitsSoft17)
      : hardDecision(value.total, column, singleDeck, hitsSoft17);
    const fallback = fallbackBase === D && !legal.double
      ? firstLegal(legal, [H, S])
      : firstLegal(legal, [fallbackBase, H, S]);
    if (fallback) {
      return { action: fallback, reason: `${matchup}，当前不可拆牌，按${value.soft ? "软点" : "硬点"}策略改为${actionCopy(fallback)}。` };
    }
  } else if (preferredPair && isLegal(preferredPair, legal)) {
    return { action: preferredPair, reason: `${matchup}，建议${actionCopy(preferredPair)}。` };
  }

  const preferred = value.soft
    ? softDecision(value.total, column, singleDeck, hitsSoft17)
    : hardDecision(value.total, column, singleDeck, hitsSoft17);
  if (isLegal(preferred, legal)) return { action: preferred, reason: `${matchup}，建议${actionCopy(preferred)}。` };

  const fallback = preferred === D
    ? firstLegal(legal, [H, S])
    : firstLegal(legal, preferred === H ? [S] : [H]);
  return fallback
    ? { action: fallback, reason: `${matchup}，当前不可${actionCopy(preferred)}，改为${actionCopy(fallback)}。` }
    : undefined;
}
