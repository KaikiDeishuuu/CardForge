/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameManifest, GameRegistration } from "../core/games/types";
import { saveGameSave } from "../shared/storage/GameSaveStore";
import { Lobby } from "./Lobby";

function registration(id: string, manifest: Partial<GameManifest> = {}): GameRegistration {
  const availability = manifest.availability ?? "playable";
  return {
    manifest: {
      id,
      name: `${id} 牌桌`,
      shortName: id,
      description: "test",
      genre: "test",
      players: "1",
      sessionLength: "1 min",
      accent: "#000",
      ...manifest,
      availability,
    },
    ...(availability === "playable" ? { load: async () => ({ Game: () => null }) } : {}),
  };
}

function renderLobby(games: readonly GameRegistration[], onLaunch = vi.fn()) {
  return render(
    <Lobby games={games} soundEnabled onToggleSound={vi.fn()} onLaunch={onLaunch} />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Lobby", () => {
  it("features the manifest that asks for it rather than a known game id", () => {
    const { container } = renderLobby([
      registration("first-table"),
      registration("chosen-table", { featured: true, mark: "选" }),
    ]);

    const featured = container.querySelector(".featured-game");
    expect(featured?.textContent).toContain("chosen-table 牌桌");
    expect(featured?.textContent).toContain("选");
    expect(container.querySelectorAll(".planned-game")).toHaveLength(1);
  });

  it("falls back to the first launchable table when no manifest is featured", () => {
    const { container } = renderLobby([
      registration("planned-table", { availability: "planned" }),
      registration("first-playable"),
      registration("second-playable"),
    ]);

    expect(container.querySelector(".featured-game")?.textContent).toContain("first-playable 牌桌");
  });

  it("derives the playable table count from launchable registrations", () => {
    const { getByText } = renderLobby([
      registration("first-playable"),
      registration("planned-table", { availability: "planned" }),
      registration("second-playable"),
    ]);

    expect(getByText("2 套独立规则可游玩")).toBeTruthy();
  });

  it("renders a lobby with no featured table instead of throwing", () => {
    const { container } = renderLobby([
      registration("planned-one", { availability: "planned" }),
      registration("planned-two", { availability: "planned" }),
    ]);

    expect(container.querySelector(".featured-game")).toBeNull();
    expect(container.querySelectorAll(".planned-game")).toHaveLength(2);
    expect(container.querySelector(".lobby")).not.toBeNull();
  });

  it("renders an empty registry without crashing", () => {
    const { container } = renderLobby([]);
    expect(container.querySelector(".featured-game")).toBeNull();
    expect(container.querySelector(".lobby")).not.toBeNull();
  });

  it("surfaces playable saves as a continue strip ordered by recency", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);
    saveGameSave("first-playable", 1, 4, { ok: true });
    saveGameSave("second-playable", 1, 12, { ok: true });
    const { container } = renderLobby([
      registration("planned-table", { availability: "planned" }),
      registration("first-playable"),
      registration("second-playable"),
    ]);

    const entries = [...container.querySelectorAll<HTMLButtonElement>(".continue-game")];
    expect(entries).toHaveLength(2);
    expect(entries[0].getAttribute("aria-label")).toContain("second-playable 牌桌");
    expect(entries[1].getAttribute("aria-label")).toContain("first-playable 牌桌");
    expect(entries[0].textContent).toContain("第 12 次变化");
  });

  it("ignores saves for games that are not launchable", () => {
    saveGameSave("planned-table", 1, 9, { ok: true });
    const { container } = renderLobby([
      registration("planned-table", { availability: "planned" }),
      registration("first-playable"),
    ]);

    expect(container.querySelector(".continue-strip")).toBeNull();
  });

  it("launches a game from the continue strip", () => {
    saveGameSave("first-playable", 1, 3, { ok: true });
    const onLaunch = vi.fn();
    renderLobby([registration("first-playable")], onLaunch);

    screen.getByRole("button", { name: /继续first-playable 牌桌/ }).click();
    expect(onLaunch).toHaveBeenCalledWith("first-playable");
  });
});
