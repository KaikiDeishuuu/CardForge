import { CARD_CATALOG, SEAT_ORDER, buildDeck } from "./data";
import { getPlayer } from "./engine";
import type {
  DingCard,
  DingPlayer,
  DingState,
  EquipmentSlot,
  LastDingAction,
  PendingAction,
  PlayerId,
} from "./types";

export const DING_SAVE_SCHEMA_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

const PLAYER_IDS = new Set<string>(["south", "east", "north", "west"]);
const IDENTITIES = new Set<string>(["lord", "loyalist", "rebel", "renegade"]);
const PHASES = new Set<string>(["prepare", "draw", "play", "discard", "finished"]);
const CARD_KINDS = new Set<string>(["basic", "trick", "equipment"]);
const CARD_TYPES = new Set<string>([
  "strike", "evade", "salve", "focus", "dismantle", "snatch",
  "weapon", "minus-horse", "plus-horse",
]);
const SLOTS: readonly EquipmentSlot[] = ["weapon", "minusHorse", "plusHorse"];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isCard(value: unknown): value is DingCard {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.name !== "string"
    || typeof value.kind !== "string" || !CARD_KINDS.has(value.kind)
    || typeof value.type !== "string" || !CARD_TYPES.has(value.type)
    || typeof value.symbol !== "string"
    || typeof value.tone !== "string"
    || typeof value.description !== "string") return false;
  const definition = CARD_CATALOG[value.id.split("-")[0]];
  if (!definition || definition.kind !== value.kind || definition.type !== value.type) return false;
  if (value.range !== undefined && !isPositiveInteger(value.range)) return false;
  if (value.unlimitedStrikes !== undefined && typeof value.unlimitedStrikes !== "boolean") return false;
  return true;
}

function isCardList(value: unknown): value is readonly DingCard[] {
  return Array.isArray(value) && value.every(isCard);
}

function isEquipment(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const [slot, card] of Object.entries(value)) {
    if (!SLOTS.includes(slot as EquipmentSlot) || !isCard(card)) return false;
    const expected = slot === "weapon" ? "weapon" : slot === "minusHorse" ? "minus-horse" : "plus-horse";
    if (card.type !== expected) return false;
  }
  return true;
}

function isPlayer(value: unknown): value is DingPlayer {
  if (!isRecord(value)
    || typeof value.id !== "string" || !PLAYER_IDS.has(value.id)
    || typeof value.displayName !== "string"
    || (value.controller !== "human" && value.controller !== "ai")
    || !isNonNegativeInteger(value.seat) || value.seat >= 4
    || typeof value.identity !== "string" || !IDENTITIES.has(value.identity)
    || typeof value.revealed !== "boolean"
    || typeof value.hp !== "number" || !Number.isInteger(value.hp)
    || !isPositiveInteger(value.maxHp)
    || typeof value.alive !== "boolean"
    || !isCardList(value.hand)
    || !isEquipment(value.equipment)) return false;
  const player = value as unknown as DingPlayer;
  if (player.alive) return player.hp <= player.maxHp;
  return player.hp === 0 && player.revealed;
}

function isLogEntry(value: unknown): boolean {
  return isRecord(value) && isNonNegativeInteger(value.id) && typeof value.text === "string";
}

function isLastAction(value: unknown): value is LastDingAction {
  if (!isRecord(value)
    || !isNonNegativeInteger(value.revision)
    || typeof value.actorId !== "string"
    || typeof value.text !== "string") return false;
  return value.cardIds === undefined
    || (Array.isArray(value.cardIds) && value.cardIds.every((id) => typeof id === "string"));
}

function isPending(value: unknown): value is PendingAction {
  if (!isRecord(value)) return false;
  if (value.kind === "strike") {
    return typeof value.actorId === "string" && PLAYER_IDS.has(value.actorId)
      && typeof value.targetId === "string" && PLAYER_IDS.has(value.targetId)
      && typeof value.cardUid === "string"
      && value.damage === 1;
  }
  if (value.kind === "dying") {
    return typeof value.targetId === "string" && PLAYER_IDS.has(value.targetId)
      && isPositiveInteger(value.required)
      && isNonNegativeInteger(value.offered)
      && Array.isArray(value.responders) && value.responders.every((id) => typeof id === "string" && PLAYER_IDS.has(id))
      && isNonNegativeInteger(value.cursor)
      && (value.sourceId === undefined || (typeof value.sourceId === "string" && PLAYER_IDS.has(value.sourceId)));
  }
  return false;
}

function cardUids(piles: readonly (readonly DingCard[])[]): string[] {
  return piles.flat().map((card) => card.id);
}

function validateState(data: unknown): data is DingState {
  if (!isRecord(data)
    || !isNonNegativeInteger(data.revision)
    || (data.status !== "playing" && data.status !== "finished")
    || typeof data.phase !== "string" || !PHASES.has(data.phase)
    || !isNonNegativeInteger(data.turnNumber) || data.turnNumber < 1
    || typeof data.activePlayerId !== "string" || !PLAYER_IDS.has(data.activePlayerId)
    || !Array.isArray(data.players) || data.players.length !== 4 || !data.players.every(isPlayer)
    || !isCardList(data.deck)
    || !isCardList(data.discard)
    || typeof data.strikeUsed !== "boolean"
    || (data.pending !== undefined && !isPending(data.pending))
    || (data.lastAction !== undefined && !isLastAction(data.lastAction))
    || !Array.isArray(data.log) || !data.log.every(isLogEntry)
    || !isNonNegativeInteger(data.rngSeed) || data.rngSeed > 0xffff_ffff) return false;

  const players = data.players as unknown as DingPlayer[];
  const ids = players.map((player) => player.id);
  if (new Set(ids).size !== 4 || !SEAT_ORDER.every((id) => ids.includes(id))) return false;
  if (players.map((player) => player.seat).sort((a, b) => a - b).some((seat, index) => seat !== index)) return false;
  if (players.filter((player) => player.identity === "lord").length !== 1) return false;
  for (const player of players) {
    if (player.identity === "lord" && !player.revealed) return false;
    if (player.alive && player.identity !== "lord" && player.revealed) return false;
  }
  const active = getPlayer(players, data.activePlayerId as PlayerId);
  if (!active.alive && data.status === "playing") return false;

  if (data.status === "finished") {
    if (data.phase !== "finished" || data.pending !== undefined) return false;
    if (data.winner !== "lord-side" && data.winner !== "rebel" && data.winner !== "renegade") return false;
  } else if (data.winner !== undefined) return false;

  const piles = [
    players.flatMap((player) => player.hand),
    players.flatMap((player) => SLOTS.map((slot) => player.equipment[slot]).filter((card): card is DingCard => Boolean(card))),
    data.deck as unknown as readonly DingCard[],
    data.discard as unknown as readonly DingCard[],
  ];
  const uids = cardUids(piles);
  const expected = buildDeck();
  return new Set(uids).size === uids.length
    && uids.length === expected.length
    && expected.every((card) => uids.includes(card.id));
}

/** State is already pure data; the platform envelope performs JSON encoding. */
export function serializeDingState(state: DingState): unknown {
  return state;
}

export function restoreDingState(data: unknown): DingState | undefined {
  return validateState(data) ? data : undefined;
}
