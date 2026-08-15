import { describe, expect, it } from "vitest";
import { createInitialState, playCard } from "./engine";
import { restoreDingState, serializeDingState } from "./persistence";

function tamper(overrides: Record<string, unknown>): unknown {
  const initial = createInitialState(() => 0.37);
  return { ...JSON.parse(JSON.stringify(serializeDingState(initial))), ...overrides };
}

describe("Ding Ding persistence", () => {
  it("round-trips an initial table", () => {
    const initial = createInitialState(() => 0.37);
    const restored = restoreDingState(JSON.parse(JSON.stringify(serializeDingState(initial))));
    expect(restored).toEqual(initial);
  });

  it("round-trips a pending strike", () => {
    const initial = createInitialState(() => 0.37);
    const actor = initial.players.find((player) => player.hand.some((card) => card.type === "strike"))!;
    const strike = actor.hand.find((card) => card.type === "strike")!;
    const target = initial.players.find((candidate) => {
      if (candidate.id === actor.id || !candidate.alive) return false;
      return playCard({ ...initial, phase: "play", activePlayerId: actor.id }, actor.id, strike.id, candidate.id).pending?.kind === "strike";
    })!;
    const pending = playCard({ ...initial, phase: "play", activePlayerId: actor.id }, actor.id, strike.id, target.id);
    expect(pending.pending?.kind).toBe("strike");
    const restored = restoreDingState(JSON.parse(JSON.stringify(serializeDingState(pending))));
    expect(restored).toEqual(pending);
  });

  it("rejects malformed players, phases and card piles", () => {
    expect(restoreDingState(undefined)).toBeUndefined();
    expect(restoreDingState({ status: "broken" })).toBeUndefined();
    expect(restoreDingState(tamper({ phase: "bidding" }))).toBeUndefined();
    expect(restoreDingState(tamper({ players: [] }))).toBeUndefined();
    expect(restoreDingState(tamper({ deck: [{}] }))).toBeUndefined();
    expect(restoreDingState(tamper({ activePlayerId: "nobody" }))).toBeUndefined();
    expect(restoreDingState(tamper({ rngSeed: -1 }))).toBeUndefined();
  });

  it("rejects tampered identity metadata and winner state", () => {
    const withHiddenLord = tamper({});
    const players = (withHiddenLord as { players: Array<{ identity: string; revealed: boolean }> }).players;
    const lord = players.find((player) => player.identity === "lord")!;
    lord.revealed = false;
    expect(restoreDingState(withHiddenLord)).toBeUndefined();

    const badWinner = tamper({ status: "playing", winner: "rebel" });
    expect(restoreDingState(badWinner)).toBeUndefined();
  });
});
