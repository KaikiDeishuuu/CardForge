import { DEFAULT_RULES, HIGH_PRESSURE_RULES, SINGLE_DECK_RULES } from "./engine";
import type { TwentyOneRules, TwentyOneSettlement, TwentyOneState } from "./types";

export type RulesPresetId = "standard-six" | "single-deck" | "high-pressure-eight" | "custom";
export type ChallengeId = "warmup" | "double" | "endurance";
export type SessionMode = "classic" | "challenge";
export type SessionEndReason = "left-table" | "bankrupt" | "challenge-cleared" | "round-limit";

export interface TwentyOnePreferences {
  readonly rules: TwentyOneRules;
  readonly assistEnabled: boolean;
  /** 上一次下的注，用于牌桌的“重复上一注”快捷按钮。 */
  readonly lastBet?: number;
}

export interface TwentyOneStats {
  readonly roundsPlayed: number;
  readonly handsWon: number;
  readonly handsLost: number;
  readonly handsPushed: number;
  readonly blackjacks: number;
  readonly playerBusts: number;
  readonly surrenders: number;
  readonly totalWagered: number;
  readonly netChips: number;
  readonly insurancePurchases: number;
  readonly insuranceNet: number;
  readonly biggestRoundWin: number;
  readonly peakChips: number;
  readonly currentWinStreak: number;
  readonly bestWinStreak: number;
}

export interface ChallengeRecordBucket {
  readonly runs: number;
  readonly clears: number;
  readonly bestFinalChips?: number;
}

export interface ChallengeRecord {
  readonly assisted: ChallengeRecordBucket;
  readonly unassisted: ChallengeRecordBucket;
}

export type ChallengeRecords = Readonly<Record<ChallengeId, ChallengeRecord>>;

export interface ActiveTwentyOneSession {
  readonly mode: SessionMode;
  readonly challengeId?: ChallengeId;
  readonly table: TwentyOneState;
  readonly roundsCompleted: number;
  readonly sessionStats: TwentyOneStats;
  /** Only becomes true after the player actually requests a hint. */
  readonly assisted: boolean;
  readonly status: "playing" | "summary";
  readonly endReason?: SessionEndReason;
  /** Prevents a restored settled table from being counted more than once. */
  readonly consumedSettlementRevision?: number;
}

export interface TwentyOneRootState {
  readonly revision: number;
  readonly preferences: TwentyOnePreferences;
  readonly lifetimeStats: TwentyOneStats;
  readonly challengeRecords: ChallengeRecords;
  readonly activeSession?: ActiveTwentyOneSession;
}

export interface ChallengeDefinition {
  readonly id: ChallengeId;
  readonly name: string;
  readonly eyebrow: string;
  readonly description: string;
  readonly roundLimit: number;
  readonly targetChips: number;
  /** Reach challenges may finish as soon as the chip target is reached. */
  readonly completion: "reach-target" | "finish-limit";
}

export const CLASSIC_STARTING_CHIPS = 500;
export const MINIMUM_PLAYABLE_CHIPS = 10;

// 预设规则以 engine 的常量为唯一来源，避免两处重复维护后漂移。
export const STANDARD_SIX_RULES: TwentyOneRules = DEFAULT_RULES;
export { SINGLE_DECK_RULES };
export const HIGH_PRESSURE_EIGHT_RULES: TwentyOneRules = HIGH_PRESSURE_RULES;

export const RULE_PRESETS: Readonly<Record<Exclude<RulesPresetId, "custom">, TwentyOneRules>> = {
  "standard-six": STANDARD_SIX_RULES,
  "single-deck": SINGLE_DECK_RULES,
  "high-pressure-eight": HIGH_PRESSURE_EIGHT_RULES,
};

export const CHALLENGES: Readonly<Record<ChallengeId, ChallengeDefinition>> = {
  warmup: {
    id: "warmup",
    name: "热身十手",
    eyebrow: "WARM UP",
    description: "十手之内把 500 枚筹码带到 650。",
    roundLimit: 10,
    targetChips: 650,
    completion: "reach-target",
  },
  double: {
    id: "double",
    name: "翻倍试炼",
    eyebrow: "DOUBLE DOWN",
    description: "二十手之内把 500 枚筹码带到 1000。",
    roundLimit: 20,
    targetChips: 1000,
    completion: "reach-target",
  },
  endurance: {
    id: "endurance",
    name: "三十手耐力",
    eyebrow: "ENDURANCE",
    description: "完成三十手，并守住至少 500 枚筹码。",
    roundLimit: 30,
    targetChips: 500,
    completion: "finish-limit",
  },
};

