import { describe, expect, it } from "vitest";
import { createInitialState } from "./engine";
import {
  createDefaultDingRootState,
  dismissDingMatch,
  resetDingProfile,
  startDingMatch,
  updateActiveDingMatch,
} from "./session";
import type { DingState } from "./types";

const fixedRandom = () => 0.37;

function finishedState(seed: number): DingState {
  let value = seed;
  const random = () => {
    value = (value * 16_807) % 2_147_483_647;
    return value / 2_147_483_647;
  };
  const state = createInitialState(random);
  const human = state.players.find((player) => player.controller === "human")!;
  const winner = human.identity === "lord" || human.identity === "loyalist"
    ? "lord-side"
    : human.identity === "rebel"
      ? "rebel"
      : "renegade";
  return {
    ...state,
    revision: state.revision + 1,
    status: "finished",
    phase: "finished",
    winner,
    stack: [],
  };
}

describe("Ding session archive", () => {
  it("starts with an empty archive and records a finished match exactly once", () => {
    const playing = createInitialState(fixedRandom);
    const root = startDingMatch(createDefaultDingRootState(), playing);
    expect(root.activeMatch?.state).toBe(playing);
    expect(root.activeMatch?.resultRecorded).toBe(false);
    expect(root.lifetimeProfile.gamesPlayed).toBe(0);

    const finished = finishedState(7);
    const recorded = updateActiveDingMatch(root, finished);
    const human = finished.players.find((player) => player.controller === "human")!;
    expect(recorded.activeMatch?.resultRecorded).toBe(true);
    expect(recorded.lifetimeProfile.gamesPlayed).toBe(1);
    expect(recorded.lifetimeProfile.wins).toBe(1);
    expect(recorded.lifetimeProfile.identityRecords[human.identity]).toMatchObject({ games: 1, wins: 1 });
    expect(recorded.lifetimeProfile.heroRecords[human.heroId as keyof typeof recorded.lifetimeProfile.heroRecords])
      .toMatchObject({ games: 1, wins: 1 });

    expect(updateActiveDingMatch(recorded, { ...finished, revision: finished.revision + 1 })).toBe(recorded);
  });

  it("dismisses a recorded result and can reset the archive without an active match", () => {
    const playing = createInitialState(fixedRandom);
    let root = startDingMatch(createDefaultDingRootState(), playing);
    root = updateActiveDingMatch(root, finishedState(11));
    const dismissed = dismissDingMatch(root);
    expect(dismissed.activeMatch).toBeUndefined();
    expect(dismissed.lifetimeProfile.gamesPlayed).toBe(1);

    const reset = resetDingProfile(dismissed);
    expect(reset.lifetimeProfile.gamesPlayed).toBe(0);
    expect(reset.lifetimeProfile.identityRecords.rebel).toEqual({ games: 0, wins: 0 });
  });

  it("does not record a loss as a win and counts the human identity independently of winner text", () => {
    const playing = createInitialState(fixedRandom);
    let root = startDingMatch(createDefaultDingRootState(), playing);
    const finished = finishedState(5);
    const human = finished.players.find((player) => player.controller === "human")!;
    const losingWinner = human.identity === "renegade"
      ? "rebel"
      : human.identity === "rebel"
        ? "lord-side"
        : "rebel";
    const loss: DingState = { ...finished, winner: losingWinner };
    root = updateActiveDingMatch(root, loss);
    expect(root.lifetimeProfile.wins).toBe(0);
    expect(root.lifetimeProfile.gamesPlayed).toBe(1);
    expect(root.lifetimeProfile.identityRecords[human.identity].wins).toBe(0);
  });
});
