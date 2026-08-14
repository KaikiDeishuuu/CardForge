import type { PlayingCard, TwentyOneState } from "./types";

export const TWENTY_ONE_SAVE_SCHEMA_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

const SUITS = new Set(["spades", "hearts", "diamonds", "clubs"]);
const RANKS = new Set(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);
const PHASES = new Set(["betting", "player-turn", "dealer-turn", "settled"]);
const OUTCOMES = new Set(["player", "dealer", "push"]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isCard(value: unknown): value is PlayingCard {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.rank === "string" && RANKS.has(value.rank)
    && typeof value.suit === "string" && SUITS.has(value.suit);
}

function isLogEntry(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "number"
    && typeof value.text === "string";
}

/** 状态本身已是纯数据，序列化交给存储层的 JSON 信封。 */
export function serializeTwentyOneState(state: TwentyOneState): unknown {
  return state;
}

export function restoreTwentyOneState(data: unknown): TwentyOneState | undefined {
  if (!isRecord(data)) return undefined;
  if (typeof data.phase !== "string" || !PHASES.has(data.phase)) return undefined;
  if (typeof data.revision !== "number"
    || typeof data.chips !== "number"
    || typeof data.bet !== "number"
    || typeof data.handNumber !== "number"
    || typeof data.dealerRevealed !== "boolean"
    || typeof data.doubled !== "boolean") return undefined;
  if (!Array.isArray(data.deck) || !data.deck.every(isCard)) return undefined;
  if (!Array.isArray(data.playerHand) || !data.playerHand.every(isCard)) return undefined;
  if (!Array.isArray(data.dealerHand) || !data.dealerHand.every(isCard)) return undefined;
  if (!Array.isArray(data.log) || !data.log.every(isLogEntry)) return undefined;
  if (data.outcome !== undefined && (typeof data.outcome !== "string" || !OUTCOMES.has(data.outcome))) return undefined;
  if (data.lastEvent !== undefined && !isLogEntry(data.lastEvent)) return undefined;
  return data as unknown as TwentyOneState;
}
