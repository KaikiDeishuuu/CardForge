import { describe, expect, it } from "vitest";
import { createInitialState, playCard } from "./engine";
import { restorePactState, serializePactState } from "./persistence";
import type { EmberPactState } from "./types";

const fixedRandom = () => 0.42;

function giveCard(state: EmberPactState, actorId: string, definitionId: string) {
  const card = { uid: `test-${actorId}-${definitionId}`, definitionId };
  return {
    state: {
      ...state,
      combatants: state.combatants.map((actor) => actor.id === actorId
        ? { ...actor, hand: [card, ...actor.hand] }
        : actor),
    },
    card,
  };
}

function tampered(overrides: Record<string, unknown>): unknown {
  return { ...createInitialState(fixedRandom), ...overrides };
}

describe("Ember Pact persistence", () => {
  it("round-trips a mid-match state through a JSON envelope", () => {
    const setup = giveCard(createInitialState(fixedRandom), "player", "sever");
    const played = playCard(setup.state, "player", setup.card.uid, "scar");
    const restored = restorePactState(JSON.parse(JSON.stringify(serializePactState(played))));
    expect(restored).toEqual(played);
  });

  it("rejects unrecognizable saves", () => {
    expect(restorePactState(undefined)).toBeUndefined();
    expect(restorePactState("garbage")).toBeUndefined();
    expect(restorePactState(tampered({ status: "corrupted" }))).toBeUndefined();
    expect(restorePactState(tampered({ combatants: [] }))).toBeUndefined();
    expect(restorePactState(tampered({ rngSeed: Number.NaN }))).toBeUndefined();
  });
});
