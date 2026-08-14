import { describe, expect, it } from "vitest";
import { GameRegistry } from "./GameRegistry";
import type { GameRegistration } from "./types";

const planned: GameRegistration = {
  manifest: {
    id: "future-table",
    name: "Future Table",
    shortName: "Future",
    description: "A test manifest",
    genre: "test",
    players: "1",
    sessionLength: "1 min",
    availability: "planned",
    accent: "#000000",
  },
};

describe("GameRegistry", () => {
  it("preserves registration order for the lobby", () => {
    const registry = new GameRegistry().register(planned);
    expect(registry.list().map((game) => game.manifest.id)).toEqual(["future-table"]);
  });

  it("rejects duplicate ids", () => {
    const registry = new GameRegistry().register(planned);
    expect(() => registry.register(planned)).toThrow(/already registered/);
  });

  it("requires a lazy loader for playable games", () => {
    expect(() => new GameRegistry().register({
      manifest: { ...planned.manifest, id: "play-now", availability: "playable" },
    })).toThrow(/needs a loader/);
  });
});
