import {
  createEmptyChallengeRecords,
  createEmptyStats,
  STANDARD_SIX_RULES,
  type ActiveTwentyOneSession,
  type ChallengeRecord,
  type ChallengeRecordBucket,
  type TwentyOneRootState,
  type TwentyOneStats,
} from "./session";
import type {
  HandSettlement,
  InsuranceSettlement,
  PlayingCard,
  PlayerHandState,
  TableEvent,
  TwentyOneRules,
  TwentyOneSettlement,
  TwentyOneState,
} from "./types";

export const TWENTY_ONE_SAVE_SCHEMA_VERSION = 2;

type UnknownRecord = Record<string, unknown>;

const SUITS = new Set(["spades", "hearts", "diamonds", "clubs"]);
const RANKS = new Set(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);
const PHASES = new Set(["betting", "insurance", "player-turn", "dealer-turn", "settled"]);
const OUTCOMES = new Set(["player", "dealer", "push"]);
const HAND_STATUSES = new Set(["playing", "stood", "busted", "surrendered"]);
const HAND_OUTCOMES = new Set(["win", "loss", "push", "blackjack", "surrender"]);
const INSURANCE_STATUSES = new Set(["not-offered", "offered", "declined", "won", "lost"]);
const EVENT_ACTORS = new Set(["player", "dealer", "table"]);
const EVENT_TYPES = new Set(["deal", "hit", "stand", "reveal", "settle", "bet", "double", "split", "insurance", "surrender", "rules"]);
const END_REASONS = new Set(["left-table", "bankrupt", "challenge-cleared", "round-limit"]);
const CHALLENGE_IDS = new Set(["warmup", "double", "endurance"]);

const LEGACY_RULES: TwentyOneRules = {
  deckCount: 1,
  dealerSoft17: "stand",
  blackjackPayout: "3:2",
  maxPlayerHands: 1,
  doubleAfterSplit: false,
  resplitAces: false,
  hitSplitAces: false,
  allowInsurance: false,
  allowLateSurrender: false,
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegativeNumber(value) && Number.isInteger(value);
}

function isHalfChip(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value * 2);
}

function isNonNegativeHalfChip(value: unknown): value is number {
  return isNonNegativeNumber(value) && isHalfChip(value);
}

function isCard(value: unknown): value is PlayingCard {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.rank === "string" && RANKS.has(value.rank)
    && typeof value.suit === "string" && SUITS.has(value.suit);
}

function isRules(value: unknown): value is TwentyOneRules {
  if (!isRecord(value)) return false;
  return (value.deckCount === 1 || value.deckCount === 2 || value.deckCount === 6 || value.deckCount === 8)
    && (value.dealerSoft17 === "stand" || value.dealerSoft17 === "hit")
    && (value.blackjackPayout === "3:2" || value.blackjackPayout === "6:5")
    && (value.maxPlayerHands === 1 || value.maxPlayerHands === 2 || value.maxPlayerHands === 3 || value.maxPlayerHands === 4)
    && typeof value.doubleAfterSplit === "boolean"
    && typeof value.resplitAces === "boolean"
    && typeof value.hitSplitAces === "boolean"
    && typeof value.allowInsurance === "boolean"
    && typeof value.allowLateSurrender === "boolean";
}

function isPlayerHand(value: unknown): value is PlayerHandState {
  return isRecord(value)
    && typeof value.id === "string"
    && Array.isArray(value.cards) && value.cards.every(isCard)
    && isNonNegativeHalfChip(value.wager)
    && typeof value.status === "string" && HAND_STATUSES.has(value.status)
    && typeof value.fromSplit === "boolean"
    && typeof value.splitAces === "boolean"
    && typeof value.doubled === "boolean";
}

function isTableEvent(value: unknown): value is TableEvent {
  return isRecord(value)
    && isNonNegativeInteger(value.id)
    && typeof value.actor === "string" && EVENT_ACTORS.has(value.actor)
    && typeof value.type === "string" && EVENT_TYPES.has(value.type)
    && typeof value.text === "string"
    && (value.handId === undefined || typeof value.handId === "string")
    && (value.card === undefined || isCard(value.card));
}

function isHandSettlement(value: unknown): value is HandSettlement {
  return isRecord(value)
    && typeof value.handId === "string"
    && typeof value.outcome === "string" && HAND_OUTCOMES.has(value.outcome)
    && isNonNegativeHalfChip(value.wager)
    && isNonNegativeHalfChip(value.returned)
    && isHalfChip(value.net)
    && typeof value.reason === "string";
}

function isInsuranceSettlement(value: unknown): value is InsuranceSettlement {
  return isRecord(value)
    && typeof value.status === "string" && INSURANCE_STATUSES.has(value.status) && value.status !== "offered"
    && isNonNegativeHalfChip(value.wager)
    && isNonNegativeHalfChip(value.returned)
    && isHalfChip(value.net);
}

