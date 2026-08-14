import type { CardInstance, Combatant, EmberPactState, StatusInstance } from "./types";

export const PACT_SAVE_SCHEMA_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isCardInstance(value: unknown): value is CardInstance {
  return isRecord(value)
    && typeof value.uid === "string"
    && typeof value.definitionId === "string";
}

function isStatusInstance(value: unknown): value is StatusInstance {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  return value.remainingTurns === undefined || typeof value.remainingTurns === "number";
}

function isCombatant(value: unknown): value is Combatant {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.displayName === "string"
    && (value.controller === "human" || value.controller === "ai" || value.controller === "remote")
    && (value.team === "dawn" || value.team === "dusk")
    && typeof value.passiveId === "string"
    && typeof value.hp === "number"
    && typeof value.maxHp === "number"
    && typeof value.block === "number"
    && Array.isArray(value.hand) && value.hand.every(isCardInstance)
    && Array.isArray(value.deck) && value.deck.every(isCardInstance)
    && Array.isArray(value.discard) && value.discard.every(isCardInstance)
    && Array.isArray(value.statuses) && value.statuses.every(isStatusInstance);
}

/** 状态本身已是纯数据，序列化交给存储层的 JSON 信封。 */
export function serializePactState(state: EmberPactState): unknown {
  return state;
}

export function restorePactState(data: unknown): EmberPactState | undefined {
  if (!isRecord(data)) return undefined;
  if (data.status !== "playing" && data.status !== "finished") return undefined;
  if (typeof data.revision !== "number"
    || typeof data.turnNumber !== "number"
    || typeof data.roundNumber !== "number"
    || typeof data.activePlayerId !== "string"
    || typeof data.rngSeed !== "number"
    || !Number.isFinite(data.rngSeed)) return undefined;
  if (!Array.isArray(data.combatants) || data.combatants.length !== 4 || !data.combatants.every(isCombatant)) return undefined;
  if (!Array.isArray(data.log) || !data.log.every((entry) => isRecord(entry)
    && typeof entry.id === "number" && typeof entry.text === "string")) return undefined;
  if (data.winner !== undefined && data.winner !== "dawn" && data.winner !== "dusk") return undefined;
  if (data.lastAction !== undefined && (!isRecord(data.lastAction)
    || typeof data.lastAction.revision !== "number"
    || typeof data.lastAction.actorId !== "string"
    || !Array.isArray(data.lastAction.events))) return undefined;
  return data as unknown as EmberPactState;
}
