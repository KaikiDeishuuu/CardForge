import type { GameSnapshot } from "../types/game";

/**
 * localStorage 存档信封。平台只校验信封本身，不解读 `snapshot.data`：
 * 内容的结构与版本判定由各游戏自己的 restore 负责。
 */
export interface StoredGameSave {
  readonly schemaVersion: number;
  readonly savedAt: number;
  readonly snapshot: GameSnapshot;
}

const SAVE_KEY_PREFIX = "cardforge.save.";

function storageKey(gameId: string): string {
  return `${SAVE_KEY_PREFIX}${gameId}`;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isStoredGameSave(value: unknown): value is StoredGameSave {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!isNonNegativeSafeInteger(record.schemaVersion) || !isNonNegativeSafeInteger(record.savedAt)) {
    return false;
  }

  const snapshot = record.snapshot as Record<string, unknown> | undefined;
  return typeof snapshot === "object" && snapshot !== null && !Array.isArray(snapshot)
    && typeof snapshot.gameId === "string" && snapshot.gameId.length > 0
    && isNonNegativeSafeInteger(snapshot.revision)
    && "data" in snapshot;
}

export function loadGameSave(gameId: string): StoredGameSave | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey(gameId));
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredGameSave(parsed)) return undefined;
    if (parsed.snapshot.gameId !== gameId) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/** 存储不可用（隐私模式、配额）时静默降级，返回是否写入成功。 */
export function saveGameSave(
  gameId: string,
  schemaVersion: number,
  revision: number,
  data: unknown,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const record: StoredGameSave = {
      schemaVersion,
      savedAt: Date.now(),
      snapshot: { gameId, revision, data },
    };
    window.localStorage.setItem(storageKey(gameId), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function clearGameSave(gameId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(gameId));
  } catch {
    // Storage can be unavailable in privacy modes; nothing left to clear.
  }
}
