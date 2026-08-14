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

function settle(
  state: TwentyOneState,
  outcome: TwentyOneOutcome,
  reason: string,
  text: string,
): TwentyOneState {
  const nextEvent = event(state.revision + 1, "table", "settle", text);
  return appendEvent({
    ...state,
    phase: "settled",
    dealerRevealed: true,
    outcome,
    reason,
  }, nextEvent);
}

function compareHands(state: TwentyOneState): TwentyOneState {
  const player = evaluateHand(state.playerHand);
  const dealer = evaluateHand(state.dealerHand);
  if (dealer.busted) return settle(state, "player", "庄家爆牌", "庄家超过二十一点，你赢得本局。");
  if (player.total > dealer.total) return settle(state, "player", "点数领先", `${player.total} 对 ${dealer.total}，你更接近二十一点。`);
  if (dealer.total > player.total) return settle(state, "dealer", "庄家领先", `${dealer.total} 对 ${player.total}，庄家赢得本局。`);
  return settle(state, "push", "点数相同", `双方同为 ${player.total} 点，本局和牌。`);
}

export function createInitialState(random: () => number = Math.random): TwentyOneState {
  let deck: readonly PlayingCard[] = shuffled(createDeck(), random);
  const playerHand: PlayingCard[] = [];
  const dealerHand: PlayingCard[] = [];

  for (let deal = 0; deal < 2; deal += 1) {
    const playerDraw = draw(deck);
    playerHand.push(playerDraw.card);
    deck = playerDraw.deck;
    const dealerDraw = draw(deck);
    dealerHand.push(dealerDraw.card);
    deck = dealerDraw.deck;
  }

  const base: TwentyOneState = {
    revision: 0,
    phase: "player-turn",
    deck,
    playerHand,
    dealerHand,
    dealerRevealed: false,
    log: [event(0, "table", "deal", "牌桌就绪。先观察点数，再决定是否要牌。")],
  };

  const player = evaluateHand(playerHand);
  const dealer = evaluateHand(dealerHand);
  if (player.blackjack && dealer.blackjack) return settle(base, "push", "双方 Blackjack", "双方均以两张牌达到二十一点，本局和牌。");
  if (player.blackjack) return settle(base, "player", "Blackjack", "两张牌正好二十一点，你赢得本局。");
  if (dealer.blackjack) return settle(base, "dealer", "庄家 Blackjack", "庄家以两张牌达到二十一点。");
  return base;
}

export function playerHit(state: TwentyOneState): TwentyOneState {
  if (state.phase !== "player-turn") return state;
  const nextDraw = draw(state.deck);
  const playerHand = [...state.playerHand, nextDraw.card];
  const value = evaluateHand(playerHand);
  const nextEvent = event(state.revision + 1, "player", "hit", `你取得「${nextDraw.card.name}」。`, nextDraw.card);
  const next = appendEvent({ ...state, deck: nextDraw.deck, playerHand }, nextEvent);

  if (value.busted) return settle(next, "dealer", "你已爆牌", `你的点数达到 ${value.total}，超过二十一点。`);
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
