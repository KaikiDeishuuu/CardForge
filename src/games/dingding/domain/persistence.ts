import { CARD_CATALOG, SEAT_ORDER, buildDeck } from "./data";
import { evaluateWinner } from "./engine";
import { HERO_IDS, heroOf } from "./heroes";
import {
  createDefaultDingRootState,
  startDingMatch,
  type ActiveDingMatch,
  type DingHeroDraft,
  type DingLifetimeProfile,
  type DingRootState,
} from "./session";
import type {
  DingCard,
  DingDifficulty,
  DingPlayer,
  DingState,
  EquipmentSlot,
  LastDingAction,
  PlayerId,
  ResolutionFrame,
} from "./types";

/**
 * v8：存档从单局 DingState 升级为长期档案 + 活动牌局（DingRootState），
 * 开始记录身份/武将胜率；v7 单局存档可无损迁移，更早版本按不可读处理。
 */
export const DING_SAVE_SCHEMA_VERSION = 8;

type UnknownRecord = Record<string, unknown>;

const PLAYER_IDS = new Set<string>(["south", "east", "north", "west"]);
const IDENTITIES = new Set<string>(["lord", "loyalist", "rebel", "renegade"]);
const PHASES = new Set<string>(["prepare", "judge", "draw", "play", "discard", "finished"]);
const DIFFICULTIES = new Set<string>(["relaxed", "standard", "tactician"]);
const CARD_KINDS = new Set<string>(["basic", "trick", "equipment"]);
const CARD_TYPES = new Set<string>([
  "strike", "evade", "salve",
  "focus", "dismantle", "snatch", "nullify",
  "duel", "horde", "volley", "grove", "aid", "probe",
  "weapon", "armor", "minus-horse", "plus-horse",
  "delay-play", "delay-draw", "delay-burn",
]);
const TRICK_TYPES = new Set<string>(["focus", "dismantle", "snatch", "nullify", "duel", "horde", "volley", "grove", "aid", "probe"]);
const SLOTS: readonly EquipmentSlot[] = ["weapon", "armor", "minusHorse", "plusHorse"];

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

function isDifficulty(value: unknown): value is DingDifficulty {
  return typeof value === "string" && DIFFICULTIES.has(value);
}

function isHeroDraft(value: unknown): value is DingHeroDraft {
  return isRecord(value)
    && Array.isArray(value.options)
    && value.options.length === 3
    && value.options.every((heroId) => typeof heroId === "string" && HERO_IDS.includes(heroId as typeof HERO_IDS[number]))
    && new Set(value.options).size === value.options.length;
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
  const id = value.id;
  const definition = Object.values(CARD_CATALOG).find((entry) =>
    id === entry.id || id.startsWith(`${entry.id}-`));
  if (!definition || definition.kind !== value.kind || definition.type !== value.type) return false;
  if (value.range !== undefined && !isPositiveInteger(value.range)) return false;
  if (value.unlimitedStrikes !== undefined && typeof value.unlimitedStrikes !== "boolean") return false;
  return true;
}

function isCardList(value: unknown): value is readonly DingCard[] {
  return Array.isArray(value) && value.every(isCard);
}

function isDelayedTricks(value: unknown): value is DingState["delayedTricks"] {
  if (!isRecord(value) || Object.keys(value).length !== PLAYER_IDS.size) return false;
  for (const id of PLAYER_IDS) {
    if (!Array.isArray(value[id])) return false;
    if (!value[id].every((entry: unknown) => isRecord(entry)
      && isCard(entry.card)
      && isPlayerId(entry.sourceActorId))) return false;
    const cardIds = (value[id] as Array<{ card: DingCard }>).map((entry) => entry.card.id);
    if (new Set(cardIds).size !== cardIds.length) return false;
  }
  return true;
}

