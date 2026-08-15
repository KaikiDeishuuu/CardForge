import { describe, expect, it } from "vitest";
import { STANDARD_SIX_RULES, createDefaultRootState, rememberBet, startClassicSession } from "./session";
import {
  TWENTY_ONE_SAVE_SCHEMA_VERSION,
  restoreTwentyOneRootState,
  serializeTwentyOneRootState,
} from "./persistence";
import type { PlayingCard, TwentyOneState } from "./types";

function card(rank: PlayingCard["rank"], id: string = rank): PlayingCard {
  return { id: `test-${id}`, name: `黑桃 ${rank}`, rank, suit: "spades" };
}

function table(overrides: Partial<TwentyOneState> = {}): TwentyOneState {
  return {
    revision: 4,
    phase: "player-turn",
    rules: STANDARD_SIX_RULES,
    deck: [card("2"), card("3")],
    dealerHand: [card("10", "dealer-10"), card("6", "dealer-6")],
    dealerRevealed: false,
    hands: [{
      id: "h1",
      cards: [card("8", "first-8"), card("8", "second-8")],
      wager: 25,
      status: "playing",
      fromSplit: false,
      splitAces: false,
      doubled: false,
    }],
    activeHandIndex: 0,
    baseBet: 25,
    insurance: { status: "not-offered", wager: 0 },
    chips: 475,
    handNumber: 1,
    log: [{ id: 4, actor: "player", type: "bet", text: "你压下 25 枚筹码。" }],
    lastEvent: { id: 4, actor: "player", type: "bet", text: "你压下 25 枚筹码。" },
    ...overrides,
  };
}

function legacy(overrides: Record<string, unknown> = {}): unknown {
  return {
    revision: 3,
    phase: "player-turn",
    deck: [card("2"), card("3")],
    playerHand: [card("10", "player-10"), card("6", "player-6")],
    dealerHand: [card("10", "dealer-10"), card("6", "dealer-6")],
    dealerRevealed: false,
    chips: 475,
    bet: 25,
    doubled: false,
    handNumber: 2,
    log: [{ id: 3, actor: "player", type: "bet", text: "旧牌局" }],
    lastEvent: { id: 3, actor: "player", type: "bet", text: "旧牌局" },
    ...overrides,
  };
}

