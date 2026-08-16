/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GamePersistenceHandle } from "../../core/games/types";
import { SoundProvider } from "../../shared/audio/SoundProvider";
import { PLAYBACK_SPEED_STORAGE_KEY } from "../../shared/settings/usePlaybackSpeed";
import { TexasHoldemGame } from "./TexasHoldemGame";

function renderGame(persistence?: GamePersistenceHandle) {
  return render(
    <SoundProvider>
      <TexasHoldemGame onExit={vi.fn()} persistence={persistence} />
    </SoundProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("Texas Hold'em shared table preferences", () => {
  it("exposes the shared AI pacing preference in the table menu", () => {
    window.localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, "4");
    renderGame();

    fireEvent.click(screen.getByRole("button", { name: "更多牌桌选项" }));
    const menu = screen.getByRole("dialog", { name: "牌桌选项" });
    fireEvent.click(within(menu).getByRole("button", { name: /AI 节奏 · 4×/ }));

    expect(window.localStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY)).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "更多牌桌选项" }));
    expect(screen.getByRole("button", { name: /AI 节奏 · 1×/ })).toBeTruthy();
  });

  it("blocks an unreadable restored save until the player explicitly resets it", async () => {
    const save = vi.fn<GamePersistenceHandle["save"]>(() => true);
    const clear = vi.fn();
    renderGame({
      restored: { schemaVersion: 99, data: { future: true } },
      save,
      clear,
    });

    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "更多牌桌选项" }));
    const menu = screen.getByRole("dialog", { name: "牌桌选项" });
    expect(within(menu).getByRole("alert").textContent).toContain("现有存档版本或内容无法安全读取");

    fireEvent.click(within(menu).getByRole("button", { name: "重置旧存档并启用保存" }));
    expect(clear).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(save).toHaveBeenCalled());
  });
});
