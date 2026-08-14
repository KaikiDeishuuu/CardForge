import type { ComponentType } from "react";

export type GameAvailability = "playable" | "planned";

export interface GameManifest {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly genre: string;
  readonly players: string;
  readonly sessionLength: string;
  readonly availability: GameAvailability;
  readonly accent: string;
  /** Presentation hints the lobby reads so it never has to branch on a game id. */
  readonly featured?: boolean;
  readonly mark?: string;
  readonly tagline?: string;
}

export interface GameRuntimeProps {
  onExit: () => void;
}

export interface GameModule {
  readonly Game: ComponentType<GameRuntimeProps>;
}

export interface GameRegistration {
  readonly manifest: GameManifest;
  readonly load?: () => Promise<GameModule>;
}
