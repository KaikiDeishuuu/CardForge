import { NUMBER_RANKS, PLAYER_ORDER } from "./engine";
import type { GuandanCard, GuandanPlayer, GuandanState, NumberRank, PlayerId, TeamId } from "./types";

export const GUANDAN_SAVE_SCHEMA_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

const SUITS = new Set(["spades", "hearts", "diamonds", "clubs", "joker"]);
const CARD_RANKS = new Set<string>([...NUMBER_RANKS, "small-joker", "big-joker"]);
const TEAMS = new Set<TeamId>(["vermillion", "indigo"]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isCard(value: unknown): value is GuandanCard {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.rank === "string" && CARD_RANKS.has(value.rank)
    && typeof value.suit === "string" && SUITS.has(value.suit)
    && (value.deckIndex === 0 || value.deckIndex === 1);
}

function isPlayer(value: unknown): value is GuandanPlayer {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && PLAYER_ORDER.includes(value.id as PlayerId)
    && typeof value.displayName === "string"
    && (value.controller === "human" || value.controller === "ai" || value.controller === "remote")
    && typeof value.team === "string" && TEAMS.has(value.team as TeamId)
    && Array.isArray(value.hand) && value.hand.every(isCard)
    && (value.finishedPlace === undefined || typeof value.finishedPlace === "number");
}

function isMatch(value: unknown): boolean {
  if (!isRecord(value) || typeof value.dealNumber !== "number") return false;
  if (!isRecord(value.levels)
    || typeof value.levels.vermillion !== "string" || !NUMBER_RANKS.includes(value.levels.vermillion as NumberRank)
    || typeof value.levels.indigo !== "string" || !NUMBER_RANKS.includes(value.levels.indigo as NumberRank)) return false;
  if (typeof value.attackingTeam !== "string" || !TEAMS.has(value.attackingTeam as TeamId)) return false;
  if (value.champion !== undefined && (typeof value.champion !== "string" || !TEAMS.has(value.champion as TeamId))) return false;
  if (value.lastResult !== undefined) {
    const result = value.lastResult as UnknownRecord;
    if (typeof result.winner !== "string" || !TEAMS.has(result.winner as TeamId)
      || typeof result.partnerPlace !== "number"
      || typeof result.gained !== "number"
      || typeof result.fromLevel !== "string" || !NUMBER_RANKS.includes(result.fromLevel as NumberRank)
      || typeof result.toLevel !== "string" || !NUMBER_RANKS.includes(result.toLevel as NumberRank)
      || !Array.isArray(result.finishOrder) || !result.finishOrder.every((id) => typeof id === "string")) return false;
  }
  return true;
}

function isAction(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "number"
    && typeof value.actorId === "string"
    && typeof value.text === "string";
}

/** 状态本身已是纯数据，序列化交给存储层的 JSON 信封。 */
export function serializeGuandanState(state: GuandanState): unknown {
  return state;
}

export function restoreGuandanState(data: unknown): GuandanState | undefined {
  if (!isRecord(data)) return undefined;
  if (data.status !== "playing" && data.status !== "finished") return undefined;
  if (typeof data.revision !== "number"
    || typeof data.levelRank !== "string" || !NUMBER_RANKS.includes(data.levelRank as NumberRank)
    || typeof data.activePlayerId !== "string" || !PLAYER_ORDER.includes(data.activePlayerId as PlayerId)
    || typeof data.consecutivePasses !== "number") return undefined;
  if (!Array.isArray(data.players) || data.players.length !== 4 || !data.players.every(isPlayer)) return undefined;
  if (!Array.isArray(data.finishOrder) || !data.finishOrder.every((id) => typeof id === "string")) return undefined;
  if (!isMatch(data.match)) return undefined;
  if (!Array.isArray(data.log) || !data.log.every(isAction)) return undefined;
  if (data.lastAction !== undefined && !isAction(data.lastAction)) return undefined;
  if (data.winner !== undefined && (typeof data.winner !== "string" || !TEAMS.has(data.winner as TeamId))) return undefined;
  if (data.trick !== undefined) {
    if (!isRecord(data.trick)
      || typeof data.trick.actorId !== "string"
      || !isRecord(data.trick.combo)
      || !Array.isArray(data.trick.combo.cards)
      || !data.trick.combo.cards.every(isCard)) return undefined;
  }
  return data as unknown as GuandanState;
}
