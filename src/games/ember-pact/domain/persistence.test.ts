import { describe, expect, it } from "vitest";
import {
  abandonMatch,
  createDefaultRootState,
  dismissFinishedMatch,
  startMatch,
  updateActiveMatch,
  updatePreferences,
  type EmberPactRootState,
} from "./session";
import { COMBATANT_SEEDS } from "./data";
import { BLOCK_LIMIT, createInitialState, endTurn, playCard } from "./engine";
import {
  PACT_SAVE_SCHEMA_VERSION,
  isValidPactMatchState,
  restorePactRootState,
  serializePactRootState,
} from "./persistence";
import type {
  CardInstance,
  Combatant,
  Difficulty,
  EmberPactState,
  MatchWinner,
} from "./types";

const fixedRandom = () => 0.42;

const LEGACY_DECK_RECIPES: Readonly<Record<string, readonly string[]>> = {
  player: [
    "sever", "sever", "sever", "sever", "plate", "plate", "plate",
    "rekindle", "fracture", "fracture", "temper", "temper", "aegis", "aegis",
  ],
  luna: [
    "sever", "sever", "plate", "plate", "rekindle", "rekindle", "rekindle",
    "rekindle", "refine", "refine", "refine", "temper", "rally", "rally",
  ],
  scar: [
    "sever", "sever", "sever", "sever", "plate", "plate", "fracture",
    "fracture", "fracture", "siphon", "siphon", "siphon", "temper", "temper",
  ],
  ember: [
    "sever", "sever", "sever", "plate", "plate", "cinder", "cinder",
    "cinder", "emberwind", "emberwind", "emberwind", "fracture", "temper", "temper",
  ],
};

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

function moveCardToHand(
  state: EmberPactState,
  combatantId: string,
  definitionId: string,
): { state: EmberPactState; card: CardInstance } {
  const combatant = state.combatants.find((candidate) => candidate.id === combatantId)!;
  const allCards = [...combatant.hand, ...combatant.deck, ...combatant.discard];
  const card = allCards.find((candidate) => candidate.definitionId === definitionId)!;
  const without = (cards: readonly CardInstance[]) => cards.filter((candidate) => candidate.uid !== card.uid);
  return {
    card,
    state: updateCombatant(state, combatantId, {
      hand: [card, ...without(combatant.hand)],
      deck: without(combatant.deck),
      discard: without(combatant.discard),
    }),
  };
}

function finishedState(
  initial: EmberPactState,
  winner: MatchWinner,
  difficulty: Difficulty = initial.difficulty,
): EmberPactState {
  const combatants = initial.combatants.map((combatant) => {
    const defeated = winner === "draw" || combatant.team !== winner;
    return defeated ? { ...combatant, hp: 0, block: 0 } : combatant;
  });
  return {
    ...initial,
    revision: initial.revision + 1,
    difficulty,
    combatants,
    status: "finished",
    winner,
    phase: "action",
    pendingAttack: undefined,
  };
}

function legacyState(overrides: Record<string, unknown> = {}): unknown {
  return { ...withoutV2Fields(createInitialState(fixedRandom)), ...overrides };
}

function withoutV2Fields(state: EmberPactState): Record<string, unknown> {
  const legacy: Record<string, unknown> = { ...state };
  for (const key of [
    "actionsRemaining", "attackUsed", "phase", "pendingAttack", "difficulty", "metrics",
  ]) delete legacy[key];
  legacy.combatants = state.combatants.map((combatant) => {
    const cards = LEGACY_DECK_RECIPES[combatant.id].map((definitionId, index) => ({
      uid: `legacy-${combatant.id}-${index}-${definitionId}`,
      definitionId,
    }));
    const oldCombatant: Record<string, unknown> = {
      ...combatant,
      hand: cards.slice(0, 4),
      deck: cards.slice(4),
      discard: [],
    };
    delete oldCombatant.reviveAvailable;
    return oldCombatant;
  });
  return legacy;
}

function roundTrip(root: EmberPactRootState): EmberPactRootState | undefined {
  return restorePactRootState(
    PACT_SAVE_SCHEMA_VERSION,
    JSON.parse(JSON.stringify(serializePactRootState(root))),
  );
}

