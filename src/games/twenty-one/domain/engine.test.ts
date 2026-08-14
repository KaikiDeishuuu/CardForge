import { describe, expect, it } from "vitest";
import {
  STARTING_CHIPS,
  availableBets,
  canDouble,
  createDeck,
  createInitialState,
  dealerStep,
  evaluateHand,
  nextHand,
  placeBet,
  playerDouble,
  playerHit,
  playerStand,
} from "./engine";
import type { PlayingCard, Rank, Suit, TwentyOneState } from "./types";

function card(rank: Rank, suit: Suit = "spades"): PlayingCard {
  return { id: `${suit}-${rank}-test`, name: `${suit} ${rank}`, rank, suit };
}

function state(overrides: Partial<TwentyOneState> = {}): TwentyOneState {
  return {
    revision: 0,
    phase: "player-turn",
    deck: [card("5", "clubs"), card("4", "diamonds")],
    playerHand: [card("10"), card("6", "hearts")],
    dealerHand: [card("10", "clubs"), card("6", "diamonds")],
    dealerRevealed: false,
    chips: 100,
    bet: 50,
    doubled: false,
    handNumber: 1,
    log: [],
    ...overrides,
  };
}

/**
 * 把牌靴排成已知发牌顺序。draw 从末尾取，所以倒序放在末端；
 * 另外垫足底牌，避免 placeBet 因牌靴过薄而换牌。
 */
function stackedDeck(...cards: readonly PlayingCard[]): PlayingCard[] {
  const filler = Array.from({ length: 24 }, () => card("9", "clubs"));
  return [...filler, ...[...cards].reverse()];
}

