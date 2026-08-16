import { shuffleTexasDeck } from "./cards";
import { compareEvaluatedHands, evaluateTexasHand } from "./evaluator";
import type {
  TexasCard,
  TexasHandResult,
  TexasLegalActions,
  TexasLogEntry,
  TexasPlayer,
  TexasPlayerAction,
  TexasPlayerId,
  TexasPotResult,
  TexasState,
  TexasStreet,
} from "./types";

export const TEXAS_STARTING_STACK = 500;
export const TEXAS_SMALL_BLIND = 5;
export const TEXAS_BIG_BLIND = 10;

const PLAYER_TEMPLATES: ReadonlyArray<Pick<TexasPlayer, "id" | "displayName" | "controller" | "seat" | "botStyle">> = [
  { id: "human", displayName: "你", controller: "human", seat: 0 },
  { id: "east", displayName: "对手", controller: "ai", seat: 1, botStyle: "steady" },
];

function emptyPlayer(
  template: typeof PLAYER_TEMPLATES[number],
  stack = TEXAS_STARTING_STACK,
): TexasPlayer {
  return {
    ...template,
    stack,
    hole: [],
    folded: false,
    allIn: false,
    acted: false,
    streetCommitted: 0,
    totalCommitted: 0,
  };
}

function draw(deck: readonly TexasCard[]): { card: TexasCard; deck: TexasCard[] } {
  const card = deck.at(-1);
  if (!card) throw new Error("Texas Hold'em deck is empty.");
  return { card, deck: deck.slice(0, -1) };
}

function appendLog(
  state: TexasState,
  actorId: TexasLogEntry["actorId"],
  kind: TexasLogEntry["kind"],
  text: string,
): TexasState {
  const entry: TexasLogEntry = { id: state.revision + 1, actorId, kind, text };
  return {
    ...state,
    revision: entry.id,
    lastAction: entry,
    log: [...state.log, entry].slice(-40),
  };
}

function replacePlayer(
  players: readonly TexasPlayer[],
  playerId: TexasPlayerId,
  update: (player: TexasPlayer) => TexasPlayer,
): TexasPlayer[] {
  return players.map((player) => player.id === playerId ? update(player) : player);
}

function commit(player: TexasPlayer, requested: number): TexasPlayer {
  const amount = Math.max(0, Math.min(player.stack, Math.floor(requested)));
  const stack = player.stack - amount;
  return {
    ...player,
    stack,
    streetCommitted: player.streetCommitted + amount,
    totalCommitted: player.totalCommitted + amount,
    allIn: stack === 0,
  };
}

function nextPlayerId(
  players: readonly TexasPlayer[],
  afterIndex: number,
  predicate: (player: TexasPlayer) => boolean,
): TexasPlayerId | undefined {
  for (let offset = 1; offset <= players.length; offset += 1) {
    const player = players[(afterIndex + offset) % players.length];
    if (predicate(player)) return player.id;
  }
  return undefined;
}

function playerIndex(players: readonly TexasPlayer[], playerId: TexasPlayerId): number {
  const index = players.findIndex((player) => player.id === playerId);
  if (index === -1) throw new Error(`Unknown Texas player: ${playerId}`);
  return index;
}

function isActionable(player: TexasPlayer): boolean {
  return !player.folded && !player.allIn;
}

export function getTexasPotSize(state: TexasState): number {
  return state.players.reduce((sum, player) => sum + player.totalCommitted, 0);
}

function roundComplete(state: TexasState): boolean {
  return state.players
    .filter(isActionable)
    .every((player) => player.acted && player.streetCommitted === state.currentBet);
}

function communityStreet(boardLength: number): TexasStreet {
  if (boardLength === 0) return "preflop";
  if (boardLength === 3) return "flop";
  if (boardLength === 4) return "turn";
  return "river";
}

function revealCommunity(state: TexasState, count: number): TexasState {
  let deck = [...state.deck];
  const burned = draw(deck);
  deck = burned.deck;
  const board = [...state.board];
  for (let index = 0; index < count; index += 1) {
    const next = draw(deck);
    deck = next.deck;
    board.push(next.card);
  }
  return { ...state, deck, burned: [...state.burned, burned.card], board, street: communityStreet(board.length) };
}

function winnerOrder(state: TexasState, winnerIds: readonly TexasPlayerId[]): TexasPlayerId[] {
  const winners = new Set(winnerIds);
  const ordered: TexasPlayerId[] = [];
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const player = state.players[(state.dealerIndex + offset) % state.players.length];
    if (winners.has(player.id)) ordered.push(player.id);
  }
  return ordered;
}

