import {
  CARD_CATALOG,
  COMBATANT_SEEDS,
  PASSIVE_CATALOG,
  STATUS_CATALOG,
  buildDeck,
} from "./data";
import { ACTIONS_PER_TURN, BLOCK_LIMIT } from "./engine";
import {
  PROFILE_COMBATANT_IDS,
  createDefaultRootState,
  startMatch,
  type ActiveEmberPactMatch,
  type CombatantProfile,
  type EmberPactLifetimeProfile,
  type EmberPactRootState,
  type LifetimePlayerMetrics,
} from "./session";
import type {
  CardInstance,
  Combatant,
  CombatantMetrics,
  Difficulty,
  EmberPactState,
  LastAction,
  PendingAttack,
  ResolvedEvent,
  StatusInstance,
} from "./types";

export const PACT_SAVE_SCHEMA_VERSION = 2;

type UnknownRecord = Record<string, unknown>;

const DIFFICULTIES = new Set<Difficulty>(["novice", "standard", "tactician"]);
const WINNERS = new Set(["dawn", "dusk", "draw"]);
const PHASES = new Set(["action", "response"]);
const EVENT_KINDS = new Set([
  "damage", "block", "heal", "revive", "response", "status-applied",
  "status-removed", "defeated", "card-overflow", "overheat",
]);
const EVENT_SOURCES = new Set(["card", "passive", "response", "status", "system"]);
const CARD_IDS = new Set(Object.keys(CARD_CATALOG));
const STATUS_IDS = new Set(Object.keys(STATUS_CATALOG));
const PASSIVE_IDS = new Set(Object.keys(PASSIVE_CATALOG));
const COMBATANT_IDS = new Set(PROFILE_COMBATANT_IDS);
const COMBATANT_SEED_BY_ID = new Map(COMBATANT_SEEDS.map((seed) => [seed.id, seed]));
const LEGACY_DECK_SIZE = 14;
const METRIC_KEYS = [
  "cardsPlayed", "damageDealt", "damageTaken", "healingDone", "blockGranted",
  "combos", "defeats", "responses", "biggestHit",
] as const satisfies readonly (keyof CombatantMetrics)[];
const LIFETIME_METRIC_KEYS = [
  "damageDealt", "healingDone", "blockGranted", "combos", "defeats",
] as const satisfies readonly (keyof LifetimePlayerMetrics)[];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isCombatantId(value: unknown): value is string {
  return typeof value === "string" && COMBATANT_IDS.has(value as typeof PROFILE_COMBATANT_IDS[number]);
}

function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === "string" && DIFFICULTIES.has(value as Difficulty);
}

function isCardInstance(value: unknown): value is CardInstance {
  return isRecord(value)
    && typeof value.uid === "string" && value.uid.length > 0
    && typeof value.definitionId === "string" && CARD_IDS.has(value.definitionId);
}

function isStatusInstance(value: unknown): value is StatusInstance {
  if (!isRecord(value)
    || typeof value.id !== "string" || !STATUS_IDS.has(value.id)
    || (value.sourceActorId !== undefined && !isCombatantId(value.sourceActorId))) return false;
  if (value.remainingTurns !== undefined && !isPositiveInteger(value.remainingTurns)) return false;
  return value.id === "burning" || value.remainingTurns === undefined;
}

function cardPiles(value: UnknownRecord): readonly CardInstance[] | undefined {
  if (!Array.isArray(value.hand) || !value.hand.every(isCardInstance)
    || !Array.isArray(value.deck) || !value.deck.every(isCardInstance)
    || !Array.isArray(value.discard) || !value.discard.every(isCardInstance)) return undefined;
  return [...value.hand, ...value.deck, ...value.discard];
}

function isCatalogCombatant(value: unknown): value is Combatant {
  if (!isRecord(value) || !isCombatantId(value.id)) return false;
  const seed = COMBATANT_SEED_BY_ID.get(value.id);
  const cards = cardPiles(value);
  if (!seed || !cards) return false;
  if (value.displayName !== seed.displayName
    || value.title !== seed.title
    || value.monogram !== seed.monogram
    || value.team !== seed.team
    || value.passiveId !== seed.passiveId
    || !PASSIVE_IDS.has(String(value.passiveId))
    || (value.controller !== "human" && value.controller !== "ai")
    || value.maxHp !== seed.maxHp
    || !isNonNegativeInteger(value.hp) || value.hp > seed.maxHp
    || typeof value.reviveAvailable !== "boolean"
    || !isNonNegativeInteger(value.block) || value.block > BLOCK_LIMIT
    || !Array.isArray(value.statuses) || !value.statuses.every(isStatusInstance)) return false;
  const statusIds = value.statuses.map((status) => status.id);
  const expectedCards = buildDeck(value.id);
  const actualByUid = new Map(cards.map((card) => [card.uid, card.definitionId]));
  return new Set(statusIds).size === statusIds.length
    && cards.length === expectedCards.length
    && expectedCards.every((card) => actualByUid.get(card.uid) === card.definitionId);
}

