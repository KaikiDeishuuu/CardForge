import {
  NUMBER_RANKS,
  PLAYER_ORDER,
  advanceLevel,
  classifyCombo,
  createDeck,
  levelsForPartnerPlace,
} from "./engine";
import type {
  CardCombo,
  GuandanCard,
  GuandanPlayer,
  GuandanState,
  NumberRank,
  PlayerId,
  TeamId,
} from "./types";

export const GUANDAN_SAVE_SCHEMA_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

const SUITS = new Set(["spades", "hearts", "diamonds", "clubs", "joker"]);
const CARD_RANKS = new Set<string>([...NUMBER_RANKS, "small-joker", "big-joker"]);
const TEAMS = new Set<TeamId>(["vermillion", "indigo"]);
const DIFFICULTIES = new Set(["relaxed", "standard", "tactician"]);
const COMBO_TYPES = new Set(["single", "pair", "triple", "full-house", "straight", "bomb"]);
const ACTION_TYPES = new Set(["deal", "play", "pass", "clear", "finish", "settle", "settings"]);
const DECK = createDeck();
const CARD_BY_ID = new Map(DECK.map((card) => [card.id, card]));

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isCard(value: unknown): value is GuandanCard {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  const expected = CARD_BY_ID.get(value.id);
  if (!expected) return false;
  return value.name === expected.name
    && typeof value.suit === "string" && SUITS.has(value.suit) && value.suit === expected.suit
    && typeof value.rank === "string" && CARD_RANKS.has(value.rank) && value.rank === expected.rank
    && value.deckIndex === expected.deckIndex;
}

function isPlayer(value: unknown): value is GuandanPlayer {
  if (!isRecord(value)
    || typeof value.id !== "string" || !PLAYER_ORDER.includes(value.id as PlayerId)
    || typeof value.displayName !== "string"
    || (value.controller !== "human" && value.controller !== "ai" && value.controller !== "remote")
    || typeof value.team !== "string" || !TEAMS.has(value.team as TeamId)
    || !Array.isArray(value.hand) || !value.hand.every(isCard)
    || (value.finishedPlace !== undefined && !isPositiveInteger(value.finishedPlace))) return false;

  if (value.id === "human") return value.controller === "human" && value.team === "vermillion";
  if (value.controller === "human") return false;
  const expectedTeam: TeamId = value.id === "partner" ? "vermillion" : "indigo";
  return value.team === expectedTeam;
}

function isCombo(value: unknown, levelRank: NumberRank): value is CardCombo {
  if (!isRecord(value)
    || typeof value.type !== "string" || !COMBO_TYPES.has(value.type)
    || typeof value.label !== "string"
    || typeof value.power !== "number" || !Number.isFinite(value.power)
    || !Array.isArray(value.cards) || !value.cards.every(isCard)
    || (value.bombSize !== undefined && !isPositiveInteger(value.bombSize))) return false;

  const cards = value.cards as unknown as GuandanCard[];
  if (new Set(cards.map((card) => card.id)).size !== cards.length) return false;
  const expected = classifyCombo(cards, levelRank);
  return expected !== undefined
    && expected.type === value.type
    && expected.power === value.power
    && expected.label === value.label;
}

function isAction(value: unknown): boolean {
  if (!isRecord(value)
    || !isNonNegativeInteger(value.id)
    || typeof value.actorId !== "string"
    || (value.actorId !== "table" && !PLAYER_ORDER.includes(value.actorId as PlayerId))
    || typeof value.type !== "string" || !ACTION_TYPES.has(value.type)
    || typeof value.text !== "string") return false;
  if (value.cards !== undefined && (!Array.isArray(value.cards) || !value.cards.every(isCard))) return false;
  return true;
}

function isMatch(value: unknown): boolean {
  if (!isRecord(value) || !isPositiveInteger(value.dealNumber)) return false;
  if (!isRecord(value.levels)
    || typeof value.levels.vermillion !== "string" || !NUMBER_RANKS.includes(value.levels.vermillion as NumberRank)
    || typeof value.levels.indigo !== "string" || !NUMBER_RANKS.includes(value.levels.indigo as NumberRank)) return false;
  if (typeof value.attackingTeam !== "string" || !TEAMS.has(value.attackingTeam as TeamId)) return false;
  if (value.champion !== undefined && (typeof value.champion !== "string" || !TEAMS.has(value.champion as TeamId))) return false;

  if (value.lastResult !== undefined) {
    if (!isRecord(value.lastResult)
      || typeof value.lastResult.winner !== "string" || !TEAMS.has(value.lastResult.winner as TeamId)
      || !isPositiveInteger(value.lastResult.partnerPlace) || value.lastResult.partnerPlace > 4
      || !isPositiveInteger(value.lastResult.gained) || value.lastResult.gained > 3
      || typeof value.lastResult.fromLevel !== "string" || !NUMBER_RANKS.includes(value.lastResult.fromLevel as NumberRank)
      || typeof value.lastResult.toLevel !== "string" || !NUMBER_RANKS.includes(value.lastResult.toLevel as NumberRank)
      || !Array.isArray(value.lastResult.finishOrder)
      || value.lastResult.finishOrder.length === 0
      || value.lastResult.finishOrder.length > 4
      || !value.lastResult.finishOrder.every((id) => typeof id === "string" && PLAYER_ORDER.includes(id as PlayerId))
      || new Set(value.lastResult.finishOrder).size !== value.lastResult.finishOrder.length) return false;

    const result = value.lastResult as {
      winner: TeamId;
      partnerPlace: number;
      gained: number;
      fromLevel: NumberRank;
      toLevel: NumberRank;
    };
    if (result.gained !== levelsForPartnerPlace(result.partnerPlace)) return false;
    const advanced = advanceLevel(result.fromLevel, result.gained);
    if (result.toLevel !== advanced.level) return false;
    const champion = value.champion as TeamId | undefined;
    if (advanced.champion) {
      if (champion !== result.winner) return false;
    } else if (champion !== undefined) return false;
  } else if (value.champion !== undefined) return false;

  return true;
}

