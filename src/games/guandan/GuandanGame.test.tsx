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
    expect(screen.getAllByText(/东座思考中/).length).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(delay - 1));
    expect(screen.getByText("东座的行动")).toBeTruthy();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("对家的行动")).toBeTruthy();
    expect(screen.getAllByText(/对家思考中/).length).toBeGreaterThan(0);
  });

  it("keeps a readable presentation floor even at the fastest playback setting", () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, "4");
    const state = createEastTurn();

    render(
      <SoundProvider>
        <GuandanGame onExit={vi.fn()} persistence={restoredPersistence(state)} />
      </SoundProvider>,
    );

    expect(screen.getByText("东座的行动")).toBeTruthy();
    act(() => vi.advanceTimersByTime(599));
    expect(screen.getByText("东座的行动")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("对家的行动")).toBeTruthy();
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

describe("GuandanGame hand interaction", () => {
  it("uses one tab stop for the hand while retaining arrow-key navigation", () => {
    const state = createInitialState(() => 0.37);
    render(
      <SoundProvider>
        <GuandanGame onExit={vi.fn()} persistence={restoredPersistence(state)} />
      </SoundProvider>,
    );

    const cards = Array.from(screen.getByRole("region", { name: "你的手牌" })
      .querySelectorAll<HTMLButtonElement>("button.gd-card"));
    expect(cards.filter((card) => card.tabIndex === 0)).toHaveLength(1);
    cards[0].focus();
    fireEvent.keyDown(cards[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(cards[1]);
    expect(cards[0].tabIndex).toBe(-1);
    expect(cards[1].tabIndex).toBe(0);

    fireEvent.click(cards[3]);
    expect(cards[1].tabIndex).toBe(-1);
    expect(cards[3].tabIndex).toBe(0);
  });

  it("exposes explicit selection feedback and clears the complete selection in one action", () => {
    const state = createInitialState(() => 0.37);
    render(
      <SoundProvider>
        <GuandanGame onExit={vi.fn()} persistence={restoredPersistence(state)} />
      </SoundProvider>,
    );

    const hand = screen.getByRole("region", { name: "你的手牌" });
    const cards = Array.from(hand.querySelectorAll<HTMLButtonElement>("button.gd-card"));
    expect(cards.length).toBe(27);
    fireEvent.click(cards[0]);
    expect(cards[0].getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "清空" }).hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(cards[0].getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "出牌" }).hasAttribute("disabled")).toBe(true);
  });

  it("makes the hand unavailable while an AI turn is pending", () => {
    vi.useFakeTimers();
    const state = createEastTurn();
    render(
      <SoundProvider>
        <GuandanGame onExit={vi.fn()} persistence={restoredPersistence(state)} />
      </SoundProvider>,
    );

    const hand = screen.getByRole("region", { name: "你的手牌" });
    const cards = Array.from(hand.querySelectorAll<HTMLButtonElement>("button.gd-card"));
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.disabled)).toBe(true);
  });

  it("restores focus to the hand after keyboard play and the AI round", () => {
    vi.useFakeTimers();
    const state = createInitialState(() => 0.37);
    render(
      <SoundProvider>
        <GuandanGame onExit={vi.fn()} persistence={restoredPersistence(state)} />
      </SoundProvider>,
    );

    const hand = screen.getByRole("region", { name: "你的手牌" });
    const firstCard = hand.querySelector<HTMLButtonElement>("button.gd-card")!;
    fireEvent.click(firstCard);
    const play = screen.getByRole<HTMLButtonElement>("button", { name: /出单张/ });
    play.focus();
    fireEvent.click(play);
    expect(play.disabled).toBe(true);

    for (let index = 0; index < 3; index += 1) {
      act(() => vi.advanceTimersByTime(10_000));
    }
    const enabledCards = Array.from(hand.querySelectorAll<HTMLButtonElement>("button.gd-card:not(:disabled)"));
    expect(enabledCards.length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(enabledCards[0]);
    expect(enabledCards.filter((card) => card.tabIndex === 0)).toEqual([enabledCards[0]]);
  });
});