function awardPots(state: TexasState): TexasState {
  const contenders = state.players.filter((player) => !player.folded);
  const hands: TexasHandResult["hands"] = Object.fromEntries(
    contenders.map((player) => [player.id, evaluateTexasHand([...player.hole, ...state.board])]),
  );
  const levels = [...new Set(state.players.map((player) => player.totalCommitted).filter((amount) => amount > 0))]
    .sort((left, right) => left - right);
  let previous = 0;
  const pots: TexasPotResult[] = [];
  const payouts = new Map<TexasPlayerId, number>();
  const contestedPayouts = new Map<TexasPlayerId, number>();

  for (const level of levels) {
    const contributors = state.players.filter((player) => player.totalCommitted >= level);
    const amount = (level - previous) * contributors.length;
    previous = level;
    if (amount <= 0) continue;
    const eligible = contributors.filter((player) => !player.folded);
    const candidates = eligible.length > 0 ? eligible : contenders;
    let winners: TexasPlayer[] = [];
    for (const candidate of candidates) {
      if (winners.length === 0) {
        winners = [candidate];
        continue;
      }
      const comparison = compareEvaluatedHands(hands[candidate.id]!, hands[winners[0].id]!);
      if (comparison > 0) winners = [candidate];
      else if (comparison === 0) winners.push(candidate);
    }
    const orderedWinners = winnerOrder(state, winners.map((player) => player.id));
    const share = Math.floor(amount / orderedWinners.length);
    let remainder = amount % orderedWinners.length;
    const contested = candidates.length > 1;
    for (const winnerId of orderedWinners) {
      const award = share + (remainder > 0 ? 1 : 0);
      payouts.set(winnerId, (payouts.get(winnerId) ?? 0) + award);
      if (contested) {
        contestedPayouts.set(winnerId, (contestedPayouts.get(winnerId) ?? 0) + award);
      }
      remainder = Math.max(0, remainder - 1);
    }
    pots.push({
      amount,
      eligiblePlayerIds: candidates.map((player) => player.id),
      winnerIds: orderedWinners,
    });
  }

  const players = state.players.map((player) => ({
    ...player,
    stack: player.stack + (payouts.get(player.id) ?? 0),
  }));
  // A one-contributor side level is an uncalled-chip return, not a won pot.
  // Keep it in payouts for chip conservation, but do not present that player
  // as a winner when they lost the contested main pot.
  const winnerIds = winnerOrder(
    state,
    [...contestedPayouts.entries()].filter(([, amount]) => amount > 0).map(([id]) => id),
  );
  const summary = winnerIds.map((id) => {
    const player = players.find((entry) => entry.id === id)!;
    const hand = hands[id];
    return `${player.displayName}${hand ? `以${hand.label}` : ""}赢得 ${contestedPayouts.get(id)}`;
  }).join("；");
  const result: TexasHandResult = { reason: "showdown", pots, winnerIds, hands, summary };
  return appendLog({
    ...state,
    players,
    status: "settled",
    street: "showdown",
    activePlayerId: undefined,
    result,
  }, "table", "showdown", summary);
}

function awardUncontested(state: TexasState, winner: TexasPlayer): TexasState {
  const amount = getTexasPotSize(state);
  const players = replacePlayer(state.players, winner.id, (player) => ({ ...player, stack: player.stack + amount }));
  const summary = `${winner.displayName}收下 ${amount} 筹码底池。`;
  const result: TexasHandResult = {
    reason: "fold",
    pots: [{ amount, eligiblePlayerIds: [winner.id], winnerIds: [winner.id] }],
    winnerIds: [winner.id],
    hands: {},
    summary,
  };
  return appendLog({
    ...state,
    players,
    status: "settled",
    street: "showdown",
    activePlayerId: undefined,
    result,
  }, "table", "award", summary);
}

function runBoardAndShowdown(state: TexasState): TexasState {
  let next = state;
  if (next.board.length === 0) next = revealCommunity(next, 3);
  if (next.board.length === 3) next = revealCommunity(next, 1);
  if (next.board.length === 4) next = revealCommunity(next, 1);
  return awardPots(next);
}

function advanceStreet(state: TexasState): TexasState {
  const resetPlayers = state.players.map((player) => ({
    ...player,
    streetCommitted: 0,
    acted: false,
  }));
  let next: TexasState = {
    ...state,
    players: resetPlayers,
    currentBet: 0,
    lastFullRaise: state.bigBlind,
  };

  if (state.street === "river") return awardPots(next);
  next = revealCommunity(next, state.street === "preflop" ? 3 : 1);
  next = appendLog(next, "table", "street", `${streetName(next.street)}发出。`);
  const actionable = next.players.filter(isActionable);
  if (actionable.length <= 1) return runBoardAndShowdown(next);
  return {
    ...next,
    activePlayerId: nextPlayerId(next.players, next.dealerIndex, isActionable),
  };
}