function isSettlement(value: unknown): value is TwentyOneSettlement {
  if (!(isRecord(value)
    && typeof value.outcome === "string" && OUTCOMES.has(value.outcome)
    && Array.isArray(value.handResults) && value.handResults.every(isHandSettlement)
    && isInsuranceSettlement(value.insurance)
    && isNonNegativeHalfChip(value.totalWagered)
    && isNonNegativeHalfChip(value.returned)
    && isHalfChip(value.net)
    && typeof value.reason === "string")) return false;

  if (!value.handResults.every((result) => result.net === result.returned - result.wager)) return false;
  if (value.insurance.net !== value.insurance.returned - value.insurance.wager) return false;
  if (value.insurance.status === "won"
    && (value.insurance.wager <= 0 || value.insurance.returned !== value.insurance.wager * 3)) return false;
  if (value.insurance.status === "lost"
    && (value.insurance.wager <= 0 || value.insurance.returned !== 0)) return false;
  if ((value.insurance.status === "declined" || value.insurance.status === "not-offered")
    && (value.insurance.wager !== 0 || value.insurance.returned !== 0)) return false;

  const wagered = value.handResults.reduce((sum, result) => sum + result.wager, 0) + value.insurance.wager;
  const returned = value.handResults.reduce((sum, result) => sum + result.returned, 0) + value.insurance.returned;
  if (value.totalWagered !== wagered || value.returned !== returned || value.net !== returned - wagered) return false;
  const expectedOutcome = value.net > 0 ? "player" : value.net < 0 ? "dealer" : "push";
  return value.outcome === expectedOutcome;
}

function isTableState(value: unknown): value is TwentyOneState {  if (!isRecord(value)
    || !isNonNegativeInteger(value.revision)
    || typeof value.phase !== "string" || !PHASES.has(value.phase)
    || !isRules(value.rules)
    || !Array.isArray(value.deck) || !value.deck.every(isCard)
    || !Array.isArray(value.dealerHand) || !value.dealerHand.every(isCard)
    || typeof value.dealerRevealed !== "boolean"
    || !Array.isArray(value.hands) || !value.hands.every(isPlayerHand)
    || !isNonNegativeHalfChip(value.baseBet)
    || !isRecord(value.insurance)
    || typeof value.insurance.status !== "string" || !INSURANCE_STATUSES.has(value.insurance.status)
    || !isNonNegativeHalfChip(value.insurance.wager)
    || !isNonNegativeHalfChip(value.chips)
    || !isNonNegativeInteger(value.handNumber) || value.handNumber < 1
    || !Array.isArray(value.log) || !value.log.every(isTableEvent)) return false;

  if (value.activeHandIndex !== null
    && (!isNonNegativeInteger(value.activeHandIndex) || value.activeHandIndex >= value.hands.length)) return false;
  if (value.settlement !== undefined && !isSettlement(value.settlement)) return false;
  if (value.lastEvent !== undefined && !isTableEvent(value.lastEvent)) return false;
  if (value.phase === "betting" && (value.hands.length !== 0
    || value.dealerHand.length !== 0
    || value.dealerRevealed
    || value.activeHandIndex !== null
    || value.settlement !== undefined
    || value.baseBet !== 0
    || value.insurance.status !== "not-offered"
    || value.insurance.wager !== 0)) return false;
  if (value.phase !== "betting" && (value.hands.length === 0
    || value.dealerHand.length < 2
    || value.baseBet <= 0)) return false;
  if (value.phase === "insurance" && (value.insurance.status !== "offered"
    || value.insurance.wager !== 0
    || value.hands.length !== 1
    || value.dealerHand[0]?.rank !== "A"
    || value.dealerRevealed
    || value.deck.length < 2
    || value.activeHandIndex !== null
    || value.settlement !== undefined)) return false;
  if (value.phase === "player-turn" && (value.activeHandIndex === null
    || value.hands[value.activeHandIndex]?.status !== "playing"
    || value.dealerRevealed
    || value.deck.length < 2
    || value.settlement !== undefined)) return false;
  if (value.phase === "dealer-turn" && (value.activeHandIndex !== null
    || value.hands.some((hand) => hand.status === "playing")
    || !value.dealerRevealed
    || value.deck.length < 1
    || value.settlement !== undefined)) return false;
  if (value.phase === "settled" && (value.activeHandIndex !== null
    || !value.dealerRevealed
    || value.settlement === undefined)) return false;
  const settlement = value.settlement;
  if (settlement) {
    if (settlement.handResults.length !== value.hands.length) return false;
    const resultIds = new Set(settlement.handResults.map((result) => result.handId));
    if (resultIds.size !== settlement.handResults.length) return false;
    if (!value.hands.every((hand) => settlement.handResults.some((result) => (
      result.handId === hand.id && result.wager === hand.wager
    )))) return false;
    if (value.insurance.status !== settlement.insurance.status
      || value.insurance.wager !== settlement.insurance.wager) return false;
  }
  return true;
}

