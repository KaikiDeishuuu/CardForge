import type { Page } from "@playwright/test";
import { createTexasState } from "../src/games/texas-holdem/domain/engine";
import {
  TEXAS_HOLDEM_SAVE_SCHEMA_VERSION,
  serializeTexasState,
} from "../src/games/texas-holdem/persistence";

export const TEXAS_HOLDEM_SAVE_KEY = "cardforge.save.texas-holdem";

/** A stable human-button hand; the AI checks after the player's opening call. */
export function createTexasHoldemSave() {
  const state = createTexasState(() => 0.42);
  return {
    schemaVersion: TEXAS_HOLDEM_SAVE_SCHEMA_VERSION,
    savedAt: 0,
    snapshot: {
      gameId: "texas-holdem" as const,
      revision: state.revision,
      data: serializeTexasState(state),
    },
  };
}

export async function installTexasHoldemSave(page: Page): Promise<void> {
  const save = createTexasHoldemSave();
  await page.addInitScript(
    ({ key, record }) => {
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, JSON.stringify(record));
      }
    },
    { key: TEXAS_HOLDEM_SAVE_KEY, record: save },
  );
}
