import { describe, expect, it } from "vitest";
import { chooseAiMove } from "./ai";
import {
  INITIAL_MATCH,
  PLAYER_ORDER,
  advanceLevel,
  canBeat,
  changeDifficulty,
  classifyCombo,
  createDeck,
  createInitialState,
  generateLegalCombos,
  getPlayer,
  levelsForPartnerPlace,
  passTurn,
  playCards,
  startNextDeal,
} from "./engine";
import type { CardRank, GuandanCard, GuandanPlayer, GuandanState, MatchState, PlayerId, Suit } from "./types";

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
    match: INITIAL_MATCH,
    difficulty: "standard",
    log: [],
    ...overrides,
  };
}

/** 四家各持一张，按给定名次顺序依次走空，返回结算后的状态。 */
function playOutDeal(order: readonly PlayerId[], match: MatchState = INITIAL_MATCH): GuandanState {
  const hands = Object.fromEntries(PLAYER_ORDER.map((id) => [id, [card("3")]])) as Record<PlayerId, GuandanCard[]>;
  let game = state(PLAYER_ORDER.map((id) => player(id, hands[id])), { match, activePlayerId: order[0] });
  for (const id of order) {
    if (game.status !== "playing") break;
    game = playCards({ ...game, activePlayerId: id, trick: undefined }, id, [hands[id][0].id]);
  }
  return game;
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

  it("ranks bombs by size first, then rank, with the four-joker bomb on top", () => {
    const fourThrees = classifyCombo([card("3"), card("3", "clubs"), card("3", "diamonds"), card("3", "hearts")], "2")!;
    const fourAces = classifyCombo([card("A"), card("A", "clubs"), card("A", "diamonds"), card("A", "hearts")], "2")!;
    const fiveFours = classifyCombo([card("4"), card("4", "clubs"), card("4", "diamonds"), card("4", "hearts"), card("4", "spades")], "2")!;
    const jokerBomb = classifyCombo([
      card("small-joker", "joker"),
      card("small-joker", "joker"),
      card("big-joker", "joker"),
      card("big-joker", "joker"),
    ], "2")!;

    expect(canBeat(fiveFours, fourAces)).toBe(true);
    expect(canBeat(fourAces, fiveFours)).toBe(false);
    expect(canBeat(fourAces, fourThrees)).toBe(true);
    expect(canBeat(jokerBomb, fiveFours)).toBe(true);
    expect(canBeat(fiveFours, jokerBomb)).toBe(false);
  });

  it("rejects jokers in straights, duplicate ranks and wild-joker pairs", () => {
    expect(classifyCombo([card("3"), card("4"), card("5"), card("6"), card("small-joker")], "2")).toBeUndefined();
    expect(classifyCombo([card("3"), card("3", "clubs"), card("4"), card("5"), card("6")], "2")).toBeUndefined();
    expect(classifyCombo([card("small-joker", "joker"), card("2", "hearts")], "2")).toBeUndefined();
    expect(classifyCombo([card("3"), card("3", "clubs"), card("3", "diamonds"), card("3", "hearts"), card("9")], "2")).toBeUndefined();
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

  it("clears a trick without counting finished players as passers", () => {
    const eastLead = card("3");
    let game = state([
      { ...player("human", []), finishedPlace: 1 },
      player("east", [eastLead, card("K")]),
      player("partner", [card("4")]),
      player("west", [card("5")]),
    ], { activePlayerId: "east", finishOrder: ["human"] });
    game = playCards(game, "east", [eastLead.id]);
    game = passTurn(game, "partner");
    game = passTurn(game, "west");

    expect(game.trick).toBeUndefined();
    expect(game.activePlayerId).toBe("east");
    expect(getPlayer(game, "east").hand).toHaveLength(1);
  });

  it("hands the lead to the next active seat when the trick actor just finished", () => {
    const eastLast = card("3");
    let game = state([
      { ...player("human", []), finishedPlace: 1 },
      player("east", [eastLast]),
      player("partner", [card("4")]),
      player("west", [card("5")]),
    ], { activePlayerId: "east", finishOrder: ["human"] });
    game = playCards(game, "east", [eastLast.id]);
    expect(game.finishOrder).toEqual(["human", "east"]);
    game = passTurn(game, "partner");
    game = passTurn(game, "west");

    expect(game.trick).toBeUndefined();
    expect(game.activePlayerId).toBe("partner");
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

  it("takes a partner's trick when the play empties its own hand", () => {
    const last = card("A");
    const opening = classifyCombo([card("3")], "2")!;
    const game = state([
      { ...player("human", []), finishedPlace: 1 },
      player("east", [card("K")]),
      player("partner", [last]),
      player("west", [card("Q")]),
    ], {
      activePlayerId: "partner",
      trick: { actorId: "human", combo: opening },
      finishOrder: ["human"],
    });

    expect(chooseAiMove(game, "partner")).toEqual({ kind: "play", cardIds: [last.id] });
    expect(playCards(game, "partner", [last.id]).winner).toBe("vermillion");
  });

  it("still yields to a partner's trick when it cannot finish", () => {
    const opening = classifyCombo([card("3")], "2")!;
    const game = state([
      player("human", [card("5")]),
      player("east", [card("K")]),
      player("partner", [card("A"), card("9")]),
      player("west", [card("Q")]),
    ], {
      activePlayerId: "partner",
      trick: { actorId: "human", combo: opening },
    });

    expect(chooseAiMove(game, "partner")).toEqual({ kind: "pass" });
  });

  it("tactician difficulty passes instead of wasting a bomb when no opponent is close to finishing", () => {
    const opening = classifyCombo([card("8")], "2")!;
    const bomb = [card("3"), card("3", "clubs"), card("3", "diamonds"), card("3", "hearts")];
    const game = state([
      player("human", [...bomb, card("4"), card("5")]),
      player("east", [card("10"), card("J"), card("Q"), card("K")]),
      player("partner", [card("6"), card("7"), card("9"), card("10")]),
      player("west", [card("J"), card("Q"), card("K"), card("A")]),
    ], {
      activePlayerId: "human",
      trick: { actorId: "west", combo: opening },
    });

    const standard = chooseAiMove(game, "human", "standard");
    if (standard?.kind !== "play") throw new Error("expected a bomb play");
    expect(standard.cardIds).toHaveLength(4);
    expect(chooseAiMove(game, "human", "tactician")).toEqual({ kind: "pass" });
  });

  it("tactician difficulty breaks a bomb when an opponent is about to finish", () => {
    const opening = classifyCombo([card("8")], "2")!;
    const bomb = [card("3"), card("3", "clubs"), card("3", "diamonds"), card("3", "hearts")];
    const game = state([
      player("human", [...bomb, card("4"), card("5")]),
      player("east", [card("10"), card("J"), card("Q")]),
      player("partner", [card("6"), card("7"), card("9")]),
      player("west", [card("K")]),
    ], {
      activePlayerId: "human",
      trick: { actorId: "west", combo: opening },
    });

    const move = chooseAiMove(game, "human", "tactician");
    if (move?.kind !== "play") throw new Error("expected a bomb play");
    expect(move.cardIds).toHaveLength(4);
  });

  it("records difficulty changes and carries them into the next deal", () => {
    const initial = createInitialState(() => 0.37, "relaxed");
    expect(initial.difficulty).toBe("relaxed");
    const changed = changeDifficulty(initial, "tactician");
    expect(changed.difficulty).toBe("tactician");
    expect(changed.lastAction).toMatchObject({ type: "settings", text: "对手难度调整为「战术」。" });

    const finished = playOutDeal(["human", "partner"]);
    const withDifficulty = { ...finished, difficulty: "relaxed" as const };
    expect(startNextDeal(withDifficulty, () => 0.4).difficulty).toBe("relaxed");
  });

  it("awards levels by the head player's partner place, not by who empties first", () => {
    // 东座头游、西座末游：青岳方只升 1 级，即便朱雀两人先走空。
    const result = playOutDeal(["east", "human", "partner"]);
    expect(result.winner).toBe("indigo");
    expect(result.match.lastResult).toMatchObject({ winner: "indigo", partnerPlace: 4, gained: 1 });
    expect(result.match.levels.indigo).toBe("3");
    expect(result.match.levels.vermillion).toBe("2");
  });

  it("gives three levels for a double win", () => {
    const result = playOutDeal(["human", "partner"]);
    expect(result.winner).toBe("vermillion");
    expect(result.match.lastResult).toMatchObject({ partnerPlace: 2, gained: 3 });
    expect(result.match.levels.vermillion).toBe("5");
  });

  it("maps every partner place to its level gain and caps below A", () => {
    expect([2, 3, 4].map(levelsForPartnerPlace)).toEqual([3, 2, 1]);
    expect(advanceLevel("2", 3)).toEqual({ level: "5", champion: false });
    expect(advanceLevel("K", 3)).toEqual({ level: "A", champion: false });
    expect(advanceLevel("A", 1)).toEqual({ level: "A", champion: true });
  });

  it("ends the match only by winning a deal at level A", () => {
    const atAce: MatchState = { ...INITIAL_MATCH, levels: { vermillion: "A", indigo: "5" } };
    const result = playOutDeal(["human", "partner"], atAce);
    expect(result.match.champion).toBe("vermillion");
    expect(startNextDeal(result, () => 0.4)).toBe(result);
  });

  it("starts the next deal on the new level with the head player leading", () => {
    const finished = playOutDeal(["east", "west"]);
    expect(finished.match.levels.indigo).toBe("5");

    const next = startNextDeal(finished, () => 0.37);
    expect(next.status).toBe("playing");
    expect(next.levelRank).toBe("5");
    expect(next.activePlayerId).toBe("east");
    expect(next.match.dealNumber).toBe(2);
    expect(next.players.every((entry) => entry.hand.length === 27)).toBe(true);
    expect(next.players.every((entry) => entry.finishedPlace === undefined)).toBe(true);
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