const STAT_COUNT_KEYS = [
  "roundsPlayed", "handsWon", "handsLost", "handsPushed", "blackjacks",
  "playerBusts", "surrenders", "insurancePurchases", "currentWinStreak", "bestWinStreak",
] as const satisfies readonly (keyof TwentyOneStats)[];

const STAT_NON_NEGATIVE_NUMBER_KEYS = [
  "totalWagered", "biggestRoundWin", "peakChips",
] as const satisfies readonly (keyof TwentyOneStats)[];

const STAT_SIGNED_NUMBER_KEYS = ["netChips", "insuranceNet"] as const satisfies readonly (keyof TwentyOneStats)[];

function isStats(value: unknown): value is TwentyOneStats {
  if (!isRecord(value)) return false;
  return STAT_COUNT_KEYS.every((key) => isNonNegativeInteger(value[key]))
    && STAT_NON_NEGATIVE_NUMBER_KEYS.every((key) => isNonNegativeHalfChip(value[key]))
    && STAT_SIGNED_NUMBER_KEYS.every((key) => isHalfChip(value[key]));
}

function isRecordBucket(value: unknown): value is ChallengeRecordBucket {
  return isRecord(value)
    && isNonNegativeInteger(value.runs)
    && isNonNegativeInteger(value.clears)
    && value.clears <= value.runs
    && (value.bestFinalChips === undefined || isNonNegativeNumber(value.bestFinalChips));
}

function isChallengeRecord(value: unknown): value is ChallengeRecord {
  return isRecord(value) && isRecordBucket(value.assisted) && isRecordBucket(value.unassisted);
}

function isActiveSession(value: unknown): value is ActiveTwentyOneSession {
  if (!isRecord(value)
    || (value.mode !== "classic" && value.mode !== "challenge")
    || !isTableState(value.table)
    || !isNonNegativeInteger(value.roundsCompleted)
    || !isStats(value.sessionStats)
    || typeof value.assisted !== "boolean"
    || (value.status !== "playing" && value.status !== "summary")
    || (value.endReason !== undefined && (typeof value.endReason !== "string" || !END_REASONS.has(value.endReason)))
    || (value.consumedSettlementRevision !== undefined && !isNonNegativeInteger(value.consumedSettlementRevision))) return false;

  if (value.mode === "challenge") {
    if (typeof value.challengeId !== "string" || !CHALLENGE_IDS.has(value.challengeId)) return false;
  } else if (value.challengeId !== undefined) return false;
  if (value.status === "summary" && value.endReason === undefined) return false;
  if (value.roundsCompleted !== value.sessionStats.roundsPlayed) return false;
  if (value.consumedSettlementRevision !== undefined
    && value.consumedSettlementRevision > value.table.revision) return false;
  if (value.table.phase === "settled"
    && value.consumedSettlementRevision !== value.table.revision) return false;
  return true;
}

const LEGAL_BET_AMOUNTS = new Set([10, 25, 50, 100]);

function isLastBetPreference(value: unknown): boolean {
  return value === undefined || (isNonNegativeNumber(value) && LEGAL_BET_AMOUNTS.has(value));
}

function restoreV2(data: unknown): TwentyOneRootState | undefined {
  if (!isRecord(data)
    || !isNonNegativeInteger(data.revision)
    || !isRecord(data.preferences)
    || !isRules(data.preferences.rules)
    || typeof data.preferences.assistEnabled !== "boolean"
    || !isLastBetPreference(data.preferences.lastBet)
    || !isStats(data.lifetimeStats)
    || !isRecord(data.challengeRecords)
    || !isChallengeRecord(data.challengeRecords.warmup)
    || !isChallengeRecord(data.challengeRecords.double)
    || !isChallengeRecord(data.challengeRecords.endurance)
    || (data.activeSession !== undefined && !isActiveSession(data.activeSession))) return undefined;
  return data as unknown as TwentyOneRootState;
}

interface LegacyState extends UnknownRecord {
  revision: number;
  phase: "betting" | "player-turn" | "dealer-turn" | "settled";
  deck: PlayingCard[];
  playerHand: PlayingCard[];
  dealerHand: PlayingCard[];
  dealerRevealed: boolean;
  chips: number;
  bet: number;
  doubled: boolean;
  handNumber: number;
  log: TableEvent[];
  lastEvent?: TableEvent;
  outcome?: "player" | "dealer" | "push";
  reason?: string;
  payout?: number;
}

