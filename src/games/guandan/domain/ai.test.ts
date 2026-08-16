import { describe, expect, it } from "vitest";
import { getAiThinkingDuration } from "./ai";
import { classifyCombo, createInitialState, getPlayer } from "./engine";

describe("Guandan AI timing", () => {
  it("produces a stable, perceptible delay from the current table state", () => {
    const state = createInitialState(() => 0.37);
    const first = getAiThinkingDuration(state, "human");

    expect(first).toBe(getAiThinkingDuration(state, "human"));
    expect(first).toBeGreaterThanOrEqual(1_100);
    expect(first).toBeLessThanOrEqual(1_600);
  });

  it("spends longer on tactical difficulty and on leading a new trick", () => {
    const initial = createInitialState(() => 0.37);
    const relaxed = { ...initial, difficulty: "relaxed" as const };
    const tactician = { ...initial, difficulty: "tactician" as const };
    expect(getAiThinkingDuration(tactician, "east") - getAiThinkingDuration(relaxed, "east")).toBe(190);

    const openingCard = getPlayer(initial, "human").hand[0];
    const openingCombo = classifyCombo([openingCard], initial.levelRank);
    if (!openingCombo) throw new Error("expected an opening single");
    const following = { ...initial, trick: { actorId: "human" as const, combo: openingCombo } };
    expect(getAiThinkingDuration(initial, "east")).toBeGreaterThan(getAiThinkingDuration(following, "east"));
  });
});
