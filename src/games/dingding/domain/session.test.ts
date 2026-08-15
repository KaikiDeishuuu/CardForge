import { describe, expect, it } from "vitest";
import { createInitialState } from "./engine";
import {
  chooseDingMatchHero,
  createDefaultDingRootState,
  dismissDingMatch,
  resetDingProfile,
  startDingMatch,
  startDingMatchWithHeroDraft,
  updateActiveDingMatch,
} from "./session";
import type { HeroId } from "./heroes";
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

  it("starts a three-choice hero draft and swaps only the human hero on selection", () => {
    const root = startDingMatchWithHeroDraft(createDefaultDingRootState(), "standard", fixedRandom);
    const draft = root.activeMatch?.heroDraft;
    const players = root.activeMatch?.state.players ?? [];
    expect(draft?.options).toHaveLength(3);
    expect(new Set(draft?.options).size).toBe(3);

    const human = players.find((player) => player.controller === "human")!;
    expect(human.heroId).toBe(draft!.options[0]);
    for (const ai of players.filter((player) => player.controller === "ai")) {
      expect(draft!.options.includes(ai.heroId as HeroId)).toBe(false);
    }

    const chosen = root.activeMatch!.heroDraft!.options[1];
    const selected = chooseDingMatchHero(root, chosen);
    const selectedPlayers = selected.activeMatch!.state.players;
    expect(selected.activeMatch?.heroDraft).toBeUndefined();
    expect(selectedPlayers.find((player) => player.controller === "human")!.heroId).toBe(chosen);
    for (const ai of selectedPlayers.filter((player) => player.controller === "ai")) {
      expect(ai.heroId).not.toBe(chosen);
    }
    expect(selected.activeMatch!.state.revision).toBe(1);
  });

  it("closes the draft when the human confirms the pre-assigned first hero", () => {
    // options[0] 已经预先发给人类席，chooseHero 因此返回原 state。
    // 如果据此提前返回，选将弹层就永远不会关闭——而它正是用户看到的第一张卡。
    const root = startDingMatchWithHeroDraft(createDefaultDingRootState(), "standard", fixedRandom);
    const first = root.activeMatch!.heroDraft!.options[0];
    expect(root.activeMatch!.state.players.find((player) => player.controller === "human")!.heroId).toBe(first);

    const selected = chooseDingMatchHero(root, first);
    expect(selected.activeMatch?.heroDraft).toBeUndefined();
    expect(selected.activeMatch!.state.players.find((player) => player.controller === "human")!.heroId).toBe(first);
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
