import { HERO_IDS, type HeroId } from "./heroes";
import { chooseHero, createInitialState } from "./engine";
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

export interface DingHeroDraft {
  /** 开局展示给人类玩家的三张候选武将。 */
  readonly options: readonly HeroId[];
}

export interface ActiveDingMatch {
  readonly state: DingState;
  readonly resultRecorded: boolean;
  /** 本局尚未完成的人类选将；选完后清除。 */
  readonly heroDraft?: DingHeroDraft;
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
      xuanji: emptyRecord(),
      jinyu: emptyRecord(),
      yueji: emptyRecord(),
      liexiao: emptyRecord(),
      wufeng: emptyRecord(),
      chongzhen: emptyRecord(),
      haoke: emptyRecord(),
      youjiao: emptyRecord(),
      junshi: emptyRecord(),
      panwei: emptyRecord(),
      fubi: emptyRecord(),
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

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function createHeroDraftOptions(random: () => number = Math.random): readonly HeroId[] {
  return shuffled(HERO_IDS, random).slice(0, 3);
}

/**
 * 开始一局带人类三选一的定鼎：候选武将之外的 6 名分配给三名 AI，
 * 人类席先放第一候选，选将完成后原地替换。
 */
export function startDingMatchWithHeroDraft(
  root: DingRootState,
  difficulty: DingDifficulty,
  random: () => number = Math.random,
): DingRootState {
  if (root.activeMatch) return root;
  const options = createHeroDraftOptions(random);
  const excluded = new Set(options);
  const aiHeroIds = shuffled(HERO_IDS.filter((heroId) => !excluded.has(heroId)), random);
  const state = createInitialState(random, difficulty, [options[0], ...aiHeroIds.slice(0, 3)]);
  const base = { ...root, preferences: { ...root.preferences, difficulty } };
  const started = startDingMatch(base, state);
  if (!started.activeMatch) return started;
  return {
    ...started,
    activeMatch: { ...started.activeMatch, heroDraft: { options } },
  };
}

export function chooseDingMatchHero(root: DingRootState, heroId: HeroId): DingRootState {
  const active = root.activeMatch;
  if (!active?.heroDraft || active.resultRecorded || !active.heroDraft.options.includes(heroId)) return root;
  const state = chooseHero(active.state, "south", heroId);
  if (state === active.state) return root;
  return {
    ...root,
    revision: root.revision + 1,
    activeMatch: { ...active, state, heroDraft: undefined },
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
