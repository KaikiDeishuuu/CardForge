import { describe, expect, it } from "vitest";
import { createDeck, createInitialState, dealerStep, evaluateHand, playerHit, playerStand } from "./engine";
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
    log: [],
    ...overrides,
  };
}

describe("Twenty One engine", () => {
  it("creates a unique 52-card deck and deals two cards each", () => {
    expect(new Set(createDeck().map((entry) => entry.id)).size).toBe(52);
    const initial = createInitialState(() => 0.37);
    expect(initial.playerHand).toHaveLength(2);
    expect(initial.dealerHand).toHaveLength(2);
    expect(initial.deck).toHaveLength(48);
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
