import type {
  HandValue,
  PlayingCard,
  Rank,
  Suit,
  TableEvent,
  TwentyOneOutcome,
  TwentyOneState,
} from "./types";

const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const RANKS: readonly Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const SUIT_NAMES: Record<Suit, string> = {
  spades: "黑桃",
  hearts: "红心",
  diamonds: "方片",
  clubs: "梅花",
};

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function createDeck(): PlayingCard[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({
    id: `${suit}-${rank}`,
    name: `${SUIT_NAMES[suit]} ${rank}`,
    suit,
    rank,
  })));
}

function rankValue(rank: Rank): number {
  if (rank === "A") return 11;
  if (rank === "J" || rank === "Q" || rank === "K") return 10;
  return Number(rank);
}

export function evaluateHand(hand: readonly PlayingCard[]): HandValue {
  let total = hand.reduce((sum, card) => sum + rankValue(card.rank), 0);
  let softAces = hand.filter((card) => card.rank === "A").length;

  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces -= 1;
  }

  return {
    total,
    soft: softAces > 0,
    blackjack: hand.length === 2 && total === 21,
    busted: total > 21,
  };
}

function draw(deck: readonly PlayingCard[]): { card: PlayingCard; deck: PlayingCard[] } {
  const card = deck.at(-1);
  if (!card) throw new Error("Twenty One deck is empty.");
  return { card, deck: deck.slice(0, -1) };
}

function event(
  revision: number,
  actor: TableEvent["actor"],
  type: TableEvent["type"],
  text: string,
  card?: PlayingCard,
): TableEvent {
  return { id: revision, actor, type, text, card };
}

function appendEvent(state: TwentyOneState, nextEvent: TableEvent): TwentyOneState {
  return {
    ...state,
    revision: nextEvent.id,
    lastEvent: nextEvent,
    log: [...state.log, nextEvent].slice(-10),
  };
}

export const STARTING_CHIPS = 500;
export const BET_STEPS: readonly number[] = [10, 25, 50, 100];
/** 牌靴低于这个张数就换新的，保证一手牌不会把牌靴抽空。 */
const RESHUFFLE_BELOW = 20;

/**
 * `returnRate` 是连本带利退回的倍率：输 0、和 1、赢 2、Blackjack 2.5（3:2）。
 */
function settle(
  state: TwentyOneState,
  outcome: TwentyOneOutcome,
  reason: string,
  text: string,
  returnRate: number,
): TwentyOneState {
  const returned = Math.floor(state.bet * returnRate);
  const nextEvent = event(state.revision + 1, "table", "settle", text);
  return appendEvent({
    ...state,
    phase: "settled",
    dealerRevealed: true,
    outcome,
    reason,
    chips: state.chips + returned,
    payout: returned - state.bet,
  }, nextEvent);
}

function compareHands(state: TwentyOneState): TwentyOneState {
  const player = evaluateHand(state.playerHand);
  const dealer = evaluateHand(state.dealerHand);
  if (dealer.busted) return settle(state, "player", "庄家爆牌", "庄家超过二十一点，你赢得本手。", 2);
  if (player.total > dealer.total) return settle(state, "player", "点数领先", `${player.total} 对 ${dealer.total}，你更接近二十一点。`, 2);
  if (dealer.total > player.total) return settle(state, "dealer", "庄家领先", `${dealer.total} 对 ${player.total}，庄家赢得本手。`, 0);
  return settle(state, "push", "点数相同", `双方同为 ${player.total} 点，本手和牌。`, 1);
}

export function createInitialState(random: () => number = Math.random): TwentyOneState {
  return {
    revision: 0,
    phase: "betting",
    deck: shuffled(createDeck(), random),
    playerHand: [],
    dealerHand: [],
    dealerRevealed: false,
    chips: STARTING_CHIPS,
    bet: 0,
    doubled: false,
    handNumber: 1,
    log: [event(0, "table", "deal", "牌靴已洗好。先决定这一手压多少。")],
  };
}

export function availableBets(state: TwentyOneState): readonly number[] {
  return BET_STEPS.filter((amount) => amount <= state.chips);
}