function isLegacyState(data: unknown): data is LegacyState {
  if (!isRecord(data)
    || !isNonNegativeInteger(data.revision)
    || (data.phase !== "betting" && data.phase !== "player-turn" && data.phase !== "dealer-turn" && data.phase !== "settled")
    || !Array.isArray(data.deck) || !data.deck.every(isCard)
    || !Array.isArray(data.playerHand) || !data.playerHand.every(isCard)
    || !Array.isArray(data.dealerHand) || !data.dealerHand.every(isCard)
    || typeof data.dealerRevealed !== "boolean"
    || !isNonNegativeHalfChip(data.chips)
    || !isNonNegativeHalfChip(data.bet)
    || typeof data.doubled !== "boolean"
    || !isNonNegativeInteger(data.handNumber) || data.handNumber < 1
    || !Array.isArray(data.log) || !data.log.every(isTableEvent)) return false;
  if (data.lastEvent !== undefined && !isTableEvent(data.lastEvent)) return false;
  if (data.outcome !== undefined && (typeof data.outcome !== "string" || !OUTCOMES.has(data.outcome))) return false;
  if (data.reason !== undefined && typeof data.reason !== "string") return false;
  if (data.payout !== undefined && (!isHalfChip(data.payout) || data.payout < -data.bet)) return false;
  return true;
}

function cardPoints(cards: readonly PlayingCard[]): number {
  let total = cards.reduce((sum, card) => sum + (card.rank === "A" ? 11 : ["J", "Q", "K"].includes(card.rank) ? 10 : Number(card.rank)), 0);
  let aces = cards.filter((card) => card.rank === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function legacySettlement(data: LegacyState, handId: string): TwentyOneSettlement | undefined {
  if (data.phase !== "settled" || !data.outcome) return undefined;
  const net = data.payout ?? 0;
  const returned = data.bet + net;
  const handOutcome = data.outcome === "push"
    ? "push"
    : data.outcome === "dealer"
      ? "loss"
      : data.reason === "Blackjack" ? "blackjack" : "win";
  const result: HandSettlement = {
    handId,
    outcome: handOutcome,
    wager: data.bet,
    returned,
    net,
    reason: data.reason ?? "旧牌局结算",
  };
  return {
    outcome: data.outcome,
    handResults: [result],
    insurance: { status: "not-offered", wager: 0, returned: 0, net: 0 },
    totalWagered: data.bet,
    returned,
    net,
    reason: data.reason ?? "旧牌局结算",
  };
}

function migrateV1(data: unknown): TwentyOneRootState | undefined {
  if (!isLegacyState(data)) return undefined;
  const handId = `legacy-${data.handNumber}-0`;
  const hasHand = data.playerHand.length > 0;
  const busted = cardPoints(data.playerHand) > 21;
  const hand: PlayerHandState | undefined = hasHand ? {
    id: handId,
    cards: data.playerHand,
    wager: data.bet,
    status: data.phase === "player-turn" ? "playing" : busted ? "busted" : "stood",
    fromSplit: false,
    splitAces: false,
    doubled: data.doubled,
  } : undefined;
  const settlement = legacySettlement(data, handId);
  const table: TwentyOneState = {
    revision: data.revision,
    phase: data.phase,
    rules: LEGACY_RULES,
    deck: data.deck,
    dealerHand: data.dealerHand,
    dealerRevealed: data.dealerRevealed,
    hands: hand ? [hand] : [],
    activeHandIndex: data.phase === "player-turn" && hand ? 0 : null,
    baseBet: data.doubled ? data.bet / 2 : data.bet,
    insurance: { status: "not-offered", wager: 0 },
    settlement,
    chips: data.chips,
    handNumber: data.handNumber,
    log: data.log,
    lastEvent: data.lastEvent,
  };
  if (!isTableState(table)) return undefined;
  const emptyStats = createEmptyStats();
  return {
    revision: data.revision,
    preferences: { rules: STANDARD_SIX_RULES, assistEnabled: false },
    lifetimeStats: emptyStats,
    challengeRecords: createEmptyChallengeRecords(),
    activeSession: {
      mode: "classic",
      table,
      roundsCompleted: 0,
      sessionStats: createEmptyStats(data.chips),
      assisted: false,
      status: "playing",
      consumedSettlementRevision: settlement ? data.revision : undefined,
    },
  };
}

/** State is already pure data; the platform envelope performs JSON encoding. */
export function serializeTwentyOneRootState(state: TwentyOneRootState): unknown {
  return state;
}

export function restoreTwentyOneRootState(
  schemaVersion: number,
  data: unknown,
): TwentyOneRootState | undefined {
  if (schemaVersion === TWENTY_ONE_SAVE_SCHEMA_VERSION) return restoreV2(data);
  if (schemaVersion === 1) return migrateV1(data);
  return undefined;
}