export function createEmptyStats(initialChips = 0): TwentyOneStats {
  return {
    roundsPlayed: 0,
    handsWon: 0,
    handsLost: 0,
    handsPushed: 0,
    blackjacks: 0,
    playerBusts: 0,
    surrenders: 0,
    totalWagered: 0,
    netChips: 0,
    insurancePurchases: 0,
    insuranceNet: 0,
    biggestRoundWin: 0,
    peakChips: initialChips,
    currentWinStreak: 0,
    bestWinStreak: 0,
  };
}

function emptyRecordBucket(): ChallengeRecordBucket {
  return { runs: 0, clears: 0 };
}

function emptyChallengeRecord(): ChallengeRecord {
  return { assisted: emptyRecordBucket(), unassisted: emptyRecordBucket() };
}

export function createEmptyChallengeRecords(): ChallengeRecords {
  return {
    warmup: emptyChallengeRecord(),
    double: emptyChallengeRecord(),
    endurance: emptyChallengeRecord(),
  };
}

export function createDefaultRootState(): TwentyOneRootState {
  return {
    revision: 0,
    preferences: { rules: STANDARD_SIX_RULES, assistEnabled: false, lastBet: 25 },
    lifetimeStats: createEmptyStats(CLASSIC_STARTING_CHIPS),
    challengeRecords: createEmptyChallengeRecords(),
  };
}

function rulesEqual(left: TwentyOneRules, right: TwentyOneRules): boolean {
  return left.deckCount === right.deckCount
    && left.dealerSoft17 === right.dealerSoft17
    && left.blackjackPayout === right.blackjackPayout
    && left.maxPlayerHands === right.maxPlayerHands
    && left.doubleAfterSplit === right.doubleAfterSplit
    && left.resplitAces === right.resplitAces
    && left.hitSplitAces === right.hitSplitAces
    && left.allowInsurance === right.allowInsurance
    && left.allowLateSurrender === right.allowLateSurrender;
}

export function identifyRulesPreset(rules: TwentyOneRules): RulesPresetId {
  if (rulesEqual(rules, STANDARD_SIX_RULES)) return "standard-six";
  if (rulesEqual(rules, SINGLE_DECK_RULES)) return "single-deck";
  if (rulesEqual(rules, HIGH_PRESSURE_EIGHT_RULES)) return "high-pressure-eight";
  return "custom";
}

export function updatePreferences(
  root: TwentyOneRootState,
  preferences: TwentyOnePreferences,
): TwentyOneRootState {
  if (root.activeSession) return root;
  return { ...root, revision: root.revision + 1, preferences };
}

/** 记录最近一次下注；对局进行中也可调用，不影响牌桌状态。 */
export function rememberBet(root: TwentyOneRootState, lastBet: number): TwentyOneRootState {
  if (root.preferences.lastBet === lastBet) return root;
  return {
    ...root,
    revision: root.revision + 1,
    preferences: { ...root.preferences, lastBet },
  };
}

export function setAssistEnabled(root: TwentyOneRootState, assistEnabled: boolean): TwentyOneRootState {
  if (root.preferences.assistEnabled === assistEnabled) return root;
  return {
    ...root,
    revision: root.revision + 1,
    preferences: { ...root.preferences, assistEnabled },
  };
}

export function startClassicSession(
  root: TwentyOneRootState,
  table: TwentyOneState,
): TwentyOneRootState {
  if (root.activeSession) return root;
  return {
    ...root,
    revision: root.revision + 1,
    activeSession: {
      mode: "classic",
      table,
      roundsCompleted: 0,
      sessionStats: createEmptyStats(table.chips),
      assisted: false,
      status: "playing",
    },
  };
}