function isLegacyCombatant(value: unknown): value is Combatant {
  if (!isRecord(value) || !isCombatantId(value.id)) return false;
  const seed = COMBATANT_SEED_BY_ID.get(value.id);
  const cards = cardPiles(value);
  if (!seed || !cards) return false;
  if (typeof value.displayName !== "string"
    || typeof value.title !== "string"
    || typeof value.monogram !== "string"
    || value.team !== seed.team
    || value.passiveId !== seed.passiveId
    || (value.controller !== "human" && value.controller !== "ai")
    || !isPositiveInteger(value.maxHp)
    || !isNonNegativeInteger(value.hp) || value.hp > value.maxHp
    || (value.reviveAvailable !== undefined && typeof value.reviveAvailable !== "boolean")
    || !isNonNegativeInteger(value.block)
    || !Array.isArray(value.statuses) || !value.statuses.every(isStatusInstance)) return false;
  const statusIds = value.statuses.map((status) => status.id);
  return new Set(statusIds).size === statusIds.length && cards.length === LEGACY_DECK_SIZE;
}

function validCatalogCombatants(value: unknown, legacy: boolean): value is Combatant[] {
  if (!Array.isArray(value) || value.length !== PROFILE_COMBATANT_IDS.length) return false;
  const validate = legacy ? isLegacyCombatant : isCatalogCombatant;
  if (!value.every(validate)) return false;
  const ids = value.map((combatant) => combatant.id);
  if (new Set(ids).size !== PROFILE_COMBATANT_IDS.length
    || !PROFILE_COMBATANT_IDS.every((id) => ids.includes(id))) return false;
  if (value.filter((combatant) => combatant.controller === "human").length !== 1) return false;

  const cards = value.flatMap((combatant) => [
    ...combatant.hand,
    ...combatant.deck,
    ...combatant.discard,
  ]);
  return new Set(cards.map((card) => card.uid)).size === cards.length;
}

function isMetric(value: unknown): value is CombatantMetrics {
  if (!isRecord(value) || !METRIC_KEYS.every((key) => isNonNegativeInteger(value[key]))) return false;
  const metric = value as unknown as CombatantMetrics;
  return metric.biggestHit <= metric.damageDealt;
}

function isMetrics(value: unknown): value is Readonly<Record<string, CombatantMetrics>> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === PROFILE_COMBATANT_IDS.length
    && PROFILE_COMBATANT_IDS.every((id) => isMetric(value[id]));
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value);
}

function isResolvedEvent(value: unknown): value is ResolvedEvent {
  if (!isRecord(value)
    || typeof value.kind !== "string" || !EVENT_KINDS.has(value.kind)
    || !isCombatantId(value.targetId)
    || (value.actorId !== undefined && !isCombatantId(value.actorId))
    || typeof value.source !== "string" || !EVENT_SOURCES.has(value.source)
    || !optionalNonNegativeInteger(value.amount)
    || !optionalNonNegativeInteger(value.absorbed)
    || !optionalNonNegativeInteger(value.prevented)
    || (value.combo !== undefined && typeof value.combo !== "boolean")
    || (value.statusId !== undefined && (typeof value.statusId !== "string" || !STATUS_IDS.has(value.statusId)))
    || typeof value.text !== "string") return false;

  if ((value.kind === "damage" || value.kind === "overheat" || value.kind === "block"
    || value.kind === "heal" || value.kind === "revive" || value.kind === "response")
    && !isNonNegativeInteger(value.amount)) return false;
  if ((value.kind === "status-applied" || value.kind === "status-removed")
    && (typeof value.statusId !== "string" || !STATUS_IDS.has(value.statusId))) return false;
  if (value.kind === "overheat" && value.source !== "system") return false;
  if (value.kind === "response" && value.source !== "response") return false;
  return true;
}

function isLastAction(value: unknown, allowMissingSummary = false): value is LastAction {
  return isRecord(value)
    && isNonNegativeInteger(value.revision)
    && isCombatantId(value.actorId)
    && (value.cardId === undefined || (typeof value.cardId === "string" && CARD_IDS.has(value.cardId)))
    && Array.isArray(value.events) && value.events.every(isResolvedEvent)
    && (typeof value.summary === "string" || (allowMissingSummary && value.summary === undefined));
}

