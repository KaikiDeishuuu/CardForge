/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameModule, GameRegistration } from "../core/games/types";
import { GameHost, isModuleLoadError } from "./GameHost";

function createRegistration(load: NonNullable<GameRegistration["load"]>): GameRegistration {
  return {
    manifest: {
      id: "test-table",
      name: "Test Table",
      shortName: "测试牌桌",
      description: "test",
      genre: "test",
      players: "1",
      sessionLength: "1 min",
      availability: "playable",
      accent: "#000",
    },
    load,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GameHost", () => {
  it("recognizes browser module loading failures without treating game errors as chunk failures", () => {
    expect(isModuleLoadError(new TypeError("Failed to fetch dynamically imported module"))).toBe(true);
    expect(isModuleLoadError(new TypeError("Importing a module script failed"))).toBe(true);
    expect(isModuleLoadError(new Error("game render failed"))).toBe(false);
  });

  it("shows a named loading state until the game module is ready", async () => {
    let resolveModule: ((module: GameModule) => void) | undefined;
    const load = vi.fn(() => new Promise<GameModule>((resolve) => {
      resolveModule = resolve;
    }));

    render(<GameHost registration={createRegistration(load)} onExit={vi.fn()} />);

    const loading = screen.getByRole("status");
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.textContent).toContain("正在展开牌桌");
    expect(loading.textContent).toContain("测试牌桌");

    await act(async () => {
      resolveModule?.({ Game: () => <main>牌桌就绪</main> });
    });

    expect(await screen.findByText("牌桌就绪")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads the current URL after a module fetch failure and can still return to the lobby", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"));
    const onExit = vi.fn();
    const reloadPage = vi.fn();

    render(<GameHost registration={createRegistration(load)} onExit={onExit} reloadPage={reloadPage} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("测试牌桌");
    expect(alert.textContent).toContain("大厅和其他游戏不受影响");

    const retry = screen.getByRole("button", { name: "重试牌桌" });
    expect(document.activeElement).toBe(retry);
    fireEvent.click(screen.getByRole("button", { name: "返回大厅" }));
    expect(onExit).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("isolates a game render error and replaces it with a fresh module on retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let resolveRetry: ((module: GameModule) => void) | undefined;
    const load = vi.fn()
      .mockResolvedValueOnce({
        Game: () => {
          throw new Error("game render failed");
        },
      })
      .mockImplementationOnce(() => new Promise<GameModule>((resolve) => {
        resolveRetry = resolve;
      }));

    render(<GameHost registration={createRegistration(load)} onExit={vi.fn()} />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试牌桌" }));
    expect(screen.getByRole("status").textContent).toContain("正在重新接驳");

    await act(async () => {
      resolveRetry?.({ Game: () => <main>恢复后的牌桌</main> });
    });

    expect(await screen.findByText("恢复后的牌桌")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