function continueAfterAction(state: TexasState, actorIndex: number): TexasState {
  const contenders = state.players.filter((player) => !player.folded);
  if (contenders.length === 1) return awardUncontested(state, contenders[0]);
  if (roundComplete(state)) return advanceStreet(state);
  return {
    ...state,
    activePlayerId: nextPlayerId(state.players, actorIndex, isActionable),
  };
}

function postBlind(players: readonly TexasPlayer[], playerId: TexasPlayerId, amount: number): TexasPlayer[] {
  return replacePlayer(players, playerId, (player) => commit(player, amount));
}

function dealHoleCards(players: readonly TexasPlayer[], deckInput: readonly TexasCard[], dealerIndex: number) {
  let deck = [...deckInput];
  let dealt = players.map((player) => ({ ...player, hole: [] as TexasCard[] }));
  for (let round = 0; round < 2; round += 1) {
    for (let offset = 1; offset <= players.length; offset += 1) {
      const index = (dealerIndex + offset) % players.length;
      const next = draw(deck);
      deck = next.deck;
      dealt = dealt.map((player, playerIndexValue) => playerIndexValue === index
        ? { ...player, hole: [...player.hole, next.card] }
        : player);
    }
  }
  return { players: dealt, deck };
}

function startHand(
  previous: Pick<TexasState, "revision" | "log" | "players" | "handNumber" | "dealerIndex" | "smallBlind" | "bigBlind">,
  random: () => number,
): TexasState {
  const reloadedPlayerIds = new Set(previous.players
    .filter((player) => player.stack < previous.bigBlind)
    .map((player) => player.id));
  const refreshed = previous.players.map((player, index) => emptyPlayer(
    PLAYER_TEMPLATES[index],
    reloadedPlayerIds.has(player.id) ? TEXAS_STARTING_STACK : player.stack,
  ));
  const tableChipTotal = refreshed.reduce((sum, player) => sum + player.stack, 0);
  const shuffled = shuffleTexasDeck(undefined, random);
  const dealt = dealHoleCards(refreshed, shuffled, previous.dealerIndex);
  const smallBlindIndex = dealt.players.length === 2
    ? previous.dealerIndex
    : (previous.dealerIndex + 1) % dealt.players.length;
  const bigBlindIndex = (smallBlindIndex + 1) % dealt.players.length;
  const smallBlindPlayer = dealt.players[smallBlindIndex];
  const bigBlindPlayer = dealt.players[bigBlindIndex];
  let players = postBlind(dealt.players, smallBlindPlayer.id, previous.smallBlind);
  players = postBlind(players, bigBlindPlayer.id, previous.bigBlind);
  const state: TexasState = {
    revision: previous.revision,
    status: "playing",
    street: "preflop",
    handNumber: previous.handNumber,
    dealerIndex: previous.dealerIndex,
    smallBlind: previous.smallBlind,
    bigBlind: previous.bigBlind,
    tableChipTotal,
    deck: dealt.deck,
    burned: [],
    board: [],
    players,
    activePlayerId: nextPlayerId(players, bigBlindIndex, isActionable),
    currentBet: previous.bigBlind,
    lastFullRaise: previous.bigBlind,
    log: previous.log,
  };
  return appendLog(
    state,
    "table",
    "deal",
    `第 ${state.handNumber} 手牌开始，${smallBlindPlayer.displayName}/${bigBlindPlayer.displayName}投入 ${state.smallBlind}/${state.bigBlind} 盲注。${
      reloadedPlayerIds.size > 0
        ? `${refreshed.filter((player) => reloadedPlayerIds.has(player.id)).map((player) => player.displayName).join("、")}自动补充至 ${TEXAS_STARTING_STACK} 筹码。`
        : ""
    }`,
  );
}

export function createTexasState(random: () => number = Math.random): TexasState {
  const players = PLAYER_TEMPLATES.map((template) => emptyPlayer(template));
  return startHand({
    revision: 0,
    log: [],
    players,
    handNumber: 1,
    dealerIndex: 0,
    smallBlind: TEXAS_SMALL_BLIND,
    bigBlind: TEXAS_BIG_BLIND,
  }, random);
}

export function startNextTexasHand(state: TexasState, random: () => number = Math.random): TexasState {
  if (state.status !== "settled") return state;
  return startHand({
    revision: state.revision,
    log: state.log,
    players: state.players,
    handNumber: state.handNumber + 1,
    dealerIndex: (state.dealerIndex + 1) % state.players.length,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
  }, random);
}

function roundedToBlind(value: number, blind: number): number {
  return Math.ceil(value / blind) * blind;
}

