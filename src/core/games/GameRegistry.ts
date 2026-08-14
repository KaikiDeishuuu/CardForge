import type { GameRegistration } from "./types";

export class GameRegistry {
  readonly #games = new Map<string, GameRegistration>();

  register(game: GameRegistration): this {
    if (this.#games.has(game.manifest.id)) {
      throw new Error(`Game "${game.manifest.id}" is already registered.`);
    }

    if (game.manifest.availability === "playable" && !game.load) {
      throw new Error(`Playable game "${game.manifest.id}" needs a loader.`);
    }

    this.#games.set(game.manifest.id, game);
    return this;
  }

  list(): readonly GameRegistration[] {
    return [...this.#games.values()];
  }

  get(id: string): GameRegistration | undefined {
    return this.#games.get(id);
  }
}