describe("Twenty One persistence", () => {
  it("round-trips the v2 profile, archive and active session", () => {
    const root = startClassicSession(createDefaultRootState(), table());
    const restored = restoreTwentyOneRootState(
      TWENTY_ONE_SAVE_SCHEMA_VERSION,
      JSON.parse(JSON.stringify(serializeTwentyOneRootState(root))),
    );
    expect(restored).toEqual(root);
  });

  it("round-trips the remembered last bet and still accepts saves without one", () => {
    const root = rememberBet(startClassicSession(createDefaultRootState(), table()), 50);
    const restored = restoreTwentyOneRootState(
      TWENTY_ONE_SAVE_SCHEMA_VERSION,
      JSON.parse(JSON.stringify(serializeTwentyOneRootState(root))),
    );
    expect(restored?.preferences.lastBet).toBe(50);

    const data = JSON.parse(JSON.stringify(serializeTwentyOneRootState(root))) as Record<string, unknown>;
    const preferences = data.preferences as Record<string, unknown>;
    delete preferences.lastBet;
    const legacyShape = restoreTwentyOneRootState(TWENTY_ONE_SAVE_SCHEMA_VERSION, data);
    expect(legacyShape?.preferences.lastBet).toBeUndefined();
  });

  it("migrates a v1 hand into a legacy classic session without inventing statistics", () => {
    const restored = restoreTwentyOneRootState(1, legacy());
    expect(restored?.preferences).toMatchObject({
      assistEnabled: false,
      rules: {
        deckCount: 6,
        dealerSoft17: "stand",
        blackjackPayout: "3:2",
        maxPlayerHands: 4,
        allowInsurance: true,
        allowLateSurrender: true,
      },
    });
    expect(restored?.activeSession?.table.rules).toMatchObject({
      deckCount: 1,
      maxPlayerHands: 1,
      allowInsurance: false,
      allowLateSurrender: false,
    });
    expect(restored?.lifetimeStats.roundsPlayed).toBe(0);
    expect(restored?.activeSession).toMatchObject({ mode: "classic", roundsCompleted: 0, status: "playing" });
    expect(restored?.activeSession?.sessionStats.peakChips).toBe(475);
    expect(restored?.activeSession?.table.hands[0]).toMatchObject({ wager: 25, status: "playing", fromSplit: false });
    expect(restored?.activeSession?.table.chips).toBe(475);
  });

  it("migrates a settled doubled v1 hand but marks its settlement consumed", () => {
    const restored = restoreTwentyOneRootState(1, legacy({
      revision: 8,
      phase: "settled",
      doubled: true,
      bet: 50,
      chips: 550,
      outcome: "player",
      reason: "点数领先",
      payout: 50,
      dealerRevealed: true,
    }));
    expect(restored?.activeSession?.table.baseBet).toBe(25);
    expect(restored?.activeSession?.table.hands[0].wager).toBe(50);
    expect(restored?.activeSession?.table.settlement).toMatchObject({ totalWagered: 50, net: 50 });
    expect(restored?.activeSession?.consumedSettlementRevision).toBe(8);
    expect(restored?.lifetimeStats.roundsPlayed).toBe(0);
  });

  it("strictly rejects malformed roots, tables and unknown versions", () => {
    const valid = startClassicSession(createDefaultRootState(), table());
    expect(restoreTwentyOneRootState(99, valid)).toBeUndefined();
    expect(restoreTwentyOneRootState(2, undefined)).toBeUndefined();
    expect(restoreTwentyOneRootState(2, { ...valid, lifetimeStats: { roundsPlayed: 1 } })).toBeUndefined();
    expect(restoreTwentyOneRootState(2, {
      ...valid,
      activeSession: { ...valid.activeSession, table: table({ activeHandIndex: 9 }) },
    })).toBeUndefined();
    expect(restoreTwentyOneRootState(1, legacy({ deck: [{}] }))).toBeUndefined();
    expect(restoreTwentyOneRootState(1, legacy({ chips: -1 }))).toBeUndefined();
    expect(restoreTwentyOneRootState(1, legacy({ phase: "betting" }))).toBeUndefined();
    expect(restoreTwentyOneRootState(1, legacy({ phase: "settled", outcome: undefined }))).toBeUndefined();
    expect(restoreTwentyOneRootState(2, {
      ...valid,
      activeSession: {
        ...valid.activeSession,
        table: table({ phase: "insurance", hands: [], dealerHand: [], activeHandIndex: null, insurance: { status: "offered", wager: 0 } }),
      },
    })).toBeUndefined();
    expect(restoreTwentyOneRootState(2, {
      ...valid,
      activeSession: {
        ...valid.activeSession,
        table: table({ phase: "dealer-turn", deck: [], activeHandIndex: null, dealerRevealed: true, hands: [{ ...table().hands[0], status: "stood" }] }),
      },
    })).toBeUndefined();
  });

  it("rejects inconsistent settlement amounts and consumption metadata", () => {
    const settled = {
      outcome: "player",
      handResults: [{ handId: "h1", outcome: "win", wager: 25, returned: 50, net: 25, reason: "领先" }],
      insurance: { status: "not-offered", wager: 0, returned: 0, net: 0 },
      totalWagered: 25,
      returned: 50,
      net: 25,
      reason: "领先",
    } as const;
    const settledTable = table({
      revision: 8,
      phase: "settled",
      activeHandIndex: null,
      dealerRevealed: true,
      hands: [{ ...table().hands[0], status: "stood" }],
      settlement: settled,
      insurance: { status: "not-offered", wager: 0 },
      chips: 525,
    });
    const root = startClassicSession(createDefaultRootState(), table());
    const consumed = {
      ...root,
      activeSession: {
        ...root.activeSession,
        table: settledTable,
        roundsCompleted: 1,
        sessionStats: { ...root.activeSession!.sessionStats, roundsPlayed: 1 },
        consumedSettlementRevision: 8,
      },
    };
    expect(restoreTwentyOneRootState(2, consumed)).toBeDefined();
    expect(restoreTwentyOneRootState(2, {
      ...consumed,
      activeSession: { ...consumed.activeSession, consumedSettlementRevision: 7 },
    })).toBeUndefined();
    expect(restoreTwentyOneRootState(2, {
      ...consumed,
      activeSession: {
        ...consumed.activeSession,
        table: { ...settledTable, settlement: { ...settled, net: 30 } },
      },
    })).toBeUndefined();
  });
});
