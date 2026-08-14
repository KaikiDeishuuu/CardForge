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
  /**
   * 平台提供的存档句柄：只流转不解读内容。序列化、结构校验与版本判定
   * 全部由游戏自己负责，平台只读写带 schemaVersion 的 localStorage 信封。
   */
  persistence?: GamePersistenceHandle;
}

/**
 * 游戏恢复状态时读取的原始存档：字段与存储信封一一对应，
 * 平台不关心 data 的结构，游戏用自身的 restore 校验并解释它。
 */
export interface GameRestoredSave {
  readonly schemaVersion: number;
  readonly data: unknown;
}

export interface GamePersistenceHandle {
  readonly restored?: GameRestoredSave;
  save(schemaVersion: number, revision: number, data: unknown): void;
  clear(): void;
}

export interface GameModule {
  readonly Game: ComponentType<GameRuntimeProps>;
}

export interface GameRegistration {
  readonly manifest: GameManifest;
  readonly load?: () => Promise<GameModule>;
}