export function startChallengeSession(
  root: TwentyOneRootState,
  challengeId: ChallengeId,
  table: TwentyOneState,
): TwentyOneRootState {
  if (root.activeSession) return root;
  return {
    ...root,
    revision: root.revision + 1,
    challengeRecords: recordChallengeStart(root.challengeRecords, challengeId),
    activeSession: {
      mode: "challenge",
      challengeId,
      table,
      roundsCompleted: 0,
      sessionStats: createEmptyStats(table.chips),
      assisted: false,
      status: "playing",
    },
  };
}

/**
 * Consume the single settlement object once. The table's hand statuses provide
 * the only extra fact settlement intentionally omits: whether a losing hand busted.
 */
export function addSettlementToStats(
  stats: TwentyOneStats,
  settlement: TwentyOneSettlement,
  table: TwentyOneState,
): TwentyOneStats {
  const won = settlement.handResults.filter((result) => result.outcome === "win" || result.outcome === "blackjack").length;
  const lost = settlement.handResults.filter((result) => result.outcome === "loss" || result.outcome === "surrender").length;
  const pushed = settlement.handResults.filter((result) => result.outcome === "push").length;
  const blackjacks = settlement.handResults.filter((result) => result.outcome === "blackjack").length;
  const surrenders = settlement.handResults.filter((result) => result.outcome === "surrender").length;
  const busts = table.hands.filter((hand) => hand.status === "busted").length;
  const nextStreak = settlement.net > 0
    ? stats.currentWinStreak + 1
    : settlement.net < 0 ? 0 : stats.currentWinStreak;

  return {
    roundsPlayed: stats.roundsPlayed + 1,
    handsWon: stats.handsWon + won,
    handsLost: stats.handsLost + lost,
    handsPushed: stats.handsPushed + pushed,
    blackjacks: stats.blackjacks + blackjacks,
    playerBusts: stats.playerBusts + busts,
    surrenders: stats.surrenders + surrenders,
    totalWagered: stats.totalWagered + settlement.totalWagered,
    netChips: stats.netChips + settlement.net,
    insurancePurchases: stats.insurancePurchases + (settlement.insurance.wager > 0 ? 1 : 0),
    insuranceNet: stats.insuranceNet + settlement.insurance.net,
    biggestRoundWin: Math.max(stats.biggestRoundWin, settlement.net),
    peakChips: Math.max(stats.peakChips, table.chips),
    currentWinStreak: nextStreak,
    bestWinStreak: Math.max(stats.bestWinStreak, nextStreak),
  };
}

interface ChallengeVerdict {
  readonly finished: boolean;
  readonly cleared: boolean;
  readonly reason?: SessionEndReason;
}

export function getChallengeVerdict(
  challengeId: ChallengeId,
  roundsCompleted: number,
  chips: number,
): ChallengeVerdict {
  const challenge = CHALLENGES[challengeId];
  if (chips < MINIMUM_PLAYABLE_CHIPS) return { finished: true, cleared: false, reason: "bankrupt" };
  if (challenge.completion === "reach-target" && chips >= challenge.targetChips) {
    return { finished: true, cleared: true, reason: "challenge-cleared" };
  }
  if (roundsCompleted < challenge.roundLimit) return { finished: false, cleared: false };
  const cleared = chips >= challenge.targetChips;
  return { finished: true, cleared, reason: cleared ? "challenge-cleared" : "round-limit" };
}

function recordChallengeStart(
  records: ChallengeRecords,
  challengeId: ChallengeId,
): ChallengeRecords {
  const record = records[challengeId];
  return {
    ...records,
    [challengeId]: {
      ...record,
      unassisted: { ...record.unassisted, runs: record.unassisted.runs + 1 },
    },
  };
}

function moveChallengeRunToAssisted(
  records: ChallengeRecords,
  challengeId: ChallengeId,
): ChallengeRecords {
  const record = records[challengeId];
  return {
    ...records,
    [challengeId]: {
      ...record,
      unassisted: { ...record.unassisted, runs: Math.max(0, record.unassisted.runs - 1) },
      assisted: { ...record.assisted, runs: record.assisted.runs + 1 },
    },
  };
}

function recordChallengeResult(
  records: ChallengeRecords,
  challengeId: ChallengeId,
  assisted: boolean,
  chips: number,
  cleared: boolean,
): ChallengeRecords {
  const record = records[challengeId];
  const bucketName = assisted ? "assisted" : "unassisted";
  const bucket = record[bucketName];
  const nextBucket: ChallengeRecordBucket = {
    runs: bucket.runs,
    clears: bucket.clears + (cleared ? 1 : 0),
    bestFinalChips: bucket.bestFinalChips === undefined ? chips : Math.max(bucket.bestFinalChips, chips),
  };
  return {
    ...records,
    [challengeId]: { ...record, [bucketName]: nextBucket },
  };
}