function isBattleLog(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const ids: number[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isNonNegativeInteger(entry.id) || typeof entry.text !== "string") return false;
    ids.push(entry.id);
  }
  return new Set(ids).size === ids.length;
}

function isPendingAttack(value: unknown): value is PendingAttack {
  return isRecord(value)
    && isCombatantId(value.actorId)
    && isCombatantId(value.targetId)
    && typeof value.cardUid === "string" && value.cardUid.length > 0
    && typeof value.definitionId === "string" && CARD_IDS.has(value.definitionId)
    && typeof value.header === "string" && value.header.length > 0;
}

function validWinnerAndLivingState(state: EmberPactState): boolean {
  const dawnAlive = state.combatants.some((combatant) => combatant.team === "dawn" && combatant.hp > 0);
  const duskAlive = state.combatants.some((combatant) => combatant.team === "dusk" && combatant.hp > 0);
  if (state.status === "playing") return state.winner === undefined && dawnAlive && duskAlive;
  if (state.winner === "draw") return !dawnAlive && !duskAlive;
  if (state.winner === "dawn") return dawnAlive && !duskAlive;
  return state.winner === "dusk" && duskAlive && !dawnAlive;
}

function validPhase(state: EmberPactState): boolean {
  if (state.phase === "action") return state.pendingAttack === undefined;
  const pending = state.pendingAttack;
  if (!pending || state.status !== "playing"
    || pending.actorId !== state.activePlayerId
    || !state.attackUsed) return false;
  const actor = state.combatants.find((combatant) => combatant.id === pending.actorId);
  const target = state.combatants.find((combatant) => combatant.id === pending.targetId);
  const card = CARD_CATALOG[pending.definitionId];
  if (!actor || actor.hp <= 0 || !target || target.hp <= 0
    || actor.team === target.team || !card?.respondable) return false;
  const pendingCard = actor.discard.find((candidate) => candidate.uid === pending.cardUid);
  if (!pendingCard || pendingCard.definitionId !== pending.definitionId) return false;
  if (!target.hand.some((candidate) => (CARD_CATALOG[candidate.definitionId]?.responsePower ?? 0) > 0)) return false;
  return state.lastAction?.revision === state.revision
    && state.lastAction.actorId === pending.actorId
    && state.lastAction.cardId === pending.definitionId;
}

function isEmberPactState(value: unknown): value is EmberPactState {
  if (!isRecord(value)
    || !isNonNegativeInteger(value.revision)
    || !isPositiveInteger(value.turnNumber)
    || !isPositiveInteger(value.roundNumber)
    || !isCombatantId(value.activePlayerId)
    || !isNonNegativeInteger(value.actionsRemaining) || value.actionsRemaining > ACTIONS_PER_TURN
    || typeof value.attackUsed !== "boolean"
    || typeof value.phase !== "string" || !PHASES.has(value.phase)
    || (value.pendingAttack !== undefined && !isPendingAttack(value.pendingAttack))
    || !isDifficulty(value.difficulty)
    || !validCatalogCombatants(value.combatants, false)
    || !isMetrics(value.metrics)
    || (value.status !== "playing" && value.status !== "finished")
    || (value.winner !== undefined && (typeof value.winner !== "string" || !WINNERS.has(value.winner)))
    || !isBattleLog(value.log)
    || (value.lastAction !== undefined && !isLastAction(value.lastAction))
    || !isNonNegativeInteger(value.rngSeed) || value.rngSeed > 0xffff_ffff) return false;

  const state = value as unknown as EmberPactState;
  const active = state.combatants.find((combatant) => combatant.id === state.activePlayerId);
  if (!active || (state.status === "playing" && active.hp <= 0)) return false;
  if (state.lastAction !== undefined && state.lastAction.revision !== state.revision) return false;
  if (state.revision === 0 && state.lastAction !== undefined) return false;
  if (state.status === "finished" && (state.phase !== "action" || state.pendingAttack !== undefined)) return false;
  return validWinnerAndLivingState(state) && validPhase(state);
}

function isCombatantProfile(value: unknown): value is CombatantProfile {
  if (!isRecord(value)
    || !isNonNegativeInteger(value.gamesPlayed)
    || !isNonNegativeInteger(value.wins) || value.wins > value.gamesPlayed
    || (value.highestDifficulty !== undefined && !isDifficulty(value.highestDifficulty))) return false;
  return value.wins > 0 ? value.highestDifficulty !== undefined : value.highestDifficulty === undefined;
}

