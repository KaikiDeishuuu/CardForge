import { describe, expect, it } from "vitest";
import type { GameRegistration } from "../core/games/types";
import { buildGameUrl, readRequestedGameId, resolvePlayableGameId } from "./gameNavigation";

const playable: GameRegistration = {
  manifest: {
    id: "playable-table",
    name: "Playable Table",
    shortName: "Playable",
    description: "test",
    genre: "test",
    players: "1",
    sessionLength: "1 min",
    availability: "playable",
    accent: "#000",
  },
  load: async () => ({ Game: () => null }),
};
const planned: GameRegistration = {
  manifest: { ...playable.manifest, id: "planned-table", availability: "planned" },
};

describe("game navigation", () => {
  it("reads and decodes a requested game id", () => {
    expect(readRequestedGameId("?game=playable-table")).toBe("playable-table");
    expect(readRequestedGameId("?game=%20")).toBeUndefined();
    expect(readRequestedGameId("?sound=on")).toBeUndefined();
  });

  it("only resolves registered games that are playable and loadable", () => {
    const games = [playable, planned];
    expect(resolvePlayableGameId("?game=playable-table", games)).toBe("playable-table");
    expect(resolvePlayableGameId("?game=planned-table", games)).toBeUndefined();
    expect(resolvePlayableGameId("?game=missing", games)).toBeUndefined();
  });

  it("adds or replaces the game query while preserving other URL parts", () => {
    const location = { pathname: "/cards", search: "?sound=on&game=old", hash: "#table" };
    expect(buildGameUrl(location, "twenty one")).toBe("/cards?sound=on&game=twenty+one#table");
  });

  it("removes only the game query when returning to the lobby", () => {
    const location = { pathname: "/cards", search: "?game=guandan&sound=on", hash: "#top" };
    expect(buildGameUrl(location)).toBe("/cards?sound=on#top");
  });
});