function isEquipment(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const [slot, card] of Object.entries(value)) {
    if (!SLOTS.includes(slot as EquipmentSlot) || !isCard(card)) return false;
    const expected = slot === "weapon"
      ? "weapon"
      : slot === "armor"
        ? "armor"
        : slot === "minusHorse"
          ? "minus-horse"
          : "plus-horse";
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
    || typeof value.heroId !== "string" || !HERO_IDS.includes(value.heroId as typeof HERO_IDS[number])
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

function isIdList(value: unknown, allowEmpty = false): value is readonly PlayerId[] {
  if (!Array.isArray(value) || value.length > 4) return false;
  if (!allowEmpty && value.length === 0) return false;
  return value.every(isPlayerId) && new Set(value).size === value.length;
}

function isFrame(value: unknown): value is ResolutionFrame {
  if (!isRecord(value)) return false;
  if (value.kind === "strike") {
    return isPlayerId(value.actorId)
      && isPlayerId(value.targetId)
      && typeof value.cardUid === "string"
      && isPositiveInteger(value.damage)
      && (value.unavoidable === undefined || typeof value.unavoidable === "boolean");
  }
  if (value.kind === "dying") {
    return isPlayerId(value.targetId)
      && isPositiveInteger(value.required)
      && isNonNegativeInteger(value.offered)
      && isIdList(value.responders)
      && isNonNegativeInteger(value.cursor) && value.cursor < value.responders.length
      && (value.sourceId === undefined || isPlayerId(value.sourceId));
  }
  if (value.kind === "skill") {
    return isPlayerId(value.ownerId)
      && typeof value.skillId === "string" && value.skillId.length > 0
      && typeof value.prompt === "string" && value.prompt.length > 0
      && isIdList(value.targetIds, true);
  }
  if (value.kind === "delayed") {
    return isPlayerId(value.ownerId)
      && typeof value.cardUid === "string" && value.cardUid.length > 0
      && isPlayerId(value.sourceActorId);
  }
  if (value.kind === "protect") {
    return isPlayerId(value.actorId)
      && isPlayerId(value.targetId)
      && isPlayerId(value.protectorId)
      && value.actorId !== value.targetId
      && value.targetId !== value.protectorId
      && value.actorId !== value.protectorId
      && typeof value.cardUid === "string" && value.cardUid.length > 0
      && isPositiveInteger(value.damage);
  }
  if (value.kind === "probe") {
    return isPlayerId(value.actorId)
      && isPlayerId(value.targetId)
      && value.actorId !== value.targetId
      && typeof value.cardUid === "string" && value.cardUid.length > 0;
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
  const players = data.players as unknown as DingPlayer[];
  const deck = data.deck as unknown as readonly DingCard[];
  const trickFrames = stack.filter((frame): frame is Extract<ResolutionFrame, { kind: "trick" }> => frame.kind === "trick");
  const frameIds = trickFrames.map((frame) => frame.frameId);
  if (new Set(frameIds).size !== frameIds.length) return false;

  for (const frame of stack) {
    if (frame.kind === "trick") {
      if (frame.counterFrameId !== undefined && !frameIds.includes(frame.counterFrameId)) return false;
      if (frame.negated === true && frame.awaitingResponse === true) return false;
    }
    if (frame.kind === "strike" || frame.kind === "trick" || frame.kind === "duel" || frame.kind === "horde" || frame.kind === "volley" || frame.kind === "protect" || frame.kind === "probe") {
      // 已打出的牌可能在帧结算前因牌堆耗尽被重新洗回牌堆，甚至被技能摸回手牌；
      // 因此只要仍在任一合法牌堆中即可。
      const played = [
        ...discard,
        ...deck,
        ...players.flatMap((player) => player.hand),
      ].find((card) => card.id === frame.cardUid);
      if (!played) return false;
      const expectedType = frame.kind === "trick"
        ? frame.cardType
        : frame.kind === "protect" || frame.kind === "probe"
          ? frame.kind === "protect" ? "strike" : "probe"
          : frame.kind;
      if (played.type !== expectedType) return false;
    }
    if (frame.kind === "strike" || frame.kind === "dying") {
      if (!players.find((player) => player.id === frame.targetId)?.alive) return false;
    } else if (frame.kind === "skill") {
      if (data.phase !== "play" || data.activePlayerId !== frame.ownerId) return false;
      const owner = players.find((player) => player.id === frame.ownerId);
      const skill = owner ? heroOf(owner)?.activeSkill : undefined;
      if (!owner?.alive || !skill || skill.id !== frame.skillId || frame.prompt !== skill.prompt) return false;
      if (!owner.skillFlags[`active:${skill.id}`]) return false;
      if (skill.target === "wounded") {
        if (frame.targetIds.length === 0) return false;
        if (!frame.targetIds.every((id) => {
          const target = players.find((player) => player.id === id);
          return target?.alive && target.hp < target.maxHp;
        })) return false;
      } else if (skill.target === "other") {
        if (frame.targetIds.length === 0) return false;
        if (!frame.targetIds.every((id) => {
          const target = players.find((player) => player.id === id);
          if (!target?.alive || target.id === owner.id) return false;
          if (skill.effect.kind === "discard-target") return target.hand.length > 0;
          if (skill.effect.kind === "delay-target") return target.skillFlags[skill.effect.flag] !== true;
          return true;
        })) return false;
      } else if (frame.targetIds.length !== 0) return false;
      if (skill.cost.kind === "discard") {
        const filter = skill.cost.filter;
        const payable = owner.hand.some((card) => {
          if (filter === "strike") return card.type === "strike";
          if (filter === "evade") return card.type === "evade";
          if (filter === "trick") return card.kind === "trick";
          return true;
        });
        if (!payable) return false;
      }
    } else if (frame.kind === "duel") {
      if (!players.find((player) => player.id === frame.actorId)?.alive) return false;
      if (!players.find((player) => player.id === frame.targetId)?.alive) return false;
      if (!players.find((player) => player.id === frame.turnId)?.alive) return false;
    } else if (frame.kind === "protect") {
      const lord = players.find((player) => player.id === frame.targetId);
      const protector = players.find((player) => player.id === frame.protectorId);
      const attacker = players.find((player) => player.id === frame.actorId);
      if (!lord?.alive || lord.identity !== "lord") return false;
      if (!protector?.alive || protector.identity !== "loyalist" || protector.hand.length === 0) return false;
      if (!attacker?.alive) return false;
    } else if (frame.kind === "probe") {
      const actor = players.find((player) => player.id === frame.actorId);
      const target = players.find((player) => player.id === frame.targetId);
      if (!actor?.alive || !target?.alive || target.revealed) return false;
    } else if (frame.kind === "trick") {
      // 无懈链期间不会发生伤害或退场，所有询问者都应仍在场。
      if (!frame.responders.every((id) => players.find((player) => player.id === id)?.alive)) return false;
    } else if (frame.kind === "delayed") {
      if (data.phase !== "judge" || data.activePlayerId !== frame.ownerId) return false;
      const owner = players.find((player) => player.id === frame.ownerId);
      if (!owner?.alive) return false;
      const delayedTricks = data.delayedTricks as unknown as DingState["delayedTricks"] | undefined;
      const instance = delayedTricks?.[frame.ownerId]?.find((entry) => entry.card.id === frame.cardUid);
      if (!instance || instance.sourceActorId !== frame.sourceActorId) return false;
    } else {
      // 合围/齐射的原响应者列表会保留中途退场的角色，cursor 已跳过他们；
      // 因此只要求当前响应者仍在场。
      const current = players.find((player) => player.id === frame.responders[frame.cursor]);
      if (!current?.alive) return false;
    }
  }
  return true;
}

function validateState(data: unknown): data is DingState {
  if (!isRecord(data)
    || !isNonNegativeInteger(data.revision)
    || (data.status !== "playing" && data.status !== "finished")
    || !isDifficulty(data.difficulty)
    || typeof data.phase !== "string" || !PHASES.has(data.phase)
    || !isNonNegativeInteger(data.turnNumber) || data.turnNumber < 1
    || !isPlayerId(data.activePlayerId)
    || !Array.isArray(data.players) || data.players.length !== 4 || !data.players.every(isPlayer)
    || !isCardList(data.deck)
    || !isCardList(data.discard)
    || !isDelayedTricks(data.delayedTricks)
    || typeof data.strikeUsed !== "boolean"
    || !Array.isArray(data.stack)
    || (data.lastAction !== undefined && !isLastAction(data.lastAction))
    || !Array.isArray(data.log) || !data.log.every(isLogEntry)
    || !isNonNegativeInteger(data.rngSeed) || data.rngSeed > 0xffff_ffff) return false;

  const players = data.players as unknown as DingPlayer[];
  const ids = players.map((player) => player.id);
  if (new Set(ids).size !== 4 || !SEAT_ORDER.every((id) => ids.includes(id))) return false;
  // 座位号必须与 SEAT_ORDER 的位置语义一致；只检查 0–3 会放过交换过的座位。
  if (!players.every((player) => SEAT_ORDER[player.seat] === player.id)) return false;
  if (players.filter((player) => player.controller === "human").length !== 1) return false;
  if (new Set(players.map((player) => player.identity)).size !== IDENTITIES.size) return false;
  if (new Set(players.map((player) => player.heroId)).size !== players.length) return false;
  for (const player of players) {
    if (player.identity === "lord" && !player.revealed) return false;
  }
  // 行动者已退场但对局仍在进行是**合法**状态：焚营在判定阶段致死、约斗反噬等
  // 都会让当前回合角色死在自己的回合里，`advancePhase` 会把这种“死人回合”
  // 直接结束并交给下一名存活角色。拒绝它会让这一瞬间写下的存档在重进时
  // 被整局丢弃，因此这里只校验 activePlayerId 指向真实席位，不校验其存活。
  if (!validateStack(data, data.discard as unknown as readonly DingCard[])) return false;

  if (data.status === "finished") {
    if (data.phase !== "finished" || (data.stack as unknown as readonly ResolutionFrame[]).length !== 0) return false;
    if (data.winner !== "lord-side" && data.winner !== "rebel" && data.winner !== "renegade") return false;
    if (data.winner !== evaluateWinner(players)) return false;
  } else if (data.winner !== undefined) return false;

  const delayedTricks = data.delayedTricks as unknown as DingState["delayedTricks"];
  const delayedCards = [...PLAYER_IDS].flatMap((id) => delayedTricks[id as PlayerId].map((entry) => entry.card));
  const piles = [
    players.flatMap((player) => player.hand),
    players.flatMap((player) => SLOTS.map((slot) => player.equipment[slot]).filter((card): card is DingCard => Boolean(card))),
    delayedCards,
    data.deck as unknown as readonly DingCard[],
    data.discard as unknown as readonly DingCard[],
  ];
  const uids = cardUids(piles);
  const expected = buildDeck();
  return new Set(uids).size === uids.length
    && uids.length === expected.length
    && expected.every((card) => uids.includes(card.id));
}

function isRecordWithCounts(value: unknown): boolean {
  if (!isRecord(value)
    || !isNonNegativeInteger(value.games)
    || !isNonNegativeInteger(value.wins)
    || value.wins > value.games) return false;
  return true;
}

function isLifetimeProfile(value: unknown): value is DingLifetimeProfile {
  if (!isRecord(value)
    || !isNonNegativeInteger(value.gamesPlayed)
    || !isNonNegativeInteger(value.wins)
    || value.wins > value.gamesPlayed
    || !isRecord(value.identityRecords)
    || !isRecord(value.heroRecords)) return false;

  const identityKeys = [...IDENTITIES];
  const identityRecords = value.identityRecords as unknown as Record<string, unknown>;
  if (Object.keys(identityRecords).length !== identityKeys.length) return false;
  let identityGames = 0;
  let identityWins = 0;
  for (const identity of identityKeys) {
    if (!isRecordWithCounts(identityRecords[identity])) return false;
    const record = identityRecords[identity] as { games: number; wins: number };
    identityGames += record.games;
    identityWins += record.wins;
  }

  const heroRecords = value.heroRecords as unknown as Record<string, unknown>;
  if (Object.keys(heroRecords).length !== HERO_IDS.length) return false;
  let heroGames = 0;
  let heroWins = 0;
  for (const heroId of HERO_IDS) {
    if (!isRecordWithCounts(heroRecords[heroId])) return false;
    const record = heroRecords[heroId] as { games: number; wins: number };
    heroGames += record.games;
    heroWins += record.wins;
  }

  return value.gamesPlayed === identityGames
    && value.wins === identityWins
    && value.gamesPlayed === heroGames
    && value.wins === heroWins;
}

function isActiveMatch(value: unknown, preferencesDifficulty: DingDifficulty): value is ActiveDingMatch {
  if (!isRecord(value)
    || typeof value.resultRecorded !== "boolean"
    || (value.heroDraft !== undefined && !isHeroDraft(value.heroDraft))
    || !validateState(value.state)) return false;
  if (value.heroDraft !== undefined) {
    const draft = value.heroDraft as DingHeroDraft;
    const human = (value.state as DingState).players.find((player) => player.controller === "human");
    if (!human || !draft.options.includes(human.heroId as typeof HERO_IDS[number])) return false;
  }
  return value.resultRecorded === (value.state.status === "finished")
    && value.state.difficulty === preferencesDifficulty;
}

function restoreV8(data: unknown): DingRootState | undefined {
  if (!isRecord(data)
    || !isNonNegativeInteger(data.revision)
    || !isRecord(data.preferences)
    || !isDifficulty(data.preferences.difficulty)
    || !isLifetimeProfile(data.lifetimeProfile)) return undefined;

  const base: DingRootState = {
    revision: data.revision,
    preferences: { difficulty: data.preferences.difficulty },
    lifetimeProfile: data.lifetimeProfile,
  };
  if (data.activeMatch === undefined) return base;
  if (!isActiveMatch(data.activeMatch, base.preferences.difficulty)) return base;
  return { ...base, activeMatch: data.activeMatch };
}

/** State is already pure data; the platform envelope performs JSON encoding. */
export function serializeDingState(state: DingState): unknown {
  return state;
}

export function restoreDingState(data: unknown): DingState | undefined {
  return validateState(data) ? data : undefined;
}

export function serializeDingRootState(state: DingRootState): unknown {
  return state;
}

export function restoreDingRootState(
  schemaVersion: number,
  data: unknown,
): DingRootState | undefined {
  if (schemaVersion === DING_SAVE_SCHEMA_VERSION) return restoreV8(data);
  if (schemaVersion === 7) {
    const migrated = restoreDingState(data);
    return migrated
      ? startDingMatch(createDefaultDingRootState(migrated.difficulty), migrated)
      : undefined;
  }
  return undefined;
}
