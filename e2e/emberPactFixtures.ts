import type { Page } from "@playwright/test";
import { createInitialState, playCard } from "../src/games/ember-pact/domain/engine";
import {
  PACT_SAVE_SCHEMA_VERSION,
  serializePactRootState,
} from "../src/games/ember-pact/domain/persistence";
import {
  createDefaultRootState,
  startMatch,
  type EmberPactRootState,
} from "../src/games/ember-pact/domain/session";
import type {
  CardInstance,
  Combatant,
  EmberPactState,
} from "../src/games/ember-pact/domain/types";

export const EMBER_PACT_SAVE_KEY = "cardforge.save.ember-pact";
export const FUTURE_EMBER_PACT_SCHEMA_VERSION = 99;
export const FUTURE_EMBER_PACT_DATA = {
  marker: "future-save-must-survive",
  archive: { gamesPlayed: 73 },
} as const;

interface EmberPactFixtureSave {
  readonly schemaVersion: number;
  readonly savedAt: number;
  readonly snapshot: {
    readonly gameId: "ember-pact";
    readonly revision: number;
    readonly data: unknown;
  };
}

const fixedRandom = () => 0.42;

function updateCombatant(
  state: EmberPactState,
  id: string,
  update: Partial<Combatant>,
): EmberPactState {
  return {
    ...state,
    combatants: state.combatants.map((combatant) => (
      combatant.id === id ? { ...combatant, ...update } : combatant
    )),
  };
}

/**
 * Put an exact, catalog-backed hand in front of a seat while preserving every
 * physical card and UID. The rest of that seat's cards return to its deck.
 */
function arrangeHand(
  state: EmberPactState,
  combatantId: string,
  definitionIds: readonly string[],
): EmberPactState {
  const combatant = state.combatants.find((candidate) => candidate.id === combatantId)!;
  const available = [...combatant.hand, ...combatant.deck, ...combatant.discard];
  const selected: CardInstance[] = [];

  for (const definitionId of definitionIds) {
    const card = available.find((candidate) => (
      candidate.definitionId === definitionId
      && !selected.some((picked) => picked.uid === candidate.uid)
    ));
    if (!card) throw new RangeError(`${combatantId} has no ${definitionId} card for the E2E fixture.`);
    selected.push(card);
  }

  const selectedUids = new Set(selected.map((card) => card.uid));
  return updateCombatant(state, combatantId, {
    hand: selected,
    deck: available.filter((card) => !selectedUids.has(card.uid)),
    discard: [],
  });
}

export function createTwoActionRoot(): EmberPactRootState {
  let state = createInitialState(fixedRandom);
  state = arrangeHand(state, "player", ["plate", "rally"]);
  return startMatch(createDefaultRootState(), state);
}

export function createHumanResponseRoot(): EmberPactRootState {
  let state = createInitialState(fixedRandom, "scar");
  state = arrangeHand(state, "player", ["sever"]);
  state = arrangeHand(state, "scar", ["deflect"]);
  const attack = state.combatants
    .find((combatant) => combatant.id === "player")!
    .hand[0];
  state = playCard(state, "player", attack.uid, "scar");
  if (state.phase !== "response") throw new Error("Response fixture did not open a response window.");
  return startMatch(createDefaultRootState(), state);
}

export function createFinishedVictoryRoot(): EmberPactRootState {
  const initial = createInitialState(fixedRandom, "player", "tactician");
  const state: EmberPactState = {
    ...initial,
    revision: 1,
    roundNumber: 7,
    combatants: initial.combatants.map((combatant) => (
      combatant.team === "dusk" ? { ...combatant, hp: 0, block: 0 } : combatant
    )),
    metrics: {
      ...initial.metrics,
      player: {
        ...initial.metrics.player,
        cardsPlayed: 9,
        damageDealt: 19,
        healingDone: 4,
        blockGranted: 8,
        combos: 3,
        defeats: 2,
        responses: 1,
        biggestHit: 6,
      },
    },
    status: "finished",
    winner: "dawn",
  };
  return startMatch(createDefaultRootState(), state);
}

function createSaveRecord(root: EmberPactRootState): EmberPactFixtureSave {
  return {
    schemaVersion: PACT_SAVE_SCHEMA_VERSION,
    savedAt: 0,
    snapshot: {
      gameId: "ember-pact",
      revision: root.revision,
      data: serializePactRootState(root),
    },
  };
}

async function installSaveRecord(page: Page, save: EmberPactFixtureSave): Promise<void> {
  await page.addInitScript(
    ({ key, record }) => {
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, JSON.stringify(record));
      }
    },
    { key: EMBER_PACT_SAVE_KEY, record: save },
  );
}

export async function installEmberPactSave(
  page: Page,
  root: EmberPactRootState,
): Promise<void> {
  await installSaveRecord(page, createSaveRecord(root));
}

export async function installFutureEmberPactSave(page: Page): Promise<void> {
  await installSaveRecord(page, {
    schemaVersion: FUTURE_EMBER_PACT_SCHEMA_VERSION,
    savedAt: 0,
    snapshot: {
      gameId: "ember-pact",
      revision: 87,
      data: FUTURE_EMBER_PACT_DATA,
    },
  });
}
