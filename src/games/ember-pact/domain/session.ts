import type { CombatantMetrics, Difficulty, EmberPactState } from "./types";

export const PROFILE_COMBATANT_IDS = ["player", "luna", "scar", "ember"] as const;

export type ProfileCombatantId = typeof PROFILE_COMBATANT_IDS[number];

export interface EmberPactPreferences {
  readonly difficulty: Difficulty;
  readonly guideEnabled: boolean;
}

export interface CombatantProfile {
  readonly gamesPlayed: number;
  readonly wins: number;
  /** Highest difficulty won with this combatant. */
  readonly highestDifficulty?: Difficulty;
}

export interface LifetimePlayerMetrics {
  readonly damageDealt: number;
  readonly healingDone: number;
  readonly blockGranted: number;
  readonly combos: number;
  readonly defeats: number;
}

export interface EmberPactLifetimeProfile {
  /** Completed matches. Abandoned matches are tracked separately. */
  readonly gamesPlayed: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly abandons: number;
  readonly currentWinStreak: number;
  readonly bestWinStreak: number;
  readonly fastestWinRounds?: number;
  readonly combatants: Readonly<Record<ProfileCombatantId, CombatantProfile>>;
  readonly playerMetrics: LifetimePlayerMetrics;
}

export interface ActiveEmberPactMatch {
  readonly state: EmberPactState;
  /** Makes restoring a finished result safe without counting it a second time. */
  readonly resultRecorded: boolean;
}

export interface EmberPactRootState {
  readonly revision: number;
  readonly preferences: EmberPactPreferences;
  readonly lifetimeProfile: EmberPactLifetimeProfile;
  /** A finished match deliberately remains here until the result screen is dismissed. */
  readonly activeMatch?: ActiveEmberPactMatch;
}

const DIFFICULTY_RANK: Readonly<Record<Difficulty, number>> = {
  novice: 0,
  standard: 1,
  tactician: 2,
};

function emptyCombatantProfile(): CombatantProfile {
  return { gamesPlayed: 0, wins: 0 };
}

export function createEmptyLifetimeProfile(): EmberPactLifetimeProfile {
  return {
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    abandons: 0,
    currentWinStreak: 0,
    bestWinStreak: 0,
    combatants: {
      player: emptyCombatantProfile(),
      luna: emptyCombatantProfile(),
      scar: emptyCombatantProfile(),
      ember: emptyCombatantProfile(),
    },
    playerMetrics: {
      damageDealt: 0,
      healingDone: 0,
      blockGranted: 0,
      combos: 0,
      defeats: 0,
    },
  };
}

export function createDefaultRootState(): EmberPactRootState {
  return {
    revision: 0,
    preferences: { difficulty: "standard", guideEnabled: true },
    lifetimeProfile: createEmptyLifetimeProfile(),
  };
}

export function isProfileCombatantId(value: string): value is ProfileCombatantId {
  return PROFILE_COMBATANT_IDS.includes(value as ProfileCombatantId);
}

export function updatePreferences(
  root: EmberPactRootState,
  update: Partial<EmberPactPreferences>,
): EmberPactRootState {
  if (root.activeMatch) return root;
  const preferences = { ...root.preferences, ...update };
  if (preferences.difficulty === root.preferences.difficulty
    && preferences.guideEnabled === root.preferences.guideEnabled) return root;
  return { ...root, revision: root.revision + 1, preferences };
}

function humanCombatantId(state: EmberPactState): ProfileCombatantId | undefined {
  const humans = state.combatants.filter((combatant) => combatant.controller === "human");
  if (humans.length !== 1 || !isProfileCombatantId(humans[0].id)) return undefined;
  return humans[0].id;
}

function zeroMetrics(): CombatantMetrics {
  return {
    cardsPlayed: 0,
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    blockGranted: 0,
    combos: 0,
    defeats: 0,
    responses: 0,
    biggestHit: 0,
  };
}

function higherDifficulty(
  current: Difficulty | undefined,
  candidate: Difficulty,
): Difficulty {
  return current === undefined || DIFFICULTY_RANK[candidate] > DIFFICULTY_RANK[current]
    ? candidate
    : current;
}

