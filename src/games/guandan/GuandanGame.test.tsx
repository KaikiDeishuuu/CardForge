/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GamePersistenceHandle } from "../../core/games/types";
import { SoundProvider } from "../../shared/audio/SoundProvider";
import { PLAYBACK_SPEED_STORAGE_KEY } from "../../shared/settings/usePlaybackSpeed";
import { GuandanGame } from "./GuandanGame";
import { chooseAiMove, getAiThinkingDuration } from "./domain/ai";
import { createInitialState, playCards } from "./domain/engine";
import { GUANDAN_SAVE_SCHEMA_VERSION } from "./domain/persistence";
import type { GuandanState } from "./domain/types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function createEastTurn(): GuandanState {
  const initial = createInitialState(() => 0.37);
  const move = chooseAiMove(initial, "human");
  if (move?.kind !== "play") throw new Error("expected the human seat to have an opening move");
  return playCards(initial, "human", move.cardIds);
}

function restoredPersistence(state: GuandanState): GamePersistenceHandle {
  return {
    restored: { schemaVersion: GUANDAN_SAVE_SCHEMA_VERSION, data: state },
    save: vi.fn(() => true),
    clear: vi.fn(),
  };
}

describe("GuandanGame persistence guard", () => {
  it("keeps an unreadable future save untouched until the player explicitly resets it", async () => {
    const save = vi.fn<GamePersistenceHandle["save"]>();
    const clear = vi.fn();
    const persistence: GamePersistenceHandle = {
      restored: { schemaVersion: 99, data: { future: true } },
      save,
      clear,
    };
    render(
      <SoundProvider>
        <GuandanGame onExit={vi.fn()} persistence={persistence} />
      </SoundProvider>,
    );

    const warning = screen.getByRole("alert");
    expect(warning.textContent).toContain("现有存档无法安全读取，本次不会覆盖它");
    expect(save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "重置旧存档并启用保存" }));
    expect(clear).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        GUANDAN_SAVE_SCHEMA_VERSION,
        0,
        expect.objectContaining({ revision: 0, status: "playing" }),
      );
    });
  });
});

describe("GuandanGame AI pacing", () => {
  it("keeps the active AI visibly thinking until its full delay has elapsed", () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, "1");
    const state = createEastTurn();
    const delay = getAiThinkingDuration(state, "east");

    render(
      <SoundProvider>
        <GuandanGame onExit={vi.fn()} persistence={restoredPersistence(state)} />
      </SoundProvider>,
    );

    expect(screen.getByText("东座的行动")).toBeTruthy();
    expect(screen.getByText(/东座正在理牌/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(delay - 1));
    expect(screen.getByText("东座的行动")).toBeTruthy();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("对家的行动")).toBeTruthy();
    expect(screen.getByText(/对家正在理牌/)).toBeTruthy();
  });

  it("cancels a pending move while the record panel is open and restarts it on close", () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, "1");
    const state = createEastTurn();
    const delay = getAiThinkingDuration(state, "east");

    render(
      <SoundProvider>
        <GuandanGame onExit={vi.fn()} persistence={restoredPersistence(state)} />
      </SoundProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看牌局记录" }));
    act(() => vi.advanceTimersByTime(delay + 100));
    expect(screen.getByText("东座的行动")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭牌局记录" }));
    act(() => vi.advanceTimersByTime(delay - 1));
    expect(screen.getByText("东座的行动")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("对家的行动")).toBeTruthy();
  });
});