describe("Twenty One engine", () => {
  it("opens on the betting phase with a full shoe and no cards dealt", () => {
    expect(new Set(createDeck().map((entry) => entry.id)).size).toBe(52);
    const initial = createInitialState(() => 0.37);
    expect(initial.phase).toBe("betting");
    expect(initial.deck).toHaveLength(52);
    expect(initial.playerHand).toEqual([]);
    expect(initial.chips).toBe(STARTING_CHIPS);
    expect(initial.bet).toBe(0);
  });

  it("deals both hands and escrows the stake when a bet is placed", () => {
    const dealt = placeBet(createInitialState(() => 0.37), 50);
    expect(dealt.phase).toBe("player-turn");
    expect(dealt.playerHand).toHaveLength(2);
    expect(dealt.dealerHand).toHaveLength(2);
    expect(dealt.deck).toHaveLength(48);
    expect(dealt.bet).toBe(50);
    expect(dealt.chips).toBe(STARTING_CHIPS - 50);
  });

  it("refuses a bet outside the betting phase or beyond the stack", () => {
    const initial = createInitialState(() => 0.37);
    expect(placeBet(initial, 0)).toBe(initial);
    expect(placeBet(initial, 37)).toBe(initial);
    expect(placeBet(initial, STARTING_CHIPS + 10)).toBe(initial);
    expect(placeBet(placeBet(initial, 25), 25).bet).toBe(25);
    expect(availableBets({ ...initial, chips: 30 })).toEqual([10, 25]);
  });

  it("pays a natural blackjack at three to two", () => {
    const shoe = stackedDeck(card("A"), card("10", "clubs"), card("K"), card("6", "diamonds"));
    const settled = placeBet({ ...createInitialState(() => 0.5), deck: shoe, chips: 200 }, 25);

    expect(settled.phase).toBe("settled");
    expect(settled.outcome).toBe("player");
    expect(settled.reason).toBe("Blackjack");
    // 200 - 25 押注，再连本带利退回 62.5（25 × 2.5）。
    expect(settled.chips).toBe(237.5);
    expect(settled.payout).toBe(37.5);
  });

  it("settles a dealer natural before the player can act", () => {
    const settled = placeBet(
      { ...createInitialState(() => 0.37), deck: stackedDeck(card("9"), card("K", "clubs"), card("7"), card("A", "clubs")) },
      25,
    );
    expect(settled.phase).toBe("settled");
    expect(settled.outcome).toBe("dealer");
    expect(settled.reason).toBe("庄家 Blackjack");
  });

  it("pushes when both hands are natural blackjacks", () => {
    const settled = placeBet(
      { ...createInitialState(() => 0.37), deck: stackedDeck(card("A"), card("K", "clubs"), card("10", "hearts"), card("A", "diamonds")) },
      25,
    );
    expect(settled.phase).toBe("settled");
    expect(settled.outcome).toBe("push");
    expect(settled.chips).toBe(STARTING_CHIPS);
  });

  it("returns the stake on a push and keeps it on a loss", () => {
    const push = placeBet(
      { ...createInitialState(() => 0.5), deck: stackedDeck(card("A"), card("A", "clubs"), card("K"), card("K", "clubs")), chips: 200 },
      50,
    );
    expect(push.outcome).toBe("push");
    expect(push.chips).toBe(200);
    expect(push.payout).toBe(0);

    const bust = playerHit(state({ playerHand: [card("K"), card("Q")], deck: [card("5")], chips: 100, bet: 50 }));
    expect(bust.outcome).toBe("dealer");
    expect(bust.chips).toBe(100);
    expect(bust.payout).toBe(-50);
  });

  it("doubles the stake, draws exactly one card and forces the dealer's turn", () => {
    const doubled = playerDouble(state({
      playerHand: [card("6"), card("5")],
      deck: [card("9", "diamonds")],
      chips: 100,
      bet: 50,
    }));

    expect(doubled.bet).toBe(100);
    expect(doubled.chips).toBe(50);
    expect(doubled.doubled).toBe(true);
    expect(doubled.playerHand).toHaveLength(3);
    expect(doubled.phase).toBe("dealer-turn");
    expect(canDouble(doubled)).toBe(false);
  });

  it("loses the doubled stake when the double card busts", () => {
    // 9 + 3 = 12：补到 10/J/Q/K 才会爆牌，两牌 11 点补任何牌都不可能爆。
    const dealt = placeBet(
      { ...createInitialState(() => 0.37), deck: stackedDeck(card("9"), card("3", "clubs"), card("3", "hearts"), card("4", "diamonds"), card("K", "hearts")) },
      25,
    );
    expect(dealt.phase).toBe("player-turn");
    const doubled = playerDouble(dealt);
    expect(doubled.phase).toBe("settled");
    expect(doubled.outcome).toBe("dealer");
    expect(doubled.bet).toBe(50);
    expect(doubled.chips).toBe(450);
    expect(doubled.payout).toBe(-50);
  });

  it("only offers a double on the opening two cards with chips to cover it", () => {
    expect(canDouble(state({ playerHand: [card("6"), card("5")], chips: 100, bet: 50 }))).toBe(true);
    expect(canDouble(state({ playerHand: [card("6"), card("5")], chips: 10, bet: 50 }))).toBe(false);
    expect(canDouble(state({ playerHand: [card("6"), card("5"), card("2")], chips: 100, bet: 50 }))).toBe(false);
    expect(canDouble(state({ phase: "betting" }))).toBe(false);
  });

  it("carries chips and the shoe into the next hand", () => {
    const settled = playerHit(state({
      playerHand: [card("K"), card("Q")],
      deck: [card("5"), card("7", "clubs"), card("8", "clubs")],
      chips: 100,
      bet: 50,
    }));
    const next = nextHand(settled);

    expect(next.phase).toBe("betting");
    expect(next.handNumber).toBe(2);
    expect(next.chips).toBe(settled.chips);
    expect(next.deck).toEqual(settled.deck);
    expect(next.playerHand).toEqual([]);
    expect(next.bet).toBe(0);
    expect(next.outcome).toBeUndefined();
    expect(nextHand(next)).toBe(next);
  });

  it("scores aces as one or eleven and detects natural blackjack", () => {
    expect(evaluateHand([card("A"), card("K")])).toEqual({ total: 21, soft: true, blackjack: true, busted: false });
    expect(evaluateHand([card("A"), card("9"), card("8")])).toMatchObject({ total: 18, soft: false, busted: false });
    expect(evaluateHand([card("K"), card("Q"), card("2")]).busted).toBe(true);
  });

  it("lets the player hit and automatically yields at twenty-one", () => {
    const hit = playerHit(state({ playerHand: [card("10"), card("7")], deck: [card("4")] }));
    expect(evaluateHand(hit.playerHand).total).toBe(21);
    expect(hit.phase).toBe("dealer-turn");
    expect(hit.dealerRevealed).toBe(true);
  });

  it("settles immediately when the player busts", () => {
    const busted = playerHit(state({ playerHand: [card("K"), card("Q")], deck: [card("5")] }));
    expect(busted.phase).toBe("settled");
    expect(busted.outcome).toBe("dealer");
    expect(busted.reason).toBe("你已爆牌");
  });

  it("reveals the dealer when the player stands", () => {
    const stood = playerStand(state());
    expect(stood.phase).toBe("dealer-turn");
    expect(stood.dealerRevealed).toBe(true);
  });

  it("makes the dealer hit below seventeen and stand on soft seventeen", () => {
    const hit = dealerStep(state({
      phase: "dealer-turn",
      dealerRevealed: true,
      dealerHand: [card("10"), card("6")],
      deck: [card("3")],
    }));
    expect(evaluateHand(hit.dealerHand).total).toBe(19);
    expect(hit.phase).toBe("dealer-turn");
    expect(dealerStep(hit).phase).toBe("settled");

    const softSeventeen = dealerStep(state({
      phase: "dealer-turn",
      dealerRevealed: true,
      playerHand: [card("10"), card("7", "hearts")],
      dealerHand: [card("A"), card("6", "clubs")],
    }));
    expect(softSeventeen.phase).toBe("settled");
    expect(softSeventeen.outcome).toBe("push");
  });

  it("wins when the dealer busts", () => {
    const dealt = placeBet(
      { ...createInitialState(() => 0.37), deck: stackedDeck(card("10"), card("2", "clubs"), card("10", "hearts"), card("6", "diamonds"), card("7", "clubs"), card("7", "hearts")) },
      25,
    );
    let turn = playerStand(dealt);
    turn = dealerStep(turn);
    turn = dealerStep(turn);
    turn = dealerStep(turn);
    expect(turn.phase).toBe("settled");
    expect(turn.outcome).toBe("player");
    expect(turn.reason).toBe("庄家爆牌");
  });

  it("reshuffles a fresh shoe when fewer than twenty cards remain", () => {
    const initial = createInitialState(() => 0.37);
    const thin = { ...initial, deck: initial.deck.slice(0, 19) };
    const dealt = placeBet(thin, 25, () => 0.37);
    expect(dealt.deck).toHaveLength(48);
  });

  it("compares final totals and rejects actions outside their phase", () => {
    const dealerTurn = state({
      phase: "dealer-turn",
      dealerRevealed: true,
      playerHand: [card("10"), card("9")],
      dealerHand: [card("10", "clubs"), card("8")],
    });
    const result = dealerStep(dealerTurn);
    expect(result.outcome).toBe("player");
    expect(playerHit(dealerTurn)).toBe(dealerTurn);
    expect(playerStand({ ...result, phase: "settled" })).toEqual({ ...result, phase: "settled" });
  });
});
