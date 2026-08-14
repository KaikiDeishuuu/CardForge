import { describe, expect, it } from "vitest";
import { createInitialState, getPlayer, playCards } from "./engine";
import { restoreGuandanState, serializeGuandanState } from "./persistence";

function tampered(overrides: Record<string, unknown>): unknown {
  return { ...createInitialState(() => 0.37), ...overrides };
}

describe("Guandan persistence", () => {
  it("round-trips an in-flight deal through a JSON envelope", () => {
    let game = createInitialState(() => 0.37);
    const first = getPlayer(game, "human").hand[0];
    game = playCards(game, "human", [first.id]);
    const restored = restoreGuandanState(JSON.parse(JSON.stringify(serializeGuandanState(game))));
    expect(restored).toEqual(game);
  });

  it("rejects unrecognizable saves", () => {
    expect(restoreGuandanState(undefined)).toBeUndefined();
    expect(restoreGuandanState(null)).toBeUndefined();
    expect(restoreGuandanState(tampered({ status: "corrupted" }))).toBeUndefined();
    expect(restoreGuandanState(tampered({ players: [] }))).toBeUndefined();
    expect(restoreGuandanState(tampered({ activePlayerId: "nobody" }))).toBeUndefined();
    expect(restoreGuandanState(tampered({ match: { dealNumber: 1 } }))).toBeUndefined();
  });
});