function isLifetimeMetrics(value: unknown): value is LifetimePlayerMetrics {
  return isRecord(value) && LIFETIME_METRIC_KEYS.every((key) => isNonNegativeInteger(value[key]));
}

function isLifetimeProfile(value: unknown): value is EmberPactLifetimeProfile {
  const combatants = isRecord(value) && isRecord(value.combatants) ? value.combatants : undefined;
  if (!isRecord(value)
    || !isNonNegativeInteger(value.gamesPlayed)
    || !isNonNegativeInteger(value.wins)
    || !isNonNegativeInteger(value.losses)
    || !isNonNegativeInteger(value.draws)
    || !isNonNegativeInteger(value.abandons)
    || !isNonNegativeInteger(value.currentWinStreak)
    || !isNonNegativeInteger(value.bestWinStreak)
    || value.currentWinStreak > value.bestWinStreak
    || value.bestWinStreak > value.wins
    || (value.fastestWinRounds !== undefined && !isPositiveInteger(value.fastestWinRounds))
    || !combatants
    || !PROFILE_COMBATANT_IDS.every((id) => isCombatantProfile(combatants[id]))
    || Object.keys(combatants).length !== PROFILE_COMBATANT_IDS.length
    || !isLifetimeMetrics(value.playerMetrics)) return false;

  const profiles = PROFILE_COMBATANT_IDS.map((id) => combatants[id] as CombatantProfile);
  const characterGames = profiles.reduce((total, profile) => total + profile.gamesPlayed, 0);
  const characterWins = profiles.reduce((total, profile) => total + profile.wins, 0);
  return value.gamesPlayed === value.wins + value.losses + value.draws
    && characterGames === value.gamesPlayed
    && characterWins === value.wins
    && (value.wins > 0 ? value.fastestWinRounds !== undefined : value.fastestWinRounds === undefined);
}

function isActiveMatch(value: unknown): value is ActiveEmberPactMatch {
  if (!isRecord(value) || !isEmberPactState(value.state) || typeof value.resultRecorded !== "boolean") return false;
  return value.resultRecorded === (value.state.status === "finished");
}

function restoreV2(data: unknown): EmberPactRootState | undefined {
  if (!isRecord(data)
    || !isNonNegativeInteger(data.revision)
    || !isRecord(data.preferences)
    || !isDifficulty(data.preferences.difficulty)
    || typeof data.preferences.guideEnabled !== "boolean"
    || !isLifetimeProfile(data.lifetimeProfile)) return undefined;

  const base: EmberPactRootState = {
    revision: data.revision,
    preferences: data.preferences as unknown as EmberPactRootState["preferences"],
    lifetimeProfile: data.lifetimeProfile,
  };
  if (data.activeMatch === undefined) return base;

  // A damaged in-flight table must not erase an otherwise valid archive.
  // Dropping only that table also lets the next successful save self-heal it.
  if (!isActiveMatch(data.activeMatch)
    || data.activeMatch.state.difficulty !== data.preferences.difficulty) return base;
  return { ...base, activeMatch: data.activeMatch };
}

interface LegacyState extends UnknownRecord {
  revision: number;
  turnNumber: number;
  roundNumber: number;
  activePlayerId: string;
  combatants: Combatant[];
  status: "playing" | "finished";
  winner?: "dawn" | "dusk";
  log: Array<{ id: number; text: string }>;
  lastAction?: LastAction;
  rngSeed: number;
}

function isLegacyState(data: unknown): data is LegacyState {
  if (!isRecord(data)
    || !isNonNegativeInteger(data.revision)
    || !isPositiveInteger(data.turnNumber)
    || !isPositiveInteger(data.roundNumber)
    || !isCombatantId(data.activePlayerId)
    || !validCatalogCombatants(data.combatants, true)
    || (data.status !== "playing" && data.status !== "finished")
    || (data.winner !== undefined && data.winner !== "dawn" && data.winner !== "dusk")
    || !isBattleLog(data.log)
    || (data.lastAction !== undefined && !isLastAction(data.lastAction, true))
    || !isNonNegativeInteger(data.rngSeed) || data.rngSeed > 0xffff_ffff) return false;
  const active = data.combatants.find((combatant) => combatant.id === data.activePlayerId);
  if (!active || (data.status === "playing" && active.hp <= 0)) return false;
  if (data.status === "playing" && data.winner !== undefined) return false;
  if (data.status === "finished" && data.winner === undefined) return false;
  if (data.lastAction !== undefined && data.lastAction.revision !== data.revision) return false;
  const dawnAlive = data.combatants.some((combatant) => combatant.team === "dawn" && combatant.hp > 0);
  const duskAlive = data.combatants.some((combatant) => combatant.team === "dusk" && combatant.hp > 0);
  if (data.status === "playing") return dawnAlive && duskAlive;
  return data.winner === "dawn" ? dawnAlive && !duskAlive : duskAlive && !dawnAlive;
}

