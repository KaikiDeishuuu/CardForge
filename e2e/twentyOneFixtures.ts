import type { Page } from "@playwright/test";
import { createInitialState, createShoe } from "../src/games/twenty-one/domain/engine";
import {
  CLASSIC_STARTING_CHIPS,
  STANDARD_SIX_RULES,
  createDefaultRootState,
  startChallengeSession,
  startClassicSession,
  updatePreferences,
  type ChallengeId,
  type TwentyOneRootState,
} from "../src/games/twenty-one/domain/session";
import {
  TWENTY_ONE_SAVE_SCHEMA_VERSION,
  serializeTwentyOneRootState,
} from "../src/games/twenty-one/domain/persistence";
import type { PlayingCard, Rank } from "../src/games/twenty-one/domain/types";

export const TWENTY_ONE_SAVE_KEY = "cardforge.save.twenty-one";

export interface TwentyOneFixtureSave {
  readonly schemaVersion: number;
  readonly savedAt: number;
  readonly snapshot: {
    readonly gameId: "twenty-one";
    readonly revision: number;
    readonly data: unknown;
  };
}

export interface InstallTwentyOneSaveOptions {
  /** Set only when a test intentionally needs to replace an existing save. */
  readonly overwriteExisting?: boolean;
}

/**
 * Reorder one real six-deck shoe so `drawOrder` is drawn from left to right.
 * The engine draws from the array tail, hence selected cards are appended in reverse.
 */
export function createStackedSixDeckShoe(drawOrder: readonly Rank[]): PlayingCard[] {
  const remaining = createShoe(6);
  const selected = drawOrder.map((rank, drawIndex) => {
    const cardIndex = remaining.findIndex((card) => card.rank === rank);
    if (cardIndex < 0) {
      throw new RangeError(`Cannot stack draw ${drawIndex + 1}: no ${rank} remains in the six-deck shoe.`);
    }
    return remaining.splice(cardIndex, 1)[0];
  });
  const shoe = [...remaining, ...selected.reverse()];

  if (shoe.length !== 312 || new Set(shoe.map((card) => card.id)).size !== shoe.length) {
    throw new Error("Twenty-One E2E fixture must preserve all 312 unique physical cards.");
  }
  return shoe;
}

/** Build a valid schema-v2 classic session paused at the betting phase. */
export function createClassicBettingRoot(drawOrder: readonly Rank[]): TwentyOneRootState {
  const table = {
    ...createInitialState(() => 0.5, STANDARD_SIX_RULES, CLASSIC_STARTING_CHIPS),
    deck: createStackedSixDeckShoe(drawOrder),
  };
  const configuredRoot = updatePreferences(createDefaultRootState(), {
    rules: STANDARD_SIX_RULES,
    assistEnabled: false,
  });
  return startClassicSession(configuredRoot, table);
}

export function createClassicBettingSave(drawOrder: readonly Rank[]): TwentyOneFixtureSave {
  const root = createClassicBettingRoot(drawOrder);
  return createSaveRecord(root);
}

function createSaveRecord(root: TwentyOneRootState): TwentyOneFixtureSave {
  return {
    schemaVersion: TWENTY_ONE_SAVE_SCHEMA_VERSION,
    savedAt: 0,
    snapshot: {
      gameId: "twenty-one",
      revision: root.revision,
      data: serializeTwentyOneRootState(root),
    },
  };
}

/**
 * Build a valid challenge save close to its target. Supplying the balance is an
 * intentional fixture seam: it keeps the browser test focused on the final
 * settlement -> summary boundary instead of replaying up to thirty rounds.
 */
export function createChallengeBettingSave(
  drawOrder: readonly Rank[],
  challengeId: ChallengeId = "warmup",
  chips = 625,
): TwentyOneFixtureSave {
  const table = {
    ...createInitialState(() => 0.5, STANDARD_SIX_RULES, chips),
    deck: createStackedSixDeckShoe(drawOrder),
  };
  const root = startChallengeSession(createDefaultRootState(), challengeId, table);
  return createSaveRecord(root);
}

async function installSave(
  page: Page,
  record: TwentyOneFixtureSave,
  options: InstallTwentyOneSaveOptions,
): Promise<void> {
  await page.addInitScript(
    ({ key, save, overwriteExisting }) => {
      if (overwriteExisting || window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, JSON.stringify(save));
      }
    },
    {
      key: TWENTY_ONE_SAVE_KEY,
      save: record,
      overwriteExisting: options.overwriteExisting ?? false,
    },
  );
}

/**
 * Install before `page.goto`. By default every navigation keeps the latest save
 * written by the game, so a reload can exercise real restoration and de-duplication.
 */
export async function installClassicBettingSave(
  page: Page,
  drawOrder: readonly Rank[],
  options: InstallTwentyOneSaveOptions = {},
): Promise<void> {
  await installSave(page, createClassicBettingSave(drawOrder), options);
}

export async function installChallengeBettingSave(
  page: Page,
  drawOrder: readonly Rank[],
  challengeId: ChallengeId = "warmup",
  chips = 625,
  options: InstallTwentyOneSaveOptions = {},
): Promise<void> {
  await installSave(page, createChallengeBettingSave(drawOrder, challengeId, chips), options);
}
