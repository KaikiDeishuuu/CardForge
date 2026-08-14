import { describe, expect, it } from "vitest";
import { chooseAiMove } from "./ai";
import {
  canBeat,
  classifyCombo,
  createDeck,
  createInitialState,
  generateLegalCombos,
  passTurn,
  playCards,
} from "./engine";
import type { CardRank, GuandanCard, GuandanPlayer, GuandanState, PlayerId, Suit } from "./types";

let cardIndex = 0;
function card(rank: CardRank, suit: Suit = "spades"): GuandanCard {
  cardIndex += 1;
  return { id: `test-${cardIndex}`, name: `${suit} ${rank}`, rank, suit, deckIndex: 0 };
}

function player(id: PlayerId, hand: readonly GuandanCard[]): GuandanPlayer {
  return {
    id,
    displayName: id,
    controller: id === "human" ? "human" : "ai",
    team: id === "human" || id === "partner" ? "vermillion" : "indigo",
    hand,
  };
}

function state(players: readonly GuandanPlayer[], overrides: Partial<GuandanState> = {}): GuandanState {
  return {
    revision: 0,
    status: "playing",
    levelRank: "2",
    players,
    activePlayerId: "human",
    consecutivePasses: 0,
    finishOrder: [],
    log: [],
    ...overrides,
  };
}

describe("Guandan engine", () => {
  it("creates a unique double deck and deals 27 cards to every seat", () => {
    expect(createDeck()).toHaveLength(108);
    expect(new Set(createDeck().map((entry) => entry.id)).size).toBe(108);
    const initial = createInitialState(() => 0.37);
    expect(initial.players.map((entry) => entry.hand.length)).toEqual([27, 27, 27, 27]);
  });

  it("classifies the supported card families", () => {
    expect(classifyCombo([card("3")], "2")?.type).toBe("single");
    expect(classifyCombo([card("4"), card("4", "clubs")], "2")?.type).toBe("pair");
    expect(classifyCombo([card("5"), card("5", "clubs"), card("5", "diamonds")], "2")?.type).toBe("triple");
    expect(classifyCombo([card("6"), card("6", "clubs"), card("6", "diamonds"), card("9"), card("9", "clubs")], "2")?.type).toBe("full-house");
    expect(classifyCombo([card("3"), card("4"), card("5"), card("6"), card("7")], "2")?.type).toBe("straight");
    expect(classifyCombo([card("8"), card("8", "clubs"), card("8", "diamonds"), card("8", "hearts")], "2")?.type).toBe("bomb");
  });

  it("uses the heart level card as a wildcard", () => {
    const wild = card("2", "hearts");
    expect(classifyCombo([card("Q"), wild], "2")?.type).toBe("pair");
    expect(classifyCombo([card("4"), card("5"), card("6"), card("7"), wild], "2")?.type).toBe("straight");
    expect(classifyCombo([card("10"), card("10", "clubs"), card("K"), card("K", "clubs"), wild], "2")?.type).toBe("full-house");
  });

  it("compares equal card families and lets bombs cross family boundaries", () => {
    const lowPair = classifyCombo([card("5"), card("5", "clubs")], "2")!;
    const highPair = classifyCombo([card("Q"), card("Q", "clubs")], "2")!;
    const triple = classifyCombo([card("6"), card("6", "clubs"), card("6", "diamonds")], "2")!;
    const bomb = classifyCombo([card("3"), card("3", "clubs"), card("3", "diamonds"), card("3", "hearts")], "2")!;
    expect(canBeat(highPair, lowPair)).toBe(true);
    expect(canBeat(triple, lowPair)).toBe(false);
    expect(canBeat(bomb, highPair)).toBe(true);
  });

  it("plays a legal combo, removes cards and rotates to the next seat", () => {
    const pair = [card("7"), card("7", "clubs")];
    const game = state([
      player("human", [...pair, card("9")]),
      player("east", [card("8")]),
      player("partner", [card("10")]),
      player("west", [card("J")]),
    ]);
    const next = playCards(game, "human", pair.map((entry) => entry.id));
    expect(next.activePlayerId).toBe("east");
    expect(next.trick?.combo.type).toBe("pair");
    expect(next.players[0].hand).toHaveLength(1);
  });

  it("clears the trick after the other three seats pass", () => {
    const opening = card("9");
    let game = state([
      player("human", [opening, card("10")]),
      player("east", [card("3")]),
      player("partner", [card("4")]),
      player("west", [card("5")]),
    ]);
    game = playCards(game, "human", [opening.id]);
    game = passTurn(game, "east");
    game = passTurn(game, "partner");
    game = passTurn(game, "west");
    expect(game.trick).toBeUndefined();
    expect(game.activePlayerId).toBe("human");
  });

  it("declares a winner when both partners finish", () => {
    const finalCard = card("A");
    const game = state([
      player("human", [finalCard]),
      { ...player("east", [card("3")]) },
      { ...player("partner", []), finishedPlace: 1 },
      player("west", [card("4")]),
    ], { finishOrder: ["partner"] });
    const result = playCards(game, "human", [finalCard.id]);
    expect(result.status).toBe("finished");
    expect(result.winner).toBe("vermillion");
  });

  it("generates legal responses and the AI can choose a move", () => {
    const opening = classifyCombo([card("8")], "2")!;
    const game = state([
      player("human", [card("9"), card("4")]),
      player("east", [card("3")]),
      player("partner", [card("5")]),
      player("west", [card("6")]),
    ], { trick: { actorId: "west", combo: opening } });
    expect(generateLegalCombos(game, "human").every((entry) => entry.power > opening.power)).toBe(true);
    expect(chooseAiMove(game, "human")?.kind).toBe("play");
  });

  it("can complete a deterministic four-seat game using only AI decisions", () => {
    let game = createInitialState(() => 0.37);
    let actions = 0;
    while (game.status === "playing" && actions < 1_500) {
      const actorId = game.activePlayerId;
      const move = chooseAiMove(game, actorId);
      game = move?.kind === "play"
        ? playCards(game, actorId, move.cardIds)
        : passTurn(game, actorId);
      actions += 1;
    }
    expect(game.status).toBe("finished");
    expect(game.winner).toBeDefined();
    expect(actions).toBeLessThan(1_500);
  });
});
