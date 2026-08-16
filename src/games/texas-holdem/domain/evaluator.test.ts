import { describe, expect, it } from "vitest";
import { compareEvaluatedHands, evaluateFiveCardHand, evaluateTexasHand } from "./evaluator";
import type { TexasCard, TexasRank, TexasSuit } from "./types";

let cardIndex = 0;
function card(rank: TexasRank, suit: TexasSuit): TexasCard {
  cardIndex += 1;
  return { id: `test-${cardIndex}`, name: `${suit}-${rank}`, rank, suit };
}

describe("Texas hand evaluator", () => {
  it("recognizes all hand categories in strength order", () => {
    const hands = [
      [card("A", "spades"), card("K", "hearts"), card("9", "clubs"), card("6", "diamonds"), card("3", "spades")],
      [card("A", "spades"), card("A", "hearts"), card("9", "clubs"), card("6", "diamonds"), card("3", "spades")],
      [card("A", "spades"), card("A", "hearts"), card("9", "clubs"), card("9", "diamonds"), card("3", "spades")],
      [card("A", "spades"), card("A", "hearts"), card("A", "clubs"), card("9", "diamonds"), card("3", "spades")],
      [card("9", "spades"), card("8", "hearts"), card("7", "clubs"), card("6", "diamonds"), card("5", "spades")],
      [card("A", "hearts"), card("J", "hearts"), card("8", "hearts"), card("5", "hearts"), card("2", "hearts")],
      [card("A", "spades"), card("A", "hearts"), card("A", "clubs"), card("9", "diamonds"), card("9", "spades")],
      [card("A", "spades"), card("A", "hearts"), card("A", "clubs"), card("A", "diamonds"), card("9", "spades")],
      [card("9", "hearts"), card("8", "hearts"), card("7", "hearts"), card("6", "hearts"), card("5", "hearts")],
    ].map(evaluateFiveCardHand);

    expect(hands.map((hand) => hand.category)).toEqual([
      "high-card", "pair", "two-pair", "three-kind", "straight", "flush", "full-house", "four-kind", "straight-flush",
    ]);
    for (let index = 1; index < hands.length; index += 1) {
      expect(compareEvaluatedHands(hands[index], hands[index - 1])).toBe(1);
    }
  });

  it("supports the wheel straight and ranks it below a six-high straight", () => {
    const wheel = evaluateFiveCardHand([
      card("A", "spades"), card("5", "hearts"), card("4", "clubs"), card("3", "diamonds"), card("2", "spades"),
    ]);
    const sixHigh = evaluateFiveCardHand([
      card("6", "spades"), card("5", "hearts"), card("4", "clubs"), card("3", "diamonds"), card("2", "spades"),
    ]);

    expect(wheel.category).toBe("straight");
    expect(wheel.tiebreak).toEqual([5]);
    expect(compareEvaluatedHands(sixHigh, wheel)).toBe(1);
  });

  it("chooses the best five cards from seven and compares kickers", () => {
    const acesFull = evaluateTexasHand([
      card("A", "spades"), card("A", "hearts"), card("A", "clubs"),
      card("K", "spades"), card("K", "hearts"), card("K", "clubs"), card("2", "diamonds"),
    ]);
    const queensKicker = evaluateTexasHand([
      card("J", "spades"), card("J", "hearts"), card("Q", "clubs"),
      card("9", "spades"), card("7", "hearts"), card("4", "clubs"), card("2", "diamonds"),
    ]);
    const tensKicker = evaluateTexasHand([
      card("J", "clubs"), card("J", "diamonds"), card("10", "clubs"),
      card("9", "hearts"), card("7", "spades"), card("4", "diamonds"), card("2", "clubs"),
    ]);

    expect(acesFull.category).toBe("full-house");
    expect(acesFull.tiebreak).toEqual([14, 13]);
    expect(compareEvaluatedHands(queensKicker, tensKicker)).toBe(1);
  });

  it("returns an exact tie when the board supplies the best five cards", () => {
    const board = [
      card("A", "hearts"), card("K", "hearts"), card("Q", "hearts"), card("J", "hearts"), card("10", "hearts"),
    ];
    const first = evaluateTexasHand([...board, card("2", "clubs"), card("3", "clubs")]);
    const second = evaluateTexasHand([...board, card("9", "spades"), card("8", "spades")]);
    expect(compareEvaluatedHands(first, second)).toBe(0);
  });
});