function emptyMetrics(): CombatantMetrics {
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

function normalizeLegacyPiles(combatant: Combatant): Pick<Combatant, "hand" | "deck" | "discard"> {
  const pool = [...buildDeck(combatant.id)];
  const take = (legacy: CardInstance): CardInstance => {
    const matchingIndex = pool.findIndex((card) => card.definitionId === legacy.definitionId);
    const index = matchingIndex >= 0 ? matchingIndex : 0;
    return pool.splice(index, 1)[0];
  };
  const hand = combatant.hand.map(take);
  const discard = combatant.discard.map(take);
  const mappedDeck = combatant.deck.map(take);
  return { hand, discard, deck: [...pool, ...mappedDeck] };
}

function migrateCombatant(combatant: Combatant): Combatant {
  const seed = COMBATANT_SEED_BY_ID.get(combatant.id)!;
  const piles = normalizeLegacyPiles(combatant);
  return {
    ...combatant,
    ...piles,
    displayName: seed.displayName,
    title: seed.title,
    monogram: seed.monogram,
    team: seed.team,
    passiveId: seed.passiveId,
    maxHp: seed.maxHp,
    hp: Math.min(combatant.hp, seed.maxHp),
    reviveAvailable: true,
    block: Math.min(combatant.block, BLOCK_LIMIT),
    statuses: combatant.statuses.map((status) => ({
      id: status.id,
      ...(status.remainingTurns === undefined ? {} : { remainingTurns: status.remainingTurns }),
      ...(status.sourceActorId === undefined ? {} : { sourceActorId: status.sourceActorId }),
    })),
  };
}

function migrateLastAction(data: LegacyState): LastAction | undefined {
  const lastAction = data.lastAction;
  if (!lastAction) return undefined;
  const lastLogText = data.log.at(-1)?.text;
  return {
    revision: lastAction.revision,
    actorId: lastAction.actorId,
    ...(lastAction.cardId === undefined ? {} : { cardId: lastAction.cardId }),
    events: lastAction.events,
    summary: typeof lastAction.summary === "string"
      ? lastAction.summary
      : lastAction.events.at(-1)?.text ?? lastLogText ?? "已恢复旧对局。",
  };
}

function migrateV1(data: unknown): EmberPactRootState | undefined {
  if (!isLegacyState(data)) return undefined;
  const combatants = data.combatants.map(migrateCombatant);
  const lastAction = migrateLastAction(data);
  const state: EmberPactState = {
    revision: data.revision,
    turnNumber: data.turnNumber,
    roundNumber: data.roundNumber,
    activePlayerId: data.activePlayerId,
    actionsRemaining: ACTIONS_PER_TURN,
    attackUsed: false,
    phase: "action",
    difficulty: "standard",
    combatants,
    metrics: Object.fromEntries(combatants.map((combatant) => [combatant.id, emptyMetrics()])),
    status: data.status,
    ...(data.winner === undefined ? {} : { winner: data.winner }),
    log: data.log,
    ...(lastAction === undefined ? {} : { lastAction }),
    rngSeed: data.rngSeed,
  };
  if (!isEmberPactState(state)) return undefined;
  return startMatch(createDefaultRootState(), state);
}

/** State is already pure data; the platform envelope performs JSON encoding. */
export function serializePactRootState(state: EmberPactRootState): unknown {
  return state;
}

export function restorePactRootState(
  schemaVersion: number,
  data: unknown,
): EmberPactRootState | undefined {
  if (schemaVersion === PACT_SAVE_SCHEMA_VERSION) return restoreV2(data);
  if (schemaVersion === 1) return migrateV1(data);
  return undefined;
}

/** @deprecated Kept temporarily for the pre-v2 React integration. */
export function serializePactState(state: EmberPactState): unknown {
  return state;
}

/** @deprecated Prefer restorePactRootState and read activeMatch.state. */
export function restorePactState(data: unknown): EmberPactState | undefined {
  if (isEmberPactState(data)) return data;
  return restoreV2(data)?.activeMatch?.state;
}

/** Exported for focused validator tests without broadening the game Core. */
export const isValidPactMatchState = isEmberPactState;
