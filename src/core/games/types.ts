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
