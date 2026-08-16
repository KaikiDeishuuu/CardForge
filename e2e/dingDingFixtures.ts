import type { Page } from "@playwright/test";
import { createInitialState } from "../src/games/dingding/domain/engine";
import { HERO_CATALOG } from "../src/games/dingding/domain/heroes";
import {
  DING_SAVE_SCHEMA_VERSION,
  serializeDingRootState,
} from "../src/games/dingding/domain/persistence";
import {
  createDefaultDingRootState,
  startDingMatch,
  type DingRootState,
} from "../src/games/dingding/domain/session";
import type { DingState } from "../src/games/dingding/domain/types";

export const DINGDING_SAVE_KEY = "cardforge.save.dingding";

interface DingDingFixtureSave {
  readonly schemaVersion: number;
  readonly savedAt: number;
  readonly snapshot: {
    readonly gameId: "dingding";
    readonly revision: number;
    readonly data: unknown;
  };
}

const fixedRandom = () => 0.42;

/** Build a valid game paused at the largest human skill-response composition. */
export function createHumanSkillResponseRoot(): DingRootState {
  const initial = createInitialState(
    fixedRandom,
    "standard",
    ["springtide", "redblade", "ironward", "cloudstep"],
  );
  const players = initial.players.map((player) => {
    if (player.id === "south") {
      return {
        ...player,
        hp: Math.max(1, player.maxHp - 1),
        skillFlags: { ...player.skillFlags, "active:qingnang": true },
      };
    }
    return player.id === "north"
      ? { ...player, hp: Math.max(1, player.maxHp - 1) }
      : player;
  });
  const state: DingState = {
    ...initial,
    revision: initial.revision + 1,
    phase: "play",
    activePlayerId: "south",
    players,
    stack: [{
      kind: "skill",
      ownerId: "south",
      skillId: "qingnang",
      prompt: HERO_CATALOG.springtide.activeSkill!.prompt,
      targetIds: ["south", "north"],
    }],
  };
  return startDingMatch(createDefaultDingRootState(), state);
}

function createSaveRecord(root: DingRootState): DingDingFixtureSave {
  return {
    schemaVersion: DING_SAVE_SCHEMA_VERSION,
    savedAt: 0,
    snapshot: {
      gameId: "dingding",
      revision: root.revision,
      data: serializeDingRootState(root),
    },
  };
}

export async function installDingDingSave(page: Page, root: DingRootState): Promise<void> {
  const record = createSaveRecord(root);
  await page.addInitScript(
    ({ key, save }) => {
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, JSON.stringify(save));
      }
    },
    { key: DINGDING_SAVE_KEY, save: record },
  );
}
