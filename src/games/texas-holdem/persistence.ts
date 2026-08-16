import { createTexasDeck } from "./domain/cards";
import { TEXAS_BIG_BLIND, TEXAS_SMALL_BLIND } from "./domain/engine";
import { compareEvaluatedHands, evaluateTexasHand } from "./domain/evaluator";
import type {
  EvaluatedHand,
  TexasCard,
  TexasHandResult,
  TexasLogEntry,
  TexasPlayer,
  TexasPlayerId,
  TexasPotResult,
  TexasState,
} from "./domain/types";

export const TEXAS_HOLDEM_SAVE_SCHEMA_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

const CARD_BY_ID = new Map(createTexasDeck().map((card) => [card.id, card]));
const PLAYER_IDS: readonly TexasPlayerId[] = ["human", "east"];
const STREETS = new Set(["preflop", "flop", "turn", "river", "showdown"]);
const ACTION_KINDS = new Set([
  "deal", "fold", "check", "call", "raise", "street", "showdown", "award",
]);
const HAND_CATEGORIES = new Set([
  "high-card", "pair", "two-pair", "three-kind", "straight",
  "flush", "full-house", "four-kind", "straight-flush",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isSafeInteger(value) && value > 0;
}

function isPlayerId(value: unknown): value is TexasPlayerId {
  return typeof value === "string" && PLAYER_IDS.includes(value as TexasPlayerId);
}

function isCard(value: unknown): value is TexasCard {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  const expected = CARD_BY_ID.get(value.id);
  return Boolean(expected)
    && value.name === expected?.name
    && value.suit === expected?.suit
    && value.rank === expected?.rank;
}

function isLogEntry(value: unknown): value is TexasLogEntry {
  return isRecord(value)
    && isPositiveInteger(value.id)
    && (value.actorId === "table" || isPlayerId(value.actorId))
    && typeof value.kind === "string" && ACTION_KINDS.has(value.kind)
    && typeof value.text === "string" && value.text.length > 0;
}

function isPlayer(value: unknown, expectedId: TexasPlayerId): value is TexasPlayer {
  if (!isRecord(value)
    || value.id !== expectedId
    || !isNonNegativeInteger(value.stack)
    || !Array.isArray(value.hole) || value.hole.length !== 2 || !value.hole.every(isCard)
    || typeof value.folded !== "boolean"
    || typeof value.allIn !== "boolean"
    || typeof value.acted !== "boolean"
    || !isNonNegativeInteger(value.streetCommitted)
    || !isNonNegativeInteger(value.totalCommitted)
    || value.streetCommitted > value.totalCommitted) return false;

  if (expectedId === "human") {
    return value.displayName === "你"
      && value.controller === "human"
      && value.seat === 0
      && value.botStyle === undefined;
  }
  return value.displayName === "对手"
    && value.controller === "ai"
    && value.seat === 1
    && value.botStyle === "steady";
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameCardIds(left: readonly TexasCard[], right: readonly TexasCard[]): boolean {
  return left.length === right.length && left.every((card, index) => card.id === right[index]?.id);
}

function isEvaluatedHand(value: unknown, availableCards: readonly TexasCard[]): value is EvaluatedHand {
  if (!isRecord(value)
    || typeof value.category !== "string" || !HAND_CATEGORIES.has(value.category)
    || typeof value.label !== "string" || value.label.length === 0
    || !Array.isArray(value.tiebreak) || !value.tiebreak.every(isSafeInteger)
    || !Array.isArray(value.bestFive) || value.bestFive.length !== 5 || !value.bestFive.every(isCard)) return false;

  const expected = evaluateTexasHand(availableCards);
  return value.category === expected.category
    && value.label === expected.label
    && sameNumbers(value.tiebreak, expected.tiebreak)
    && sameCardIds(value.bestFive, expected.bestFive);
}

function uniquePlayerIds(value: unknown): value is TexasPlayerId[] {
  return Array.isArray(value)
    && value.every(isPlayerId)
    && new Set(value).size === value.length;
}

function samePlayerIds(left: readonly TexasPlayerId[], right: readonly TexasPlayerId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function playerIdsAfterDealer(
  players: readonly TexasPlayer[],
  dealerIndex: number,
  ids: readonly TexasPlayerId[],
): TexasPlayerId[] {
  const included = new Set(ids);
  const ordered: TexasPlayerId[] = [];
  for (let offset = 1; offset <= players.length; offset += 1) {
    const player = players[(dealerIndex + offset) % players.length];
    if (included.has(player.id)) ordered.push(player.id);
  }
  return ordered;
}

function isPotResult(value: unknown): value is TexasPotResult {
  if (!isRecord(value)
    || !isPositiveInteger(value.amount)
    || !uniquePlayerIds(value.eligiblePlayerIds)
    || value.eligiblePlayerIds.length === 0
    || !uniquePlayerIds(value.winnerIds)
    || value.winnerIds.length === 0) return false;
  const eligiblePlayerIds = value.eligiblePlayerIds as TexasPlayerId[];
  const winnerIds = value.winnerIds as TexasPlayerId[];
  return winnerIds.every((id) => eligiblePlayerIds.includes(id));
}

function isHandResult(value: unknown, state: UnknownRecord, players: readonly TexasPlayer[]): value is TexasHandResult {
  if (!isRecord(value)
    || (value.reason !== "fold" && value.reason !== "showdown")
    || !Array.isArray(value.pots) || value.pots.length === 0 || !value.pots.every(isPotResult)
    || !uniquePlayerIds(value.winnerIds) || value.winnerIds.length === 0
    || !isRecord(value.hands)
    || typeof value.summary !== "string" || value.summary.length === 0) return false;

  const pots = value.pots as TexasPotResult[];
  const winnerIds = value.winnerIds as TexasPlayerId[];
  const hands = value.hands as Partial<Record<TexasPlayerId, EvaluatedHand>>;
  const totalCommitted = players.reduce((sum, player) => sum + player.totalCommitted, 0);
  if (pots.reduce((sum, pot) => sum + pot.amount, 0) !== totalCommitted) return false;

  const handKeys = Object.keys(hands);
  if (handKeys.some((key) => !isPlayerId(key))) return false;
  if (value.reason === "fold") {
    const contenders = players.filter((player) => !player.folded);
    return contenders.length === 1
      && winnerIds.length === 1
      && winnerIds[0] === contenders[0].id
      && handKeys.length === 0
      && pots.length === 1
      && pots[0].amount === totalCommitted
      && samePlayerIds(pots[0].eligiblePlayerIds, [contenders[0].id])
      && samePlayerIds(pots[0].winnerIds, [contenders[0].id])
      && value.summary === `${contenders[0].displayName}收下 ${totalCommitted} 筹码底池。`;
  }

  if (!Array.isArray(state.board) || state.board.length !== 5 || !state.board.every(isCard)) return false;
  const contenders = players.filter((player) => !player.folded);
  if (contenders.length < 2
    || handKeys.length !== contenders.length
    || !contenders.every((player) => handKeys.includes(player.id))) return false;
  if (!contenders.every((player) => (
    isEvaluatedHand(hands[player.id], [...player.hole, ...(state.board as TexasCard[])])
  ))) return false;

  const levels = [...new Set(players.map((player) => player.totalCommitted).filter((amount) => amount > 0))]
    .sort((left, right) => left - right);
  const dealerIndex = state.dealerIndex as number;
  const expectedPots: TexasPotResult[] = [];
  const contestedPayouts = new Map<TexasPlayerId, number>();
  let previous = 0;
  for (const level of levels) {
    const contributors = players.filter((player) => player.totalCommitted >= level);
    const amount = (level - previous) * contributors.length;
    previous = level;
    const candidates = contributors.filter((player) => !player.folded);
    let winningPlayers: TexasPlayer[] = [];
    for (const candidate of candidates) {
      if (winningPlayers.length === 0) {
        winningPlayers = [candidate];
        continue;
      }
      const comparison = compareEvaluatedHands(hands[candidate.id]!, hands[winningPlayers[0].id]!);
      if (comparison > 0) winningPlayers = [candidate];
      else if (comparison === 0) winningPlayers.push(candidate);
    }
    const orderedWinners = playerIdsAfterDealer(
      players,
      dealerIndex,
      winningPlayers.map((player) => player.id),
    );
    if (candidates.length > 1) {
      const share = Math.floor(amount / orderedWinners.length);
      let remainder = amount % orderedWinners.length;
      for (const id of orderedWinners) {
        const award = share + (remainder > 0 ? 1 : 0);
        contestedPayouts.set(id, (contestedPayouts.get(id) ?? 0) + award);
        remainder = Math.max(0, remainder - 1);
      }
    }
    expectedPots.push({
      amount,
      eligiblePlayerIds: candidates.map((player) => player.id),
      winnerIds: orderedWinners,
    });
  }

  if (pots.length !== expectedPots.length || pots.some((pot, index) => {
    const expected = expectedPots[index];
    return pot.amount !== expected.amount
      || !samePlayerIds(pot.eligiblePlayerIds, expected.eligiblePlayerIds)
      || !samePlayerIds(pot.winnerIds, expected.winnerIds);
  })) return false;

  const expectedWinnerIds = playerIdsAfterDealer(players, dealerIndex, [...contestedPayouts.keys()]);
  if (!samePlayerIds(winnerIds, expectedWinnerIds)) return false;
  const expectedSummary = expectedWinnerIds.map((id) => {
    const player = players.find((entry) => entry.id === id)!;
    return `${player.displayName}以${hands[id]!.label}赢得 ${contestedPayouts.get(id)}`;
  }).join("；");
  return value.summary === expectedSummary;
}

function expectedBoardLength(street: unknown): number | undefined {
  if (street === "preflop") return 0;
  if (street === "flop") return 3;
  if (street === "turn") return 4;
  if (street === "river") return 5;
  return undefined;
}

function expectedDeckLength(boardLength: number): number {
  const burned = boardLength === 0 ? 0 : boardLength - 2;
  return 48 - boardLength - burned;
}

function expectedBurnedLength(boardLength: number): number {
  return boardLength === 0 ? 0 : boardLength - 2;
}

function restoreV1(data: unknown): TexasState | undefined {
  if (!isRecord(data)
    || !isPositiveInteger(data.revision)
    || (data.status !== "playing" && data.status !== "settled")
    || typeof data.street !== "string" || !STREETS.has(data.street)
    || !isPositiveInteger(data.handNumber)
    || (data.dealerIndex !== 0 && data.dealerIndex !== 1)
    || data.smallBlind !== TEXAS_SMALL_BLIND
    || data.bigBlind !== TEXAS_BIG_BLIND
    || !isPositiveInteger(data.tableChipTotal)
    || !Array.isArray(data.deck) || !data.deck.every(isCard)
    || !Array.isArray(data.burned) || !data.burned.every(isCard)
    || !Array.isArray(data.board) || !data.board.every(isCard)
    || !Array.isArray(data.players) || data.players.length !== 2
    || !isPlayer(data.players[0], "human") || !isPlayer(data.players[1], "east")
    || !isNonNegativeInteger(data.currentBet)
    || !isPositiveInteger(data.lastFullRaise)
    || !Array.isArray(data.log) || data.log.length === 0 || data.log.length > 40 || !data.log.every(isLogEntry)
    || (data.lastAction !== undefined && !isLogEntry(data.lastAction))) return undefined;

  const state = data as unknown as TexasState;
  const players = state.players;
  const allCards = [
    ...state.deck,
    ...state.burned,
    ...state.board,
    ...players.flatMap((player) => player.hole),
  ];
  if (allCards.length !== CARD_BY_ID.size
    || new Set(allCards.map((card) => card.id)).size !== CARD_BY_ID.size) return undefined;
  if (state.deck.length !== expectedDeckLength(state.board.length)
    || state.burned.length !== expectedBurnedLength(state.board.length)) return undefined;
  if (players.some((player) => player.streetCommitted > state.currentBet)) return undefined;
  if (Math.max(...players.map((player) => player.streetCommitted)) !== state.currentBet) return undefined;
  const accountedChips = state.status === "playing"
    ? players.reduce((sum, player) => sum + player.stack + player.totalCommitted, 0)
    : players.reduce((sum, player) => sum + player.stack, 0);
  if (accountedChips !== state.tableChipTotal) return undefined;

  const logIds = state.log.map((entry) => entry.id);
  if (!logIds.every((id, index) => index === 0 || id === logIds[index - 1] + 1)) return undefined;
  const latest = state.log.at(-1)!;
  if (latest.id !== state.revision || !state.lastAction || state.lastAction.id !== latest.id
    || state.lastAction.actorId !== latest.actorId || state.lastAction.kind !== latest.kind
    || state.lastAction.text !== latest.text) return undefined;

  if (state.status === "playing") {
    const boardLength = expectedBoardLength(state.street);
    if (boardLength === undefined || state.board.length !== boardLength
      || !isPlayerId(state.activePlayerId)
      || state.result !== undefined) return undefined;
    const active = players.find((player) => player.id === state.activePlayerId)!;
    if (active.folded || active.allIn || active.stack === 0) return undefined;
    if (players.some((player) => player.allIn !== (player.stack === 0))) return undefined;
  } else {
    if (state.street !== "showdown" || state.activePlayerId !== undefined
      || !isHandResult(state.result, data, players)) return undefined;
  }

  return state;
}

/** 状态为纯数据；平台负责把它包进带 schemaVersion 的 JSON 信封。 */
export function serializeTexasState(state: TexasState): unknown {
  return state;
}

/** 只恢复当前明确支持的 v1，任何结构或跨字段不一致都会拒绝。 */
export function restoreTexasState(schemaVersion: number, data: unknown): TexasState | undefined {
  return schemaVersion === TEXAS_HOLDEM_SAVE_SCHEMA_VERSION ? restoreV1(data) : undefined;
}
