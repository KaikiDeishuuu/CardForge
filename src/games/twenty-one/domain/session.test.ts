import { describe, expect, it } from "vitest";
import {
  CHALLENGES,
  HIGH_PRESSURE_EIGHT_RULES,
  SINGLE_DECK_RULES,
  STANDARD_SIX_RULES,
  addSettlementToStats,
  createDefaultRootState,
  createEmptyStats,
  getChallengeVerdict,
  identifyRulesPreset,
  markHintUsed,
  resetArchive,
  retryActiveSession,
  startChallengeSession,
  startClassicSession,
  returnToModeSelect,
  updateActiveTable,
} from "./session";
import type { TwentyOneSettlement, TwentyOneState } from "./types";

const settlement: TwentyOneSettlement = {
  outcome: "player",
  handResults: [
    { handId: "h1", outcome: "blackjack", wager: 25, returned: 62.5, net: 37.5, reason: "Blackjack" },
    { handId: "h2", outcome: "surrender", wager: 25, returned: 12.5, net: -12.5, reason: "迟投降" },
  ],
  insurance: { status: "lost", wager: 10, returned: 0, net: -10 },
  totalWagered: 60,
  returned: 75,
  net: 15,
  reason: "本轮净赢。",
};

function table(overrides: Partial<TwentyOneState> = {}): TwentyOneState {
  return {
    revision: 1,
    phase: "betting",
    rules: STANDARD_SIX_RULES,
    deck: [],
    dealerHand: [],
    dealerRevealed: false,
    hands: [],
    activeHandIndex: null,
    baseBet: 0,
    insurance: { status: "not-offered", wager: 0 },
    chips: 500,
    handNumber: 1,
    log: [],
    ...overrides,
  };
}

function settledTable(chips = 515): TwentyOneState {
  return table({
    revision: 9,
    phase: "settled",
    chips,
    dealerRevealed: true,
    hands: [
      { id: "h1", cards: [], wager: 25, status: "stood", fromSplit: false, splitAces: false, doubled: false },
      { id: "h2", cards: [], wager: 25, status: "surrendered", fromSplit: true, splitAces: false, doubled: false },
    ],
    settlement,
  });
}

describe("Twenty One session model", () => {
  it("identifies the three presets and custom rules", () => {
    expect(identifyRulesPreset(STANDARD_SIX_RULES)).toBe("standard-six");
    expect(identifyRulesPreset(SINGLE_DECK_RULES)).toBe("single-deck");
    expect(SINGLE_DECK_RULES).toMatchObject({
      dealerSoft17: "hit",
      blackjackPayout: "3:2",
      maxPlayerHands: 3,
      doubleAfterSplit: false,
      allowInsurance: true,
      allowLateSurrender: false,
    });
    expect(identifyRulesPreset(HIGH_PRESSURE_EIGHT_RULES)).toBe("high-pressure-eight");
    expect(identifyRulesPreset({ ...STANDARD_SIX_RULES, allowInsurance: false })).toBe("custom");
  });

  it("updates all settlement statistics from one authoritative result", () => {
    const next = addSettlementToStats(createEmptyStats(), settlement, settledTable());
    expect(next).toMatchObject({
      roundsPlayed: 1,
      handsWon: 1,
      handsLost: 1,
      handsPushed: 0,
      blackjacks: 1,
      surrenders: 1,
      totalWagered: 60,
      netChips: 15,
      insurancePurchases: 1,
      insuranceNet: -10,
      biggestRoundWin: 15,
      peakChips: 515,
      currentWinStreak: 1,
      bestWinStreak: 1,
    });
  });

  it("consumes a settlement only once across equivalent restored objects", () => {
    const root = startClassicSession(createDefaultRootState(), table());
    expect(root.activeSession?.sessionStats.peakChips).toBe(500);
    const first = updateActiveTable(root, settledTable());
    const restoredCopy = JSON.parse(JSON.stringify(settledTable())) as TwentyOneState;
    const second = updateActiveTable(first, restoredCopy);

    expect(first.lifetimeStats.roundsPlayed).toBe(1);
    expect(second.lifetimeStats.roundsPlayed).toBe(1);
    expect(second.activeSession?.roundsCompleted).toBe(1);
  });

  it("ends a challenge, records the assisted bucket and preserves lifetime stats", () => {
    let root = startChallengeSession(createDefaultRootState(), "warmup", table({ rules: STANDARD_SIX_RULES }));
    expect(root.challengeRecords.warmup.unassisted.runs).toBe(1);
    root = markHintUsed(root);
    expect(root.challengeRecords.warmup.unassisted.runs).toBe(0);
    expect(root.challengeRecords.warmup.assisted.runs).toBe(1);
    root = updateActiveTable(root, settledTable(650));

    expect(root.activeSession).toMatchObject({
      status: "summary",
      endReason: "challenge-cleared",
      assisted: true,
      roundsCompleted: 1,
    });
    expect(root.challengeRecords.warmup.assisted).toEqual({ runs: 1, clears: 1, bestFinalChips: 650 });
    expect(root.challengeRecords.warmup.unassisted.runs).toBe(0);
    expect(root.lifetimeStats.roundsPlayed).toBe(1);
    const afterSummaryHint = markHintUsed(root);
    expect(afterSummaryHint).toBe(root);
    expect(afterSummaryHint.challengeRecords.warmup.assisted.clears).toBe(1);
  });

  it("rejects stale table updates and archive resets while a session is active", () => {
    const active = startChallengeSession(createDefaultRootState(), "warmup", table({ revision: 4 }));
    expect(updateActiveTable(active, table({ revision: 4 }))).toBe(active);
    expect(updateActiveTable(active, table({ revision: 3 }))).toBe(active);
    expect(resetArchive(active)).toBe(active);
    const reset = resetArchive(createDefaultRootState());
    expect(reset.lifetimeStats.peakChips).toBe(500);
  });

  it("counts an abandoned challenge attempt and provides summary navigation helpers", () => {
    const challenge = startChallengeSession(createDefaultRootState(), "double", table());
    const setup = returnToModeSelect(challenge);
    expect(setup.activeSession).toBeUndefined();
    expect(setup.challengeRecords.double.unassisted.runs).toBe(1);

    const classic = startClassicSession(setup, table());
    const summary = updateActiveTable(classic, settledTable(0));
    expect(summary.activeSession?.status).toBe("summary");
    const retried = retryActiveSession(summary, table({ revision: 0 }));
    expect(retried.activeSession).toMatchObject({ mode: "classic", status: "playing", roundsCompleted: 0 });
    expect(retried.activeSession?.sessionStats.peakChips).toBe(500);
  });

  it("uses reach and endurance completion conditions", () => {
    expect(CHALLENGES.endurance.roundLimit).toBe(30);
    expect(getChallengeVerdict("double", 4, 1000)).toMatchObject({ finished: true, cleared: true });
    expect(getChallengeVerdict("endurance", 29, 900)).toMatchObject({ finished: false });
    expect(getChallengeVerdict("endurance", 30, 499)).toMatchObject({ finished: true, cleared: false, reason: "round-limit" });
    expect(getChallengeVerdict("warmup", 2, 0)).toMatchObject({ finished: true, cleared: false, reason: "bankrupt" });
  });
});
