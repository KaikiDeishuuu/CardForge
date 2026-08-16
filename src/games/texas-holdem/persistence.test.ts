import { describe, expect, it } from "vitest";
import {
  applyTexasAction,
  createTexasState,
  getTexasLegalActions,
} from "./domain/engine";
import type { TexasState } from "./domain/types";
import {
  TEXAS_HOLDEM_SAVE_SCHEMA_VERSION,
  restoreTexasState,
  serializeTexasState,
} from "./persistence";

const fixedRandom = () => 0.42;

function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function checkDownToShowdown(initial: TexasState): TexasState {
  let state = initial;
  let guard = 0;
  while (state.status === "playing" && guard < 20) {
    guard += 1;
    const actor = state.activePlayerId!;
    const legal = getTexasLegalActions(state, actor);
    state = applyTexasAction(state, actor, legal.check ? { type: "check" } : { type: "call" });
  }
  return state;
}

describe("Texas Hold'em persistence", () => {
  it("round-trips playing and showdown states through JSON", () => {
    const playing = createTexasState(fixedRandom);
    const showdown = checkDownToShowdown(playing);

    expect(restoreTexasState(
      TEXAS_HOLDEM_SAVE_SCHEMA_VERSION,
      jsonCopy(serializeTexasState(playing)),
    )).toEqual(playing);
    expect(restoreTexasState(
      TEXAS_HOLDEM_SAVE_SCHEMA_VERSION,
      jsonCopy(serializeTexasState(showdown)),
    )).toEqual(showdown);
  });

  it("round-trips an unequal all-in with an unmatched-chip return", () => {
    let state = createTexasState(fixedRandom);
    state = {
      ...state,
      tableChipTotal: 800,
      players: state.players.map((player) => player.id === "east"
        ? { ...player, stack: 290 }
        : player),
    };
    state = applyTexasAction(state, "human", { type: "raise", to: 500 });
    state = applyTexasAction(state, "east", { type: "call" });

    expect(state.result?.pots.some((pot) => pot.eligiblePlayerIds.length === 1)).toBe(true);
    expect(restoreTexasState(
      TEXAS_HOLDEM_SAVE_SCHEMA_VERSION,
      jsonCopy(serializeTexasState(state)),
    )).toEqual(state);
  });

  it("rejects unknown schemas without interpreting their payload", () => {
    expect(restoreTexasState(99, createTexasState(fixedRandom))).toBeUndefined();
  });

  it("rejects duplicated cards and cross-field state corruption", () => {
    const initial = jsonCopy(createTexasState(fixedRandom));
    const duplicate: TexasState = {
      ...initial,
      deck: [initial.players[0].hole[0], ...initial.deck.slice(1)],
    };
    expect(restoreTexasState(TEXAS_HOLDEM_SAVE_SCHEMA_VERSION, duplicate)).toBeUndefined();

    const wrongActor: TexasState = {
      ...initial,
      activePlayerId: "east",
      players: initial.players.map((player) => player.id === "east" ? { ...player, allIn: true } : player),
    };
    expect(restoreTexasState(TEXAS_HOLDEM_SAVE_SCHEMA_VERSION, wrongActor)).toBeUndefined();

    const brokenLog: TexasState = {
      ...initial,
      lastAction: { ...initial.lastAction!, text: "tampered" },
    };
    expect(restoreTexasState(TEXAS_HOLDEM_SAVE_SCHEMA_VERSION, brokenLog)).toBeUndefined();

    const brokenChipAccounting: TexasState = {
      ...initial,
      tableChipTotal: initial.tableChipTotal + 1,
    };
    expect(restoreTexasState(TEXAS_HOLDEM_SAVE_SCHEMA_VERSION, brokenChipAccounting)).toBeUndefined();

    const settled = applyTexasAction(initial, "human", { type: "fold" });
    const brokenSettledChips: TexasState = {
      ...settled,
      tableChipTotal: settled.tableChipTotal + 1,
    };
    expect(restoreTexasState(TEXAS_HOLDEM_SAVE_SCHEMA_VERSION, brokenSettledChips)).toBeUndefined();
  });

  it("rejects a showdown whose declared winner or summary contradicts the cards", () => {
    const showdown = jsonCopy(checkDownToShowdown(createTexasState(fixedRandom)));
    const wrongWinner: TexasState = {
      ...showdown,
      result: {
        ...showdown.result!,
        winnerIds: showdown.result!.winnerIds.includes("human") ? ["east"] : ["human"],
      },
    };
    expect(restoreTexasState(TEXAS_HOLDEM_SAVE_SCHEMA_VERSION, wrongWinner)).toBeUndefined();

    const wrongSummary: TexasState = {
      ...showdown,
      result: { ...showdown.result!, summary: "tampered result" },
    };
    expect(restoreTexasState(TEXAS_HOLDEM_SAVE_SCHEMA_VERSION, wrongSummary)).toBeUndefined();
  });
});
