/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GamePersistenceHandle } from "../../core/games/types";
import { SoundProvider } from "../../shared/audio/SoundProvider";
import { GuandanGame } from "./GuandanGame";
import { GUANDAN_SAVE_SCHEMA_VERSION } from "./domain/persistence";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

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