function recordFinishedMatch(
  profile: EmberPactLifetimeProfile,
  state: EmberPactState,
): EmberPactLifetimeProfile {
  const humanId = humanCombatantId(state);
  if (!humanId || state.status !== "finished" || state.winner === undefined) return profile;
  const human = state.combatants.find((combatant) => combatant.id === humanId)!;
  const won = state.winner !== "draw" && state.winner === human.team;
  const drew = state.winner === "draw";
  const lost = !won && !drew;
  const currentWinStreak = won ? profile.currentWinStreak + 1 : 0;
  const metrics = state.metrics[humanId] ?? zeroMetrics();
  const currentCombatant = profile.combatants[humanId];
  const combatantProfile: CombatantProfile = {
    gamesPlayed: currentCombatant.gamesPlayed + 1,
    wins: currentCombatant.wins + (won ? 1 : 0),
    highestDifficulty: won
      ? higherDifficulty(currentCombatant.highestDifficulty, state.difficulty)
      : currentCombatant.highestDifficulty,
  };

  return {
    ...profile,
    gamesPlayed: profile.gamesPlayed + 1,
    wins: profile.wins + (won ? 1 : 0),
    losses: profile.losses + (lost ? 1 : 0),
    draws: profile.draws + (drew ? 1 : 0),
    currentWinStreak,
    bestWinStreak: Math.max(profile.bestWinStreak, currentWinStreak),
    fastestWinRounds: won
      ? profile.fastestWinRounds === undefined
        ? state.roundNumber
        : Math.min(profile.fastestWinRounds, state.roundNumber)
      : profile.fastestWinRounds,
    combatants: { ...profile.combatants, [humanId]: combatantProfile },
    playerMetrics: {
      damageDealt: profile.playerMetrics.damageDealt + metrics.damageDealt,
      healingDone: profile.playerMetrics.healingDone + metrics.healingDone,
      blockGranted: profile.playerMetrics.blockGranted + metrics.blockGranted,
      combos: profile.playerMetrics.combos + metrics.combos,
      defeats: profile.playerMetrics.defeats + metrics.defeats,
    },
  };
}

/**
 * Opens a match without discarding the lifetime archive. A finished state is
 * accepted for v1 migration and is recorded immediately exactly once.
 */
export function startMatch(
  root: EmberPactRootState,
  state: EmberPactState,
): EmberPactRootState {
  if (root.activeMatch) return root;
  const finished = state.status === "finished";
  return {
    ...root,
    revision: root.revision + 1,
    preferences: { ...root.preferences, difficulty: state.difficulty },
    lifetimeProfile: finished
      ? recordFinishedMatch(root.lifetimeProfile, state)
      : root.lifetimeProfile,
    activeMatch: { state, resultRecorded: finished },
  };
}

export function updateActiveMatch(
  root: EmberPactRootState,
  state: EmberPactState,
): EmberPactRootState {
  const active = root.activeMatch;
  if (!active
    || active.resultRecorded
    || active.state.status !== "playing"
    || state.revision <= active.state.revision
    || state.difficulty !== active.state.difficulty
    || humanCombatantId(state) !== humanCombatantId(active.state)) return root;

  const finished = state.status === "finished";
  return {
    ...root,
    revision: root.revision + 1,
    lifetimeProfile: finished
      ? recordFinishedMatch(root.lifetimeProfile, state)
      : root.lifetimeProfile,
    activeMatch: { state, resultRecorded: finished },
  };
}

/**
 * Leaves the current table. Abandoning a live match is archived once; closing
 * an already recorded result only removes the result screen state.
 */
export function abandonMatch(root: EmberPactRootState): EmberPactRootState {
  const active = root.activeMatch;
  if (!active) return root;
  const abandoned = active.state.status === "playing";
  return {
    ...root,
    revision: root.revision + 1,
    lifetimeProfile: abandoned
      ? {
          ...root.lifetimeProfile,
          abandons: root.lifetimeProfile.abandons + 1,
          currentWinStreak: 0,
        }
      : root.lifetimeProfile,
    activeMatch: undefined,
  };
}

export const abandon = abandonMatch;

/** Removes a recorded result without ever treating a live rematch as abandoned. */
export function dismissFinishedMatch(root: EmberPactRootState): EmberPactRootState {
  const active = root.activeMatch;
  if (!active || active.state.status !== "finished" || !active.resultRecorded) return root;
  return {
    ...root,
    revision: root.revision + 1,
    activeMatch: undefined,
  };
}

export function resetLifetimeProfile(root: EmberPactRootState): EmberPactRootState {
  if (root.activeMatch) return root;
  return {
    ...root,
    revision: root.revision + 1,
    lifetimeProfile: createEmptyLifetimeProfile(),
  };
}
