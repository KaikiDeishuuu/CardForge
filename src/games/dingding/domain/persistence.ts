import { CARD_CATALOG, SEAT_ORDER, buildDeck } from "./data";
import { getPlayer } from "./engine";
import { HERO_CATALOG } from "./heroes";
import type {
  DingCard,
  DingPlayer,
  DingState,
  EquipmentSlot,
  LastDingAction,
  PlayerId,
  ResolutionFrame,
} from "./types";

/**
 * v4：玩家获得 heroId 与 skillFlags，引擎在触发点结算武将技能。
 * v3 及更早存档没有武将字段，不猜测迁移，按不可读处理（平台不会覆盖它们）。
 */
export const DING_SAVE_SCHEMA_VERSION = 4;

type UnknownRecord = Record<string, unknown>;

const PLAYER_IDS = new Set<string>(["south", "east", "north", "west"]);
const IDENTITIES = new Set<string>(["lord", "loyalist", "rebel", "renegade"]);
const PHASES = new Set<string>(["prepare", "draw", "play", "discard", "finished"]);
const CARD_KINDS = new Set<string>(["basic", "trick", "equipment"]);
const CARD_TYPES = new Set<string>([
  "strike", "evade", "salve",
  "focus", "dismantle", "snatch", "nullify",
  "duel", "horde", "volley", "grove",
  "weapon", "minus-horse", "plus-horse",
]);
const TRICK_TYPES = new Set<string>(["focus", "dismantle", "snatch", "nullify", "duel", "horde", "volley", "grove"]);
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

function isPlayerId(value: unknown): value is PlayerId {
  return typeof value === "string" && PLAYER_IDS.has(value);
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
    || !isPlayerId(value.id)
    || typeof value.displayName !== "string"
    || (value.controller !== "human" && value.controller !== "ai")
    || !isNonNegativeInteger(value.seat) || value.seat >= 4
    || typeof value.identity !== "string" || !IDENTITIES.has(value.identity)
    || typeof value.revealed !== "boolean"
    || typeof value.hp !== "number" || !Number.isInteger(value.hp)
    || !isPositiveInteger(value.maxHp)
    || typeof value.alive !== "boolean"
    || !isCardList(value.hand)
    || !isEquipment(value.equipment)
    || typeof value.heroId !== "string" || !(value.heroId in HERO_CATALOG)
    || !isRecord(value.skillFlags)
    || Object.values(value.skillFlags).some((flag) => typeof flag !== "boolean")) return false;
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

function isIdList(value: unknown): value is readonly PlayerId[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 4
    && value.every(isPlayerId)
    && new Set(value).size === value.length;
}

function isFrame(value: unknown): value is ResolutionFrame {
  if (!isRecord(value)) return false;
  if (value.kind === "strike") {
    return isPlayerId(value.actorId)
      && isPlayerId(value.targetId)
      && typeof value.cardUid === "string"
      && value.damage === 1;
  }
  if (value.kind === "dying") {
    return isPlayerId(value.targetId)
      && isPositiveInteger(value.required)
      && isNonNegativeInteger(value.offered)
      && isIdList(value.responders)
      && isNonNegativeInteger(value.cursor) && value.cursor < value.responders.length
      && (value.sourceId === undefined || isPlayerId(value.sourceId));
  }
  if (value.kind === "trick") {
    if (!isPositiveInteger(value.frameId)
      || !isPlayerId(value.actorId)
      || typeof value.cardUid !== "string"
      || typeof value.cardType !== "string" || !TRICK_TYPES.has(value.cardType)
      || (value.targetId !== undefined && !isPlayerId(value.targetId))
      || (value.counterFrameId !== undefined && !isPositiveInteger(value.counterFrameId))
      || !isIdList(value.responders)
      || !isNonNegativeInteger(value.cursor) || value.cursor >= value.responders.length
      || typeof value.awaitingResponse !== "boolean"
      || (value.negated !== undefined && typeof value.negated !== "boolean")) return false;
    if (value.negated === true && value.awaitingResponse === true) return false;
    return true;
  }
  if (value.kind === "duel") {
    return isPlayerId(value.actorId)
      && isPlayerId(value.targetId)
      && isPlayerId(value.turnId)
      && (value.turnId === value.actorId || value.turnId === value.targetId)
      && typeof value.cardUid === "string";
  }
  if (value.kind === "horde" || value.kind === "volley") {
    return isPlayerId(value.actorId)
      && typeof value.cardUid === "string"
      && isIdList(value.responders)
      && isNonNegativeInteger(value.cursor) && value.cursor < value.responders.length;
  }
  return false;
}

function cardUids(piles: readonly (readonly DingCard[])[]): string[] {
  return piles.flat().map((card) => card.id);
}

function validateStack(data: UnknownRecord, discard: readonly DingCard[]): boolean {
  if (!Array.isArray(data.stack) || !data.stack.every(isFrame)) return false;
  const stack = data.stack as unknown as readonly ResolutionFrame[];
  const trickFrames = stack.filter((frame): frame is Extract<ResolutionFrame, { kind: "trick" }> => frame.kind === "trick");
  const frameIds = trickFrames.map((frame) => frame.frameId);
  if (new Set(frameIds).size !== frameIds.length) return false;

  for (const frame of stack) {
    if (frame.kind === "trick") {
      if (frame.counterFrameId !== undefined && !frameIds.includes(frame.counterFrameId)) return false;
      if (frame.negated === true && frame.awaitingResponse === true) return false;
    }
    if (frame.kind === "strike" || frame.kind === "trick" || frame.kind === "duel" || frame.kind === "horde" || frame.kind === "volley") {
      const played = discard.find((card) => card.id === frame.cardUid);
      if (!played) return false;
      const expectedType = frame.kind === "trick" ? frame.cardType : frame.kind;
      if (played.type !== expectedType) return false;
    }
    const players = data.players as unknown as DingPlayer[];
    if (frame.kind === "strike" || frame.kind === "dying") {
      if (!players.find((player) => player.id === frame.targetId)?.alive) return false;
    } else if (frame.kind === "duel") {
      if (!players.find((player) => player.id === frame.actorId)?.alive) return false;
      if (!players.find((player) => player.id === frame.targetId)?.alive) return false;
      if (!players.find((player) => player.id === frame.turnId)?.alive) return false;
    } else if (!frame.responders.every((id) => players.find((player) => player.id === id)?.alive)) {
      return false;
    }
  }
  return true;
}

function validateState(data: unknown): data is DingState {
  if (!isRecord(data)
    || !isNonNegativeInteger(data.revision)
    || (data.status !== "playing" && data.status !== "finished")
    || typeof data.phase !== "string" || !PHASES.has(data.phase)
    || !isNonNegativeInteger(data.turnNumber) || data.turnNumber < 1
    || !isPlayerId(data.activePlayerId)
    || !Array.isArray(data.players) || data.players.length !== 4 || !data.players.every(isPlayer)
    || !isCardList(data.deck)
    || !isCardList(data.discard)
    || typeof data.strikeUsed !== "boolean"
    || !Array.isArray(data.stack)
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

  if (!validateStack(data, data.discard as unknown as readonly DingCard[])) return false;

  if (data.status === "finished") {
    if (data.phase !== "finished" || (data.stack as unknown as readonly ResolutionFrame[]).length !== 0) return false;
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