describe("Ember Pact session and persistence", () => {
  it("creates preferences and keeps them locked while a match is active", () => {
    const initial = createDefaultRootState();
    expect(initial.preferences).toEqual({ difficulty: "standard", guideEnabled: true });

    const configured = updatePreferences(initial, { difficulty: "tactician", guideEnabled: false });
    expect(configured.preferences).toEqual({ difficulty: "tactician", guideEnabled: false });
    expect(configured.revision).toBe(1);

    const active = startMatch(configured, createInitialState(fixedRandom, "player", "tactician"));
    expect(updatePreferences(active, { difficulty: "novice" })).toBe(active);
  });

  it("records a finished match exactly once and preserves it for the restored result screen", () => {
    const table = createInitialState(fixedRandom, "player", "tactician");
    let root = startMatch(createDefaultRootState(), table);
    const finished = finishedState({
      ...table,
      roundNumber: 7,
      metrics: {
        ...table.metrics,
        player: {
          ...table.metrics.player,
          damageDealt: 19,
          healingDone: 4,
          blockGranted: 8,
          combos: 3,
          defeats: 2,
          biggestHit: 6,
        },
      },
    }, "dawn", "tactician");

    root = updateActiveMatch(root, finished);
    expect(root.activeMatch).toEqual({ state: finished, resultRecorded: true });
    expect(root.lifetimeProfile).toMatchObject({
      gamesPlayed: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      currentWinStreak: 1,
      bestWinStreak: 1,
      fastestWinRounds: 7,
      playerMetrics: {
        damageDealt: 19,
        healingDone: 4,
        blockGranted: 8,
        combos: 3,
        defeats: 2,
      },
    });
    expect(root.lifetimeProfile.combatants.player).toEqual({
      gamesPlayed: 1,
      wins: 1,
      highestDifficulty: "tactician",
    });

    const alreadyRecorded = updateActiveMatch(root, { ...finished, revision: finished.revision + 1 });
    expect(alreadyRecorded).toBe(root);
    expect(roundTrip(root)).toEqual(root);

    const dismissed = dismissFinishedMatch(root);
    const replay = startMatch(dismissed, createInitialState(fixedRandom, "player", "tactician"));
    expect(dismissFinishedMatch(replay)).toBe(replay);
    expect(replay.lifetimeProfile).toMatchObject({ wins: 1, currentWinStreak: 1, abandons: 0 });
  });

  it("tracks losses, draws and abandons without inflating completed games", () => {
    let root = startMatch(createDefaultRootState(), createInitialState(fixedRandom));
    root = updateActiveMatch(root, finishedState(root.activeMatch!.state, "dusk"));
    expect(root.lifetimeProfile).toMatchObject({ gamesPlayed: 1, losses: 1, currentWinStreak: 0 });

    root = abandonMatch(root); // dismiss a recorded result, not an abandonment
    root = startMatch(root, createInitialState(fixedRandom));
    root = updateActiveMatch(root, finishedState(root.activeMatch!.state, "draw"));
    expect(root.lifetimeProfile).toMatchObject({ gamesPlayed: 2, draws: 1, abandons: 0 });

    root = abandonMatch(root);
    root = startMatch(root, createInitialState(fixedRandom));
    root = abandonMatch(root);
    expect(root.lifetimeProfile).toMatchObject({ gamesPlayed: 2, abandons: 1, currentWinStreak: 0 });
    expect(abandonMatch(root)).toBe(root);
  });

  it("round-trips a live response window with catalog cards and pending attack consistency", () => {
    let table = createInitialState(fixedRandom);
    const attack = moveCardToHand(table, "player", "sever");
    table = attack.state;
    table = moveCardToHand(table, "scar", "deflect").state;
    const response = playCard(table, "player", attack.card.uid, "scar");
    expect(response.phase).toBe("response");

    const root = startMatch(createDefaultRootState(), response);
    expect(roundTrip(root)).toEqual(root);
  });

  it("migrates a v1 match and supplies all fields required by the new engine", () => {
    const old = legacyState();
    const restored = restorePactRootState(1, old);
    const state = restored?.activeMatch?.state;

    expect(restored?.preferences).toEqual({ difficulty: "standard", guideEnabled: true });
    expect(restored?.lifetimeProfile.gamesPlayed).toBe(0);
    expect(restored?.activeMatch?.resultRecorded).toBe(false);
    expect(state).toMatchObject({
      actionsRemaining: 2,
      attackUsed: false,
      phase: "action",
      difficulty: "standard",
    });
    expect(state?.pendingAttack).toBeUndefined();
    expect(state?.combatants.every((combatant) => combatant.reviveAvailable)).toBe(true);
    expect(state?.combatants.every((combatant) => (
      combatant.hand.length + combatant.deck.length + combatant.discard.length === 18
      && [...combatant.hand, ...combatant.deck, ...combatant.discard]
        .some((card) => card.definitionId === "deflect")
    ))).toBe(true);
    expect(Object.keys(state?.metrics ?? {}).sort()).toEqual(["ember", "luna", "player", "scar"]);
    expect(state?.metrics.player.damageDealt).toBe(0);
  });

  it("normalizes legacy combatant metadata and adds a missing action summary", () => {
    let oldTable = createInitialState(fixedRandom);
    oldTable = endTurn(oldTable, "player");
    const legacy = withoutV2Fields(oldTable);
    const combatants = (legacy.combatants as Combatant[]).map((combatant) => combatant.id === "player"
      ? {
          ...combatant,
          displayName: "旧名",
          title: "旧称号",
          maxHp: 24,
          hp: 24,
          block: 12,
          statuses: [{ id: "burning" as const, remainingTurns: 2 }],
        }
      : combatant);
    const lastAction = { ...(legacy.lastAction ?? {}) } as Record<string, unknown>;
    delete lastAction.summary;

    const restored = restorePactRootState(1, { ...legacy, combatants, lastAction });
    const migratedPlayer = restored?.activeMatch?.state.combatants.find((combatant) => combatant.id === "player");
    const currentPlayer = COMBATANT_SEEDS.find((combatant) => combatant.id === "player")!;
    expect(migratedPlayer).toMatchObject({
      displayName: currentPlayer.displayName,
      title: currentPlayer.title,
      maxHp: currentPlayer.maxHp,
      hp: currentPlayer.maxHp,
      block: BLOCK_LIMIT,
    });
    expect(migratedPlayer?.statuses[0].sourceActorId).toBeUndefined();
    expect(restored?.activeMatch?.state.lastAction?.summary).toBeTypeOf("string");
  });

  it("migrates a finished v1 result once and leaves it available for the summary", () => {
    const current = createInitialState(fixedRandom, "scar", "standard");
    const legacy = withoutV2Fields(current);
    const combatants = (legacy.combatants as Combatant[]).map((combatant) => (
      combatant.team === "dawn" ? { ...combatant, hp: 0, block: 0 } : combatant
    ));
    const finishedLegacy = {
      ...legacy,
      revision: 1,
      combatants,
      status: "finished",
      winner: "dusk",
    };
    const restored = restorePactRootState(1, finishedLegacy);
    expect(restored?.activeMatch?.resultRecorded).toBe(true);
    expect(restored?.lifetimeProfile).toMatchObject({ gamesPlayed: 1, wins: 1 });
    expect(restored?.lifetimeProfile.combatants.scar).toMatchObject({ gamesPlayed: 1, wins: 1 });
  });

  it("rejects an invalid root but preserves the archive when only its active table is malformed", () => {
    const table = createInitialState(fixedRandom);
    const valid = startMatch(createDefaultRootState(), table);
    expect(restorePactRootState(99, valid)).toBeUndefined();
    expect(restorePactRootState(2, undefined)).toBeUndefined();
    expect(restorePactRootState(2, {
      ...valid,
      preferences: { difficulty: "impossible", guideEnabled: true },
    })).toBeUndefined();

    const unknownCard = updateCombatant(table, "player", {
      hand: [{ ...table.combatants[0].hand[0], definitionId: "not-in-catalog" }, ...table.combatants[0].hand.slice(1)],
    });
    expect(isValidPactMatchState(unknownCard)).toBe(false);
    expect(restorePactRootState(2, {
      ...valid,
      activeMatch: { state: unknownCard, resultRecorded: false },
    })?.activeMatch).toBeUndefined();

    const first = table.combatants[0].hand[0];
    const duplicateUid = updateCombatant(table, "luna", {
      hand: [{ ...table.combatants[1].hand[0], uid: first.uid }, ...table.combatants[1].hand.slice(1)],
    });
    expect(restorePactRootState(2, {
      ...valid,
      activeMatch: { state: duplicateUid, resultRecorded: false },
    })?.activeMatch).toBeUndefined();

    const missingPending = { ...table, phase: "response" as const, attackUsed: true };
    expect(restorePactRootState(2, {
      ...valid,
      activeMatch: { state: missingPending, resultRecorded: false },
    })?.activeMatch).toBeUndefined();

    const deadActive = updateCombatant(table, table.activePlayerId, { hp: 0 });
    expect(restorePactRootState(2, {
      ...valid,
      activeMatch: { state: deadActive, resultRecorded: false },
    })?.activeMatch).toBeUndefined();

    const missingReviveFlag = {
      ...table,
      combatants: table.combatants.map((combatant) => {
        if (combatant.id !== "player") return combatant;
        const malformed: Record<string, unknown> = { ...combatant };
        delete malformed.reviveAvailable;
        return malformed;
      }),
    };
    expect(restorePactRootState(2, {
      ...valid,
      activeMatch: { state: missingReviveFlag, resultRecorded: false },
    })?.activeMatch).toBeUndefined();

    let archived = startMatch(createDefaultRootState(), finishedState(table, "dawn"));
    archived = dismissFinishedMatch(archived);
    archived = startMatch(archived, table);
    const restoredArchive = restorePactRootState(2, {
      ...archived,
      activeMatch: { state: unknownCard, resultRecorded: false },
    });
    expect(restoredArchive?.lifetimeProfile).toMatchObject({ gamesPlayed: 1, wins: 1 });
    expect(restoredArchive?.activeMatch).toBeUndefined();
  });

  it("strictly rejects negative metrics and inconsistent lifetime aggregates", () => {
    const table = createInitialState(fixedRandom);
    const valid = startMatch(createDefaultRootState(), table);
    const badMetric = {
      ...table,
      metrics: { ...table.metrics, player: { ...table.metrics.player, damageDealt: -1 } },
    };
    expect(restorePactRootState(2, {
      ...valid,
      activeMatch: { state: badMetric, resultRecorded: false },
    })?.activeMatch).toBeUndefined();
    expect(restorePactRootState(2, {
      ...valid,
      lifetimeProfile: { ...valid.lifetimeProfile, wins: 1 },
    })).toBeUndefined();
    expect(restorePactRootState(2, {
      ...valid,
      lifetimeProfile: {
        ...valid.lifetimeProfile,
        playerMetrics: { ...valid.lifetimeProfile.playerMetrics, combos: Number.NaN },
      },
    })).toBeUndefined();
  });

  it("accepts the largest safe revision and rejects unsafe revisions in every save generation", () => {
    const root = createDefaultRootState();
    expect(restorePactRootState(2, {
      ...root,
      revision: Number.MAX_SAFE_INTEGER,
    })?.revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(restorePactRootState(2, {
      ...root,
      revision: Number.MAX_SAFE_INTEGER + 1,
    })).toBeUndefined();

    const table = createInitialState(fixedRandom);
    const active = startMatch(root, table);
    expect(restorePactRootState(2, {
      ...active,
      activeMatch: {
        state: { ...table, revision: Number.MAX_SAFE_INTEGER + 1 },
        resultRecorded: false,
      },
    })?.activeMatch).toBeUndefined();
    expect(restorePactRootState(1, legacyState({
      revision: Number.MAX_SAFE_INTEGER + 1,
    }))).toBeUndefined();
  });

  it("rejects malformed legacy saves rather than inventing an active game", () => {
    expect(restorePactRootState(1, legacyState({ combatants: [] }))).toBeUndefined();
    expect(restorePactRootState(1, legacyState({ rngSeed: Number.POSITIVE_INFINITY }))).toBeUndefined();
    expect(restorePactRootState(1, legacyState({ activePlayerId: "stranger" }))).toBeUndefined();
    expect(restorePactRootState(1, legacyState({ status: "finished", winner: undefined }))).toBeUndefined();
  });
});
