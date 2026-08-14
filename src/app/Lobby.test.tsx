/* @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameManifest, GameRegistration } from "../core/games/types";
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

function renderLobby(games: readonly GameRegistration[]) {
  return render(
    <Lobby games={games} soundEnabled onToggleSound={vi.fn()} onLaunch={vi.fn()} />,
  );
}

afterEach(cleanup);

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
});
