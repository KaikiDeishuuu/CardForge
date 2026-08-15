import type { HeroId } from "./heroes";
import type { DingDifficulty, DingState, IdentityId, MatchWinner } from "./types";

export interface DingPreferences {
  readonly difficulty: DingDifficulty;
}

export interface DingIdentityRecord {
  readonly games: number;
  readonly wins: number;
}

export interface DingHeroRecord {
  readonly games: number;
  readonly wins: number;
}

export interface DingLifetimeProfile {
  readonly gamesPlayed: number;
  readonly wins: number;
  readonly identityRecords: Readonly<Record<IdentityId, DingIdentityRecord>>;
  readonly heroRecords: Readonly<Record<HeroId, DingHeroRecord>>;
}

export interface ActiveDingMatch {
  readonly state: DingState;
  readonly resultRecorded: boolean;
}

export interface DingRootState {
  readonly revision: number;
  readonly preferences: DingPreferences;
  readonly lifetimeProfile: DingLifetimeProfile;
  readonly activeMatch?: ActiveDingMatch;
}

function emptyRecord(): DingIdentityRecord {
  return { games: 0, wins: 0 };
}

export function createEmptyDingProfile(): DingLifetimeProfile {
  return {
    gamesPlayed: 0,
    wins: 0,
    identityRecords: {
      lord: emptyRecord(),
      loyalist: emptyRecord(),
      rebel: emptyRecord(),
      renegade: emptyRecord(),
    },
    heroRecords: {
      redblade: emptyRecord(),
      ironward: emptyRecord(),
      springtide: emptyRecord(),
      cloudstep: emptyRecord(),
      whitesteed: emptyRecord(),
      lastwill: emptyRecord(),
      cleareye: emptyRecord(),
      scrollkeeper: emptyRecord(),
      nightowl: emptyRecord(),
    },
  };
}

export function createDefaultDingRootState(difficulty: DingDifficulty = "standard"): DingRootState {
  return {
    revision: 0,
    preferences: { difficulty },
    lifetimeProfile: createEmptyDingProfile(),
  };
}

function humanIdentityWon(identity: IdentityId, winner: MatchWinner): boolean {
  if (winner === "lord-side") return identity === "lord" || identity === "loyalist";
  return winner === identity;
}

function recordFinishedMatch(profile: DingLifetimeProfile, state: DingState): DingLifetimeProfile {
  if (state.status !== "finished" || state.winner === undefined) return profile;
  const human = state.players.find((player) => player.controller === "human");
  if (!human) return profile;
  const won = humanIdentityWon(human.identity, state.winner);
  const identity = profile.identityRecords[human.identity];
  const hero = profile.heroRecords[human.heroId as HeroId];
  return {
    gamesPlayed: profile.gamesPlayed + 1,
    wins: profile.wins + (won ? 1 : 0),
    identityRecords: {
      ...profile.identityRecords,
      [human.identity]: { games: identity.games + 1, wins: identity.wins + (won ? 1 : 0) },
    },
    heroRecords: {
      ...profile.heroRecords,
      [human.heroId as HeroId]: { games: hero.games + 1, wins: hero.wins + (won ? 1 : 0) },
    },
  };
}

export function updatePreferences(
  root: DingRootState,
  difficulty: DingDifficulty,
): DingRootState {
  if (root.preferences.difficulty === difficulty) return root;
  return { ...root, revision: root.revision + 1, preferences: { difficulty } };
}

export function startDingMatch(root: DingRootState, state: DingState): DingRootState {
  if (root.activeMatch) return root;
  const finished = state.status === "finished";
  return {
    ...root,
    revision: root.revision + 1,
    preferences: { ...root.preferences, difficulty: state.difficulty },
    lifetimeProfile: finished ? recordFinishedMatch(root.lifetimeProfile, state) : root.lifetimeProfile,
    activeMatch: { state, resultRecorded: finished },
  };
}

export function updateActiveDingMatch(root: DingRootState, state: DingState): DingRootState {
  const active = root.activeMatch;
  if (!active
    || active.resultRecorded
    || active.state.status !== "playing"
    || state.revision <= active.state.revision) return root;

  const finished = state.status === "finished";
  const preferences = state.difficulty === root.preferences.difficulty
    ? root.preferences
    : { difficulty: state.difficulty };
  return {
    ...root,
    revision: root.revision + 1,
    preferences,
    lifetimeProfile: finished ? recordFinishedMatch(root.lifetimeProfile, state) : root.lifetimeProfile,
    activeMatch: { state, resultRecorded: finished },
  };
}

export function dismissDingMatch(root: DingRootState): DingRootState {
  const active = root.activeMatch;
  if (!active || !active.resultRecorded) return root;
  return { ...root, revision: root.revision + 1, activeMatch: undefined };
}

export function resetDingProfile(root: DingRootState): DingRootState {
  if (root.activeMatch) return root;
  return {
    ...root,
    revision: root.revision + 1,
    lifetimeProfile: createEmptyDingProfile(),
  };
}