/** 下注即发牌：两张明牌给你，庄家一明一暗。 */
export function placeBet(
  state: TwentyOneState,
  amount: number,
  random: () => number = Math.random,
): TwentyOneState {
  if (state.phase !== "betting" || amount <= 0 || amount > state.chips) return state;

  let deck: readonly PlayingCard[] = state.deck.length < RESHUFFLE_BELOW
    ? shuffled(createDeck(), random)
    : state.deck;
  const playerHand: PlayingCard[] = [];
  const dealerHand: PlayingCard[] = [];
  for (let round = 0; round < 2; round += 1) {
    const playerDraw = draw(deck);
    playerHand.push(playerDraw.card);
    deck = playerDraw.deck;
    const dealerDraw = draw(deck);
    dealerHand.push(dealerDraw.card);
    deck = dealerDraw.deck;
  }

  const base = appendEvent({
    ...state,
    phase: "player-turn",
    deck,
    playerHand,
    dealerHand,
    dealerRevealed: false,
    outcome: undefined,
    reason: undefined,
    payout: undefined,
    doubled: false,
    bet: amount,
    chips: state.chips - amount,
  }, event(state.revision + 1, "player", "bet", `你压下 ${amount} 枚筹码。`));

  const player = evaluateHand(playerHand);
  const dealer = evaluateHand(dealerHand);
  if (player.blackjack && dealer.blackjack) return settle(base, "push", "双方 Blackjack", "双方均以两张牌达到二十一点，本手和牌。", 1);
  if (player.blackjack) return settle(base, "player", "Blackjack", "两张牌正好二十一点，按 3:2 赔付。", 2.5);
  if (dealer.blackjack) return settle(base, "dealer", "庄家 Blackjack", "庄家以两张牌达到二十一点。", 0);
  return base;
}

export function canDouble(state: TwentyOneState): boolean {
  return state.phase === "player-turn"
    && state.playerHand.length === 2
    && !state.doubled
    && state.chips >= state.bet;
}

/** 加倍：再压等额筹码，只补一张，然后强制停牌。 */
export function playerDouble(state: TwentyOneState): TwentyOneState {
  if (!canDouble(state)) return state;
  const nextDraw = draw(state.deck);
  const playerHand = [...state.playerHand, nextDraw.card];
  const value = evaluateHand(playerHand);
  const doubled = appendEvent({
    ...state,
    deck: nextDraw.deck,
    playerHand,
    bet: state.bet * 2,
    chips: state.chips - state.bet,
    doubled: true,
  }, event(state.revision + 1, "player", "double", `你加倍并取得「${nextDraw.card.name}」。`, nextDraw.card));

  if (value.busted) return settle(doubled, "dealer", "你已爆牌", `加倍后点数达到 ${value.total}，超过二十一点。`, 0);
  return appendEvent(
    { ...doubled, phase: "dealer-turn", dealerRevealed: true },
    event(doubled.revision + 1, "player", "stand", "加倍后只补一张，庄家开始行动。"),
  );
}

/** 结算后开下一手：保留筹码与牌靴，回到下注阶段。 */
export function nextHand(state: TwentyOneState): TwentyOneState {
  if (state.phase !== "settled") return state;
  const handNumber = state.handNumber + 1;
  return appendEvent({
    ...state,
    phase: "betting",
    playerHand: [],
    dealerHand: [],
    dealerRevealed: false,
    outcome: undefined,
    reason: undefined,
    payout: undefined,
    bet: 0,
    doubled: false,
    handNumber,
  }, event(state.revision + 1, "table", "deal", `第 ${handNumber} 手。牌靴剩余 ${state.deck.length} 张。`));
}

export function playerHit(state: TwentyOneState): TwentyOneState {
  if (state.phase !== "player-turn") return state;
  const nextDraw = draw(state.deck);
  const playerHand = [...state.playerHand, nextDraw.card];
  const value = evaluateHand(playerHand);
  const nextEvent = event(state.revision + 1, "player", "hit", `你取得「${nextDraw.card.name}」。`, nextDraw.card);
  const next = appendEvent({ ...state, deck: nextDraw.deck, playerHand }, nextEvent);

  if (value.busted) return settle(next, "dealer", "你已爆牌", `你的点数达到 ${value.total}，超过二十一点。`, 0);
  if (value.total === 21) {
    const reveal = event(next.revision + 1, "player", "stand", "你达到二十一点，庄家开始行动。");
    return appendEvent({ ...next, phase: "dealer-turn", dealerRevealed: true }, reveal);
  }
  return next;
}

export function playerStand(state: TwentyOneState): TwentyOneState {
  if (state.phase !== "player-turn") return state;
  const nextEvent = event(state.revision + 1, "player", "stand", `你停在 ${evaluateHand(state.playerHand).total} 点，庄家翻开底牌。`);
  return appendEvent({ ...state, phase: "dealer-turn", dealerRevealed: true }, nextEvent);
}

export function dealerStep(state: TwentyOneState): TwentyOneState {
  if (state.phase !== "dealer-turn") return state;
  const dealerValue = evaluateHand(state.dealerHand);
  if (dealerValue.total >= 17) return compareHands(state);

  const nextDraw = draw(state.deck);
  const dealerHand = [...state.dealerHand, nextDraw.card];
  const nextEvent = event(state.revision + 1, "dealer", "hit", `庄家取得「${nextDraw.card.name}」。`, nextDraw.card);
  return appendEvent({ ...state, deck: nextDraw.deck, dealerHand }, nextEvent);
}
