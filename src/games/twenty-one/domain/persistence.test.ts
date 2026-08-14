import { describe, expect, it } from "vitest";
import { createInitialState, placeBet, playerHit } from "./engine";
import { restoreTwentyOneState, serializeTwentyOneState } from "./persistence";

function tampered(overrides: Record<string, unknown>): unknown {
  return { ...createInitialState(() => 0.37), ...overrides };
}

describe("Twenty One persistence", () => {
  it("round-trips a mid-hand state through a JSON envelope", () => {
    const dealt = placeBet(createInitialState(() => 0.37), 25, () => 0.37);
    const hit = playerHit(dealt);
    const restored = restoreTwentyOneState(JSON.parse(JSON.stringify(serializeTwentyOneState(hit))));
    expect(restored).toEqual(hit);
  });

  it("rejects unrecognizable saves", () => {
    expect(restoreTwentyOneState(undefined)).toBeUndefined();
    expect(restoreTwentyOneState(42)).toBeUndefined();
    expect(restoreTwentyOneState(tampered({ phase: "corrupted" }))).toBeUndefined();
    expect(restoreTwentyOneState(tampered({ deck: [{}] }))).toBeUndefined();
    expect(restoreTwentyOneState(tampered({ dealerRevealed: "yes" }))).toBeUndefined();
  });
});