function isHandCardsUnique(players: readonly GuandanPlayer[]): boolean {
  const cards = players.flatMap((player) => player.hand);
  return new Set(cards.map((card) => card.id)).size === cards.length;
}

function validateFinishOrder(players: readonly GuandanPlayer[], finishOrder: readonly string[]): boolean {
  for (const player of players) {
    if (player.finishedPlace === undefined) continue;
    if (finishOrder[player.finishedPlace - 1] !== player.id) return false;
  }
  return new Set(finishOrder).size === finishOrder.length
    && finishOrder.every((id) => players.some((player) => player.id === id));
}

function restoreV1(data: unknown): GuandanState | undefined {
  if (!isRecord(data)
    || (data.status !== "playing" && data.status !== "finished")
    || !isNonNegativeInteger(data.revision)
    || typeof data.levelRank !== "string" || !NUMBER_RANKS.includes(data.levelRank as NumberRank)
    || typeof data.activePlayerId !== "string" || !PLAYER_ORDER.includes(data.activePlayerId as PlayerId)
    || !isNonNegativeInteger(data.consecutivePasses)) return undefined;
  if (!Array.isArray(data.players) || data.players.length !== 4 || !data.players.every(isPlayer)) return undefined;
  const players = data.players as unknown as GuandanPlayer[];
  const playerIds = players.map((player) => player.id);
  if (new Set(playerIds).size !== 4 || !PLAYER_ORDER.every((id) => playerIds.includes(id))) return undefined;
  if (!isHandCardsUnique(players)) return undefined;
  if (!Array.isArray(data.finishOrder) || !validateFinishOrder(players, data.finishOrder)) return undefined;
  if (!isMatch(data.match)) return undefined;
  if (typeof data.difficulty !== "string" || !DIFFICULTIES.has(data.difficulty)) return undefined;
  if (!Array.isArray(data.log) || !data.log.every(isAction)) return undefined;
  if (data.lastAction !== undefined && !isAction(data.lastAction)) return undefined;

  const state = data as unknown as GuandanState;
  // 对局结束时 match 会立刻记录下一局打级方的级别，而 state.levelRank
  // 仍是本局使用的级牌；只有进行中的牌局要求二者同步。
  if (state.status === "playing" && state.levelRank !== state.match.levels[state.match.attackingTeam]) return undefined;
  if (state.lastAction && state.lastAction.id !== state.revision) return undefined;
  const logIds = state.log.map((entry) => entry.id);
  if (new Set(logIds).size !== logIds.length) return undefined;
  if (state.log.length === 0 || state.log.at(-1)?.id !== state.revision) return undefined;

  if (state.trick !== undefined) {
    const trick = state.trick as unknown as UnknownRecord;
    if (typeof trick.actorId !== "string" || !PLAYER_ORDER.includes(trick.actorId as PlayerId)) return undefined;
    if (!isCombo(trick.combo, state.levelRank)) return undefined;
    const trickCards = (trick.combo as CardCombo).cards;
    const handCardIds = new Set(players.flatMap((player) => player.hand.map((card) => card.id)));
    if (trickCards.some((card) => handCardIds.has(card.id))) return undefined;
  }

  if (state.status === "playing") {
    if (state.winner !== undefined || state.match.champion !== undefined) return undefined;
    if ((getPlayerById(players, state.activePlayerId)?.hand.length ?? 0) === 0) return undefined;
  } else {
    if (state.winner === undefined || !TEAMS.has(state.winner)) return undefined;
    const leader = players.find((player) => player.id === state.finishOrder[0]);
    if (!leader || leader.team !== state.winner) return undefined;
    if (state.match.champion !== undefined && state.match.champion !== state.winner) return undefined;
  }

  return state;
}

function getPlayerById(players: readonly GuandanPlayer[], id: PlayerId): GuandanPlayer | undefined {
  return players.find((player) => player.id === id);
}

/** 状态本身已是纯数据，序列化交给存储层的 JSON 信封。 */
export function serializeGuandanState(state: GuandanState): unknown {
  return state;
}

export function restoreGuandanState(data: unknown): GuandanState | undefined {
  return restoreV1(data);
}