export function getTexasLegalActions(state: TexasState, playerId: TexasPlayerId): TexasLegalActions {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player || state.status !== "playing" || state.activePlayerId !== playerId || !isActionable(player)) {
    return { fold: false, check: false, callAmount: 0, maxRaiseTo: 0, raisePresets: [] };
  }
  const callAmount = Math.max(0, Math.min(player.stack, state.currentBet - player.streetCommitted));
  const maxRaiseTo = player.streetCommitted + player.stack;
  const rawMinimum = state.currentBet === 0 ? state.bigBlind : state.currentBet + state.lastFullRaise;
  // A short all-in is still legal when the player cannot reach a full minimum
  // raise. A player responding to such an all-in keeps `acted: true`: they may
  // call or fold, but the incomplete raise does not reopen their raise option.
  const canRaise = !player.acted && maxRaiseTo > state.currentBet;
  const minRaiseTo = canRaise && maxRaiseTo >= rawMinimum ? rawMinimum : undefined;
  const pot = getTexasPotSize(state);
  const candidates = !canRaise
    ? []
    : minRaiseTo === undefined
      ? [maxRaiseTo]
    : [
        minRaiseTo,
        roundedToBlind(Math.max(minRaiseTo, state.currentBet + Math.max(state.bigBlind, Math.floor(pot / 2))), state.bigBlind),
        roundedToBlind(Math.max(minRaiseTo, state.currentBet + Math.max(state.bigBlind, pot)), state.bigBlind),
        maxRaiseTo,
      ];
  const raisePresets = [...new Set(candidates.filter((amount) => (
    minRaiseTo === undefined || amount >= minRaiseTo
  ) && amount <= maxRaiseTo))]
    .sort((left, right) => left - right);
  return {
    fold: true,
    check: callAmount === 0,
    callAmount,
    minRaiseTo,
    maxRaiseTo,
    raisePresets,
  };
}

export function applyTexasAction(
  state: TexasState,
  playerId: TexasPlayerId,
  action: TexasPlayerAction,
): TexasState {
  if (state.status !== "playing" || state.activePlayerId !== playerId) return state;
  const index = playerIndex(state.players, playerId);
  const actor = state.players[index];
  const legal = getTexasLegalActions(state, playerId);
  let players = [...state.players];
  let currentBet = state.currentBet;
  let lastFullRaise = state.lastFullRaise;
  let kind: TexasLogEntry["kind"];
  let text: string;

  if (action.type === "fold") {
    if (!legal.fold) return state;
    players = replacePlayer(players, playerId, (player) => ({ ...player, folded: true, acted: true }));
    kind = "fold";
    text = `${actor.displayName}弃牌。`;
  } else if (action.type === "check") {
    if (!legal.check) return state;
    players = replacePlayer(players, playerId, (player) => ({ ...player, acted: true }));
    kind = "check";
    text = `${actor.displayName}过牌。`;
  } else if (action.type === "call") {
    if (legal.callAmount <= 0) return state;
    players = replacePlayer(players, playerId, (player) => ({ ...commit(player, legal.callAmount), acted: true }));
    kind = "call";
    text = legal.callAmount === actor.stack
      ? `${actor.displayName}用 ${legal.callAmount} 筹码全下跟注。`
      : `${actor.displayName}跟注 ${legal.callAmount}。`;
  } else {
    const shortAllIn = legal.minRaiseTo === undefined
      && legal.raisePresets.length === 1
      && action.to === legal.maxRaiseTo;
    const fullRaise = legal.minRaiseTo !== undefined
      && action.to >= legal.minRaiseTo
      && action.to <= legal.maxRaiseTo;
    if (!shortAllIn && !fullRaise) return state;
    const amount = action.to - actor.streetCommitted;
    const raiseSize = action.to - state.currentBet;
    players = players.map((player) => {
      if (player.id === playerId) return { ...commit(player, amount), acted: true };
      // Only a full raise reopens action for a player who already acted.
      return fullRaise && isActionable(player) ? { ...player, acted: false } : player;
    });
    currentBet = action.to;
    if (fullRaise) lastFullRaise = raiseSize;
    kind = "raise";
    text = action.to === legal.maxRaiseTo
      ? `${actor.displayName}全下到 ${action.to}。`
      : `${actor.displayName}加注到 ${action.to}。`;
  }

  const acted = appendLog({ ...state, players, currentBet, lastFullRaise }, playerId, kind, text);
  return continueAfterAction(acted, index);
}

export function streetName(street: TexasStreet): string {
  switch (street) {
    case "preflop": return "翻牌前";
    case "flop": return "翻牌";
    case "turn": return "转牌";
    case "river": return "河牌";
    case "showdown": return "摊牌";
  }
}