export function updateActiveTable(
  root: TwentyOneRootState,
  table: TwentyOneState,
): TwentyOneRootState {
  const session = root.activeSession;
  if (!session
    || session.status !== "playing"
    || session.table === table
    || table.revision <= session.table.revision) return root;

  let lifetimeStats = root.lifetimeStats;
  let sessionStats = session.sessionStats;
  let roundsCompleted = session.roundsCompleted;
  let consumedSettlementRevision = session.consumedSettlementRevision;
  let status: ActiveTwentyOneSession["status"] = session.status;
  let endReason: ActiveTwentyOneSession["endReason"] = session.endReason;
  let challengeRecords = root.challengeRecords;

  const isNewSettlement = table.phase === "settled"
    && table.settlement !== undefined
    && consumedSettlementRevision !== table.revision;

  if (isNewSettlement && table.settlement) {
    lifetimeStats = addSettlementToStats(lifetimeStats, table.settlement, table);
    sessionStats = addSettlementToStats(sessionStats, table.settlement, table);
    roundsCompleted += 1;
    consumedSettlementRevision = table.revision;

    if (session.mode === "challenge" && session.challengeId) {
      const verdict = getChallengeVerdict(session.challengeId, roundsCompleted, table.chips);
      if (verdict.finished) {
        status = "summary";
        endReason = verdict.reason;
        challengeRecords = recordChallengeResult(
          challengeRecords,
          session.challengeId,
          session.assisted,
          table.chips,
          verdict.cleared,
        );
      }
    } else if (table.chips < MINIMUM_PLAYABLE_CHIPS) {
      status = "summary";
      endReason = "bankrupt";
    }
  }

  return {
    ...root,
    revision: root.revision + 1,
    lifetimeStats,
    challengeRecords,
    activeSession: {
      ...session,
      table,
      roundsCompleted,
      sessionStats,
      status,
      endReason,
      consumedSettlementRevision,
    },
  };
}

export function markHintUsed(root: TwentyOneRootState): TwentyOneRootState {
  const session = root.activeSession;
  if (!session || session.status !== "playing" || session.assisted) return root;
  return {
    ...root,
    revision: root.revision + 1,
    challengeRecords: session.mode === "challenge" && session.challengeId
      ? moveChallengeRunToAssisted(root.challengeRecords, session.challengeId)
      : root.challengeRecords,
    activeSession: { ...session, assisted: true },
  };
}

export function finishClassicSession(root: TwentyOneRootState): TwentyOneRootState {
  const session = root.activeSession;
  if (!session
    || session.mode !== "classic"
    || session.status !== "playing"
    || session.table.phase !== "betting") return root;
  return {
    ...root,
    revision: root.revision + 1,
    activeSession: { ...session, status: "summary", endReason: "left-table" },
  };
}

export function abandonSession(root: TwentyOneRootState): TwentyOneRootState {
  if (!root.activeSession) return root;
  return {
    revision: root.revision + 1,
    preferences: root.preferences,
    lifetimeStats: root.lifetimeStats,
    challengeRecords: root.challengeRecords,
  };
}

/** Leave a completed summary (or a confirmed abandoned session) for mode setup. */
export const returnToModeSelect = abandonSession;

export function retryActiveSession(
  root: TwentyOneRootState,
  table: TwentyOneState,
): TwentyOneRootState {
  const previous = root.activeSession;
  if (!previous || previous.status !== "summary") return root;
  const cleared = abandonSession(root);
  return previous.mode === "challenge" && previous.challengeId
    ? startChallengeSession(cleared, previous.challengeId, table)
    : startClassicSession(cleared, table);
}

export function resetArchive(root: TwentyOneRootState): TwentyOneRootState {
  if (root.activeSession) return root;
  return {
    ...root,
    revision: root.revision + 1,
    lifetimeStats: createEmptyStats(CLASSIC_STARTING_CHIPS),
    challengeRecords: createEmptyChallengeRecords(),
  };
}
