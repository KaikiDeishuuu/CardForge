import { CARD_CATALOG, IDENTITY_NAMES, SEAT_ORDER, buildDeck } from "./data";
import { HERO_CATALOG, HERO_IDS, heroOf, type ActiveSkillBuff, type ActiveSkillDefinition, type HeroId, type TriggerPoint } from "./heroes";
import type {
  DelayedTrickInstance,
  DingCard,
  DingDifficulty,
  DingLogEntry,
  DingPlayer,
  DingState,
  EquipmentSlot,
  IdentityId,
  LastDingAction,
  MatchWinner,
  PendingDelayed,
  PendingDying,
  PendingProbe,
  PendingProtect,
  PendingSkill,
  PendingTrick,
  PlayerId,
  ResolutionFrame,
  TrickCardType,
} from "./types";

export const DRAW_PER_TURN = 2;
export const STARTING_HAND = 4;
export const LORD_BONUS_HP = 1;
export const BASE_MAX_HP = 4;
/** 进入该回合组后，每跨过一个整轮对全体存活角色造成递增真实伤害（不会致死）。 */
export const OVERHEAT_START_ROUND = 24;

const IDENTITIES: readonly IdentityId[] = ["lord", "loyalist", "rebel", "renegade"];

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function nextRandom(seed: number): { seed: number; sample: number } {
  const nextSeed = (seed + 0x6d2b79f5) >>> 0;
  let value = nextSeed;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return {
    seed: nextSeed,
    sample: ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296,
  };
}

function reshuffle(items: readonly DingCard[], seed: number): { deck: DingCard[]; seed: number } {
  const deck = [...items];
  let current = seed;
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const random = nextRandom(current);
    current = random.seed;
    const swapIndex = Math.floor(random.sample * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return { deck, seed: current };
}

function drawOne(
  deck: readonly DingCard[],
  discard: readonly DingCard[],
  seed: number,
): { card?: DingCard; deck: DingCard[]; discard: DingCard[]; seed: number } {
  let nextDeck = [...deck];
  let nextDiscard = [...discard];
  let nextSeed = seed;
  if (nextDeck.length === 0 && nextDiscard.length > 0) {
    const recycled = reshuffle(nextDiscard, seed);
    nextDeck = recycled.deck;
    nextDiscard = [];
    nextSeed = recycled.seed;
  }
  const card = nextDeck.at(-1);
  return card
    ? { card, deck: nextDeck.slice(0, -1), discard: nextDiscard, seed: nextSeed }
    : { deck: nextDeck, discard: nextDiscard, seed: nextSeed };
}

function replacePlayer(players: readonly DingPlayer[], id: PlayerId, update: (player: DingPlayer) => DingPlayer): DingPlayer[] {
  return players.map((player) => player.id === id ? update(player) : player);
}

function resetSkillFlags(players: readonly DingPlayer[]): DingPlayer[] {
  // 「坚壁」的减伤持续到拥有者下个回合开始，不随当前回合结束清空。
  const damageReduction = buffFlag("next-damage-reduction");
  return players.map((player) => {
    const skillFlags: Record<string, boolean> = {};
    if (player.skillFlags[damageReduction] === true) skillFlags[damageReduction] = true;
    if (player.skillFlags["silenced"] === true) skillFlags.silenced = true;
    return Object.keys(player.skillFlags).length === Object.keys(skillFlags).length
      ? player
      : { ...player, skillFlags };
  });
}

function activeSkillFlag(skillId: string): string {
  return `active:${skillId}`;
}

function clearTurnStartFlags(players: readonly DingPlayer[], actorId: PlayerId): DingPlayer[] {
  const damageReduction = buffFlag("next-damage-reduction");
  const actor = getPlayer(players, actorId);
  if (actor.skillFlags[damageReduction] !== true) return [...players];
  return replacePlayer(players, actorId, (player) => {
    const skillFlags = { ...player.skillFlags };
    delete skillFlags[damageReduction];
    return { ...player, skillFlags };
  });
}

function buffFlag(buff: ActiveSkillBuff): string {
  return `buff:${buff}`;
}

function activeSkillTargets(state: DingState, skill: ActiveSkillDefinition): readonly PlayerId[] {
  if (skill.target === "wounded") {
    return state.players
      .filter((player) => player.alive && player.hp < player.maxHp)
      .map((player) => player.id);
  }
  if (skill.target === "other") {
    return state.players
      .filter((player) => player.alive && state.activePlayerId !== player.id)
      .filter((player) => {
        if (skill.effect.kind === "discard-target") return player.hand.length > 0;
        if (skill.effect.kind === "delay-target") return player.skillFlags[skill.effect.flag] !== true;
        return true;
      })
      .map((player) => player.id);
  }
  return [];
}

function matchesSkillFilter(card: DingCard, filter?: "strike" | "evade" | "trick"): boolean {
  if (filter === "strike") return card.type === "strike";
  if (filter === "evade") return card.type === "evade";
  if (filter === "trick") return card.kind === "trick";
  return true;
}

function canPaySkillCost(actor: DingPlayer, skill: ActiveSkillDefinition): boolean {
  if (skill.cost.kind === "none") return true;
  const filter = skill.cost.kind === "discard" ? skill.cost.filter : undefined;
  return actor.hand.some((card) => matchesSkillFilter(card, filter));
}

/** 在指定触发点结算拥有该技能的角色；一次性技能标记写入该角色的 skillFlags。 */
function runSkillTrigger(state: DingState, point: TriggerPoint, ownerId: PlayerId): DingState {
  const owner = getPlayer(state.players, ownerId);
  if (!owner.alive || owner.skillFlags["silenced"] === true) return state;
  const hero = heroOf(owner);
  const spec = hero?.triggers?.[point];
  if (!spec || (spec.oncePerTurn && owner.skillFlags[point])) return state;

  let players = state.players;
  let deck = state.deck;
  let discard = state.discard;
  let rngSeed = state.rngSeed;
  const texts: string[] = [];

  if (spec.effect === "heal-self-1") {
    if (owner.hp >= owner.maxHp) return state;
    players = replacePlayer(players, ownerId, (player) => ({ ...player, hp: player.hp + 1 }));
    texts.push(`${owner.displayName}的「${hero.skillName}」触发，回复 1 点体力。`);
  } else {
    const count = spec.effect === "draw-self-2" ? 2 : 1;
    const drawn: DingCard[] = [];
    for (let index = 0; index < count; index += 1) {
      const draw = drawOne(deck, discard, rngSeed);
      deck = draw.deck;
      discard = draw.discard;
      rngSeed = draw.seed;
      if (draw.card) drawn.push(draw.card);
    }
    if (drawn.length === 0) return state;
    players = replacePlayer(players, ownerId, (player) => ({ ...player, hand: [...player.hand, ...drawn] }));
    texts.push(`${owner.displayName}的「${hero.skillName}」触发，摸 ${drawn.length} 张牌。`);
  }

  players = replacePlayer(players, ownerId, (player) => ({
    ...player,
    skillFlags: { ...player.skillFlags, [point]: true },
  }));
  return withAction(state, ownerId, texts, { players, deck, discard, rngSeed });
}

function appendLog(log: readonly DingLogEntry[], texts: readonly string[], revision: number): readonly DingLogEntry[] {
  return [...log, ...texts.map((text, index) => ({ id: revision * 100 + index, text }))].slice(-24);
}

function topFrame(stack: readonly ResolutionFrame[]): ResolutionFrame | undefined {
  return stack.at(-1);
}

function withAction(
  state: DingState,
  actorId: PlayerId | "table",
  texts: readonly string[],
  next: Partial<DingState>,
): DingState {
  const revision = state.revision + 1;
  const stack = next.stack ?? state.stack;
  const top = topFrame(stack);
  const lastAction: LastDingAction = {
    revision,
    actorId,
    text: texts.at(-1) ?? "",
    ...(top && "cardUid" in top ? { cardIds: [top.cardUid] } : {}),
  };
  return {
    ...state,
    ...next,
    revision,
    stack,
    lastAction,
    log: appendLog(state.log, texts, revision),
  };
}

function seatDistance(left: DingPlayer, right: DingPlayer): number {
  const direct = Math.abs(left.seat - right.seat);
  return Math.min(direct, 4 - direct);
}

export function distanceBetween(players: readonly DingPlayer[], fromId: PlayerId, toId: PlayerId): number {
  const from = getPlayer(players, fromId);
  const to = getPlayer(players, toId);
  const raw = seatDistance(from, to);
  const plusHorse = to.equipment.plusHorse ? 1 : 0;
  const minusHorse = from.equipment.minusHorse ? 1 : 0;
  const skillModifier = (from.skillFlags["silenced"] !== true ? heroOf(from)?.distanceFromModifier ?? 0 : 0)
    + (to.skillFlags["silenced"] !== true ? heroOf(to)?.distanceToModifier ?? 0 : 0)
    + (to.skillFlags["silenced"] !== true && to.skillFlags[buffFlag("distance-to-self")] ? 1 : 0);
  return Math.max(1, raw + plusHorse - minusHorse + skillModifier);
}

export function attackRange(player: DingPlayer): number {
  const base = player.equipment.weapon?.range ?? 1;
  return base + (player.skillFlags["silenced"] !== true && player.skillFlags[buffFlag("attack-range")] ? 1 : 0);
}

function nextAliveId(players: readonly DingPlayer[], fromId: PlayerId): PlayerId {
  const start = SEAT_ORDER.indexOf(fromId);
  for (let offset = 1; offset <= SEAT_ORDER.length; offset += 1) {
    const candidate = SEAT_ORDER[(start + offset) % SEAT_ORDER.length];
    if (players.find((player) => player.id === candidate)?.alive) return candidate;
  }
  return fromId;
}

function aliveOrderFrom(players: readonly DingPlayer[], fromId: PlayerId): PlayerId[] {
  const start = SEAT_ORDER.indexOf(fromId);
  return SEAT_ORDER
    .map((_, offset) => SEAT_ORDER[(start + offset) % SEAT_ORDER.length])
    .filter((id) => players.find((player) => player.id === id)?.alive);
}

export function getPlayer(players: readonly DingPlayer[], id: PlayerId): DingPlayer {
  const player = players.find((entry) => entry.id === id);
  if (!player) throw new Error(`Unknown Ding Ding player: ${id}`);
  return player;
}

export function getCard(card: DingCard): DingCard {
  return CARD_CATALOG[card.id.split("-")[0]] ?? card;
}

function cardType(card: DingCard): DingCard["type"] {
  return card.type;
}

function cardNameInPile(pile: readonly DingCard[], cardUid: string): string {
  return pile.find((card) => card.id === cardUid)?.name ?? "锦囊";
}

function createTrickFrame(
  frameId: number,
  actorId: PlayerId,
  cardUid: string,
  cardType: TrickCardType,
  targetId: PlayerId | undefined,
  players: readonly DingPlayer[],
  counterFrameId?: number,
): PendingTrick {
  return {
    kind: "trick",
    frameId,
    actorId,
    cardUid,
    cardType,
    targetId,
    counterFrameId,
    responders: aliveOrderFrom(players, actorId),
    cursor: 0,
    awaitingResponse: true,
  };
}

export const DING_DIFFICULTY_NAMES: Readonly<Record<DingDifficulty, string>> = {
  relaxed: "见习",
  standard: "标准",
  tactician: "战术",
};

export function createInitialState(
  random: () => number = Math.random,
  difficulty: DingDifficulty = "standard",
  presetHeroIds?: readonly HeroId[],
): DingState {
  const deck = shuffled(buildDeck(), random);
  let rngSeed = Math.floor(random() * 2_147_483_647) || 1;
  const identities = shuffled(IDENTITIES, random);
  const heroIds = presetHeroIds?.length === 4 && new Set(presetHeroIds).size === 4
    ? [...presetHeroIds]
    : shuffled(HERO_IDS, random);
  const players: DingPlayer[] = SEAT_ORDER.map((id, seat) => {
    const identity = identities[seat];
    const heroMaxHp = HERO_CATALOG[heroIds[seat]].maxHp;
    const maxHp = identity === "lord" ? heroMaxHp + LORD_BONUS_HP : heroMaxHp;
    return {
      id,
      displayName: id === "south" ? "你" : id === "east" ? "东座" : id === "north" ? "北座" : "西座",
      controller: id === "south" ? "human" : "ai",
      seat,
      identity,
      revealed: identity === "lord",
      hp: maxHp,
      maxHp,
      alive: true,
      hand: [],
      equipment: {},
      heroId: heroIds[seat],
      skillFlags: {},
    };
  });

  let nextDeck = deck;
  let nextDiscard: DingCard[] = [];
  const dealt: DingPlayer[] = [];
  for (const player of players) {
    const hand: DingCard[] = [];
    for (let count = 0; count < STARTING_HAND; count += 1) {
      const draw = drawOne(nextDeck, nextDiscard, rngSeed);
      nextDeck = draw.deck;
      nextDiscard = draw.discard;
      rngSeed = draw.seed;
      if (draw.card) hand.push(draw.card);
    }
    dealt.push({ ...player, hand });
  }

  const lord = dealt.find((player) => player.identity === "lord")!;
  return {
    revision: 0,
    status: "playing",
    phase: "prepare",
    difficulty,
    turnNumber: 1,
    activePlayerId: lord.id,
    players: dealt,
    deck: nextDeck,
    discard: nextDiscard,
    delayedTricks: { south: [], east: [], north: [], west: [] },
    strikeUsed: false,
    stack: [],
    log: [{ id: 0, text: `四席就位。${lord.displayName}是主君，率先行动。` }],
    rngSeed,
  };
}

/** 开局选将：仅允许在首个准备阶段把当前角色替换为另一名未被占用的武将。 */
export function chooseHero(state: DingState, playerId: PlayerId, heroId: HeroId): DingState {
  if (state.status !== "playing" || state.phase !== "prepare" || state.turnNumber !== 1 || state.stack.length > 0) return state;
  const player = getPlayer(state.players, playerId);
  if (!player.alive || player.heroId === heroId) return state;
  if (state.players.some((entry) => entry.id !== playerId && entry.heroId === heroId)) return state;
  const hero = HERO_CATALOG[heroId];
  const maxHp = player.identity === "lord" ? hero.maxHp + LORD_BONUS_HP : hero.maxHp;
  const players = replacePlayer(state.players, playerId, (entry) => ({
    ...entry,
    heroId,
    hp: maxHp,
    maxHp,
  }));
  return withAction(state, playerId, [`${player.displayName}选择武将「${hero.name}」。`], { players });
}

export function getPlayableCards(state: DingState, actorId: PlayerId): DingCard[] {
  const actor = getPlayer(state.players, actorId);
  if (state.status !== "playing" || state.phase !== "play" || state.stack.length > 0 || state.activePlayerId !== actorId || !actor.alive) return [];
  return actor.hand.filter((card) => getTargetOptions(state, actorId, card).length > 0);
}

export function getTargetOptions(state: DingState, actorId: PlayerId, card: DingCard): readonly PlayerId[] {
  const actor = getPlayer(state.players, actorId);
  if (state.status !== "playing" || state.phase !== "play" || state.stack.length > 0 || state.activePlayerId !== actorId || !actor.alive) return [];
  if (!actor.hand.some((entry) => entry.id === card.id)) return [];

  switch (cardType(card)) {
    case "strike": {
      if (state.strikeUsed && !actor.equipment.weapon?.unlimitedStrikes) return [];
      const range = attackRange(actor);
      return state.players
        .filter((candidate) => candidate.id !== actor.id && candidate.alive && distanceBetween(state.players, actor.id, candidate.id) <= range)
        .map((candidate) => candidate.id);
    }
    case "salve":
      return actor.hp < actor.maxHp ? [actor.id] : [];
    case "focus":
      return [actor.id];
    case "dismantle":
      return state.players
        .filter((candidate) => candidate.id !== actor.id && candidate.alive && (
          candidate.hand.length > 0
          || Object.values(candidate.equipment).some(Boolean)
          || (state.delayedTricks[candidate.id]?.length ?? 0) > 0
        ))
        .map((candidate) => candidate.id);
    case "snatch":
      return state.players
        .filter((candidate) => candidate.id !== actor.id
          && candidate.alive
          && distanceBetween(state.players, actor.id, candidate.id) === 1
          && (
            candidate.hand.length > 0
            || Object.values(candidate.equipment).some(Boolean)
            || (state.delayedTricks[candidate.id]?.length ?? 0) > 0
          ))
        .map((candidate) => candidate.id);
    case "probe":
      return state.players
        .filter((candidate) => candidate.id !== actor.id && candidate.alive && !candidate.revealed)
        .map((candidate) => candidate.id);
    case "duel":
      return state.players
        .filter((candidate) => candidate.id !== actor.id && candidate.alive)
        .map((candidate) => candidate.id);
    case "horde":
    case "volley":
    case "grove":
      return [actor.id];
    case "aid":
      return state.players
        .filter((candidate) => candidate.alive && candidate.hp < candidate.maxHp)
        .map((candidate) => candidate.id);
    case "delay-play":
    case "delay-draw":
    case "delay-burn":
      return state.players
        .filter((candidate) => candidate.id !== actor.id
          && candidate.alive
          && distanceBetween(state.players, actor.id, candidate.id) === 1
          && (state.delayedTricks[candidate.id]?.length ?? 0) === 0)
        .map((candidate) => candidate.id);
    case "weapon": {
      const current = actor.equipment.weapon;
      return !current || current.id !== card.id ? [actor.id] : [];
    }
    case "armor": {
      const current = actor.equipment.armor;
      return !current || current.id !== card.id ? [actor.id] : [];
    }
    case "minus-horse":
      return !actor.equipment.minusHorse ? [actor.id] : [];
    case "plus-horse":
      return !actor.equipment.plusHorse ? [actor.id] : [];
    case "evade":
    case "nullify":
      return [];
  }
}

export function getActiveSkillUse(
  state: DingState,
  actorId: PlayerId,
): { readonly skill: ActiveSkillDefinition; readonly targetIds: readonly PlayerId[] } | undefined {
  if (state.status !== "playing" || state.phase !== "play" || state.stack.length > 0 || state.activePlayerId !== actorId) {
    return undefined;
  }
  const actor = getPlayer(state.players, actorId);
  if (!actor.alive || actor.skillFlags["silenced"] === true) return undefined;
  const skill = heroOf(actor)?.activeSkill;
  if (!skill || actor.skillFlags[activeSkillFlag(skill.id)]) return undefined;
  if (!canPaySkillCost(actor, skill)) return undefined;
  if (skill.effect.kind === "heal-self" && actor.hp >= actor.maxHp) return undefined;
  if (skill.effect.kind === "reset-strike" && !state.strikeUsed) return undefined;
  const targetIds = activeSkillTargets(state, skill);
  if (skill.target !== "self" && targetIds.length === 0) return undefined;
  return { skill, targetIds };
}

/** 出牌阶段发动主动技：不立刻结算，而是压入 PendingSkill 决策帧。 */
export function activateSkill(state: DingState, actorId: PlayerId, skillId: string): DingState {
  const offer = getActiveSkillUse(state, actorId);
  if (!offer || offer.skill.id !== skillId) return state;
  const actor = getPlayer(state.players, actorId);
  const pending: PendingSkill = {
    kind: "skill",
    ownerId: actorId,
    skillId: offer.skill.id,
    prompt: offer.skill.prompt,
    targetIds: offer.targetIds,
  };
  const players = replacePlayer(state.players, actorId, (player) => ({
    ...player,
    skillFlags: { ...player.skillFlags, [activeSkillFlag(skillId)]: true },
  }));
  return withAction(state, actorId, [`${actor.displayName}发动「${offer.skill.name}」。`], {
    players,
    stack: [...state.stack, pending],
  });
}

export function respondToSkill(
  state: DingState,
  responderId: PlayerId,
  decision?: { readonly cardUid?: string; readonly targetId?: PlayerId },
): DingState {
  const pending = topFrame(state.stack);
  if (state.status !== "playing" || !pending || pending.kind !== "skill" || pending.ownerId !== responderId) return state;
  const owner = getPlayer(state.players, responderId);
  const skill = heroOf(owner)?.activeSkill;
  if (!skill || skill.id !== pending.skillId) return state;
  const remaining = state.stack.slice(0, -1);

  // undefined 表示放弃；无消耗技能用空对象 {} 表示确认发动。
  if (!decision) {
    return withAction(state, responderId, [`${owner.displayName}放弃发动「${skill.name}」。`], { stack: remaining });
  }

  let costCard: DingCard | undefined;
  if (skill.cost.kind === "discard") {
    if (!decision.cardUid) return state;
    const candidate = owner.hand.find((card) => card.id === decision.cardUid);
    if (!candidate || !matchesSkillFilter(candidate, skill.cost.filter)) return state;
    costCard = candidate;
  } else if (decision.cardUid !== undefined) return state;

  let target: DingPlayer | undefined;
  if (skill.target === "wounded") {
    if (!decision.targetId || !pending.targetIds.includes(decision.targetId)) return state;
    target = getPlayer(state.players, decision.targetId);
    if (target.hp >= target.maxHp) return state;
  } else if (skill.target === "other") {
    if (!decision.targetId || !pending.targetIds.includes(decision.targetId)) return state;
    target = getPlayer(state.players, decision.targetId);
    if (skill.effect.kind === "discard-target" && target.hand.length === 0) return state;
    if (skill.effect.kind === "delay-target" && target.skillFlags[skill.effect.flag] === true) return state;
  } else if (decision.targetId !== undefined) return state;

  let players = state.players;
  let discard = state.discard;
  let deck = state.deck;
  let rngSeed = state.rngSeed;
  const texts: string[] = [];

  if (costCard) {
    players = replacePlayer(players, responderId, (player) => ({
      ...player,
      hand: player.hand.filter((card) => card.id !== costCard!.id),
    }));
    discard = [...discard, costCard];
    texts.push(`${owner.displayName}弃置「${costCard.name}」发动「${skill.name}」。`);
  } else {
    texts.push(`${owner.displayName}发动「${skill.name}」。`);
  }

  if (skill.effect.kind === "heal-self") {
    const healAmount = skill.effect.amount;
    players = replacePlayer(players, responderId, (player) => ({
      ...player,
      hp: Math.min(player.maxHp, player.hp + healAmount),
    }));
    texts.push(`${owner.displayName}回复 ${healAmount} 点体力。`);
  } else if (skill.effect.kind === "draw-target") {
    const drawn: DingCard[] = [];
    for (let count = 0; count < skill.effect.count; count += 1) {
      const draw = drawOne(deck, discard, rngSeed);
      deck = draw.deck;
      discard = draw.discard;
      rngSeed = draw.seed;
      if (draw.card) drawn.push(draw.card);
    }
    players = replacePlayer(players, target!.id, (player) => ({
      ...player,
      hand: [...player.hand, ...drawn],
    }));
    texts.push(`${target!.displayName}摸 ${drawn.length} 张牌。`);
  } else if (skill.effect.kind === "discard-target") {
    const taken = takeRandomHandCard(target!.hand, rngSeed);
    rngSeed = taken.seed;
    if (taken.card) {
      players = replacePlayer(players, target!.id, (player) => ({ ...player, hand: taken.hand }));
      discard = [...discard, taken.card];
      texts.push(`${target!.displayName}弃置「${taken.card.name}」。`);
    }
  } else if (skill.effect.kind === "delay-target") {
    const flag = skill.effect.flag;
    players = replacePlayer(players, target!.id, (player) => ({
      ...player,
      skillFlags: { ...player.skillFlags, [flag]: true },
    }));
    texts.push(`${target!.displayName}${flag === "delay:skip-play" ? "跳过下一个出牌阶段" : "跳过下一个摸牌阶段"}。`);
  } else if (skill.effect.kind === "damage") {
    const opened = withAction(state, responderId, texts, {
      players,
      discard,
      stack: remaining,
    });
    return damagePlayer(opened, target!.id, skill.effect.amount, responderId);
  } else if (skill.effect.kind === "reset-strike") {
    return withAction(state, responderId, texts, {
      players,
      discard,
      stack: remaining,
      strikeUsed: false,
    });
  } else if (skill.effect.kind === "heal-1") {
    players = replacePlayer(players, target!.id, (player) => ({
      ...player,
      hp: player.hp + 1,
    }));
    texts.push(`${target!.displayName}回复 1 点体力。`);
  } else if (skill.effect.kind === "draw") {
    const drawn: DingCard[] = [];
    for (let count = 0; count < skill.effect.count; count += 1) {
      const draw = drawOne(deck, discard, rngSeed);
      deck = draw.deck;
      discard = draw.discard;
      rngSeed = draw.seed;
      if (draw.card) drawn.push(draw.card);
    }
    players = replacePlayer(players, responderId, (player) => ({
      ...player,
      hand: [...player.hand, ...drawn],
    }));
    texts.push(`${owner.displayName}摸 ${drawn.length} 张牌。`);
  } else if (skill.effect.kind === "draw-discard") {
    const drawn: DingCard[] = [];
    for (let count = 0; count < skill.effect.draw; count += 1) {
      const draw = drawOne(deck, discard, rngSeed);
      deck = draw.deck;
      discard = draw.discard;
      rngSeed = draw.seed;
      if (draw.card) drawn.push(draw.card);
    }
    players = replacePlayer(players, responderId, (player) => ({
      ...player,
      hand: [...player.hand, ...drawn],
    }));
    const afterDraw = getPlayer(players, responderId);
    const discarded = worstCardsForDiscard(afterDraw.hand, skill.effect.discard);
    players = replacePlayer(players, responderId, (player) => ({
      ...player,
      hand: player.hand.filter((card) => !discarded.some((entry) => entry.id === card.id)),
    }));
    discard = [...discard, ...discarded];
    texts.push(
      discarded.length > 0
        ? `${owner.displayName}摸 ${drawn.length} 张牌，然后弃置${discarded.map((card) => `「${card.name}」`).join("、")}。`
        : `${owner.displayName}摸 ${drawn.length} 张牌，无需弃置。`,
    );
  } else if (skill.effect.kind === "buff") {
    const buff = skill.effect.buff;
    players = replacePlayer(players, responderId, (player) => ({
      ...player,
      skillFlags: { ...player.skillFlags, [buffFlag(buff)]: true },
    }));
    texts.push(`${owner.displayName}获得本回合增益。`);
  }

  return withAction(state, responderId, texts, {
    players,
    discard,
    deck,
    rngSeed,
    stack: remaining,
  });
}

interface ZoneCardEntry {
  readonly card: DingCard;
  readonly zone: "hand" | "equipment" | "delayed";
  readonly slot?: EquipmentSlot;
}

function playerZoneCards(player: DingPlayer, delayed: readonly DelayedTrickInstance[]): ZoneCardEntry[] {
  const hand = player.hand.map((card) => ({ card, zone: "hand" as const }));
  const equipment = (["weapon", "armor", "minusHorse", "plusHorse"] as const)
    .map((slot) => ({ slot, card: player.equipment[slot] }))
    .filter((entry): entry is { slot: EquipmentSlot; card: DingCard } => Boolean(entry.card))
    .map((entry) => ({ card: entry.card, zone: "equipment" as const, slot: entry.slot }));
  const judged = delayed.map((entry) => ({ card: entry.card, zone: "delayed" as const }));
  return [...hand, ...equipment, ...judged];
}

function takeRandomZoneCard(
  player: DingPlayer,
  delayed: readonly DelayedTrickInstance[],
  seed: number,
): { entry?: ZoneCardEntry; player: DingPlayer; delayed: DelayedTrickInstance[]; seed: number } {
  const entries = playerZoneCards(player, delayed);
  if (entries.length === 0) return { player: { ...player }, delayed: [...delayed], seed };
  const random = nextRandom(seed);
  const entry = entries[Math.floor(random.sample * entries.length)];
  if (entry.zone === "hand") {
    return {
      entry,
      player: { ...player, hand: player.hand.filter((card) => card.id !== entry.card.id) },
      delayed: [...delayed],
      seed: random.seed,
    };
  }
  if (entry.zone === "equipment") {
    const equipment = { ...player.equipment };
    delete equipment[entry.slot!];
    return {
      entry,
      player: { ...player, equipment },
      delayed: [...delayed],
      seed: random.seed,
    };
  }
  return {
    entry,
    player: { ...player },
    delayed: delayed.filter((instance) => instance.card.id !== entry.card.id),
    seed: random.seed,
  };
}

function zoneLabel(entry: ZoneCardEntry): string {
  return entry.zone === "hand" ? "手牌" : entry.zone === "equipment" ? "装备区" : "判定区";
}

function takeRandomHandCard(hand: readonly DingCard[], seed: number): { card?: DingCard; hand: DingCard[]; seed: number } {
  if (hand.length === 0) return { hand: [...hand], seed };
  const random = nextRandom(seed);
  const index = Math.floor(random.sample * hand.length);
  return { card: hand[index], hand: hand.filter((_, entryIndex) => entryIndex !== index), seed: random.seed };
}

const SKILL_DISCARD_PRIORITY: Readonly<Record<DingCard["type"], number>> = {
  strike: 0,
  dismantle: 1,
  snatch: 2,
  duel: 3,
  horde: 4,
  volley: 5,
  focus: 6,
  aid: 7,
  weapon: 8,
  "minus-horse": 8,
  "plus-horse": 9,
  armor: 10,
  grove: 10,
  probe: 10,
  "delay-play": 11,
  "delay-draw": 12,
  "delay-burn": 13,
  nullify: 14,
  evade: 15,
  salve: 16,
};

function worstCardsForDiscard(hand: readonly DingCard[], count: number): DingCard[] {
  return [...hand]
    .sort((left, right) =>
      SKILL_DISCARD_PRIORITY[left.type] - SKILL_DISCARD_PRIORITY[right.type]
      || left.id.localeCompare(right.id),
    )
    .slice(0, count);
}

function equipCard(player: DingPlayer, card: DingCard): { player: DingPlayer; discarded: DingCard[] } {
  const slot: EquipmentSlot | undefined = card.type === "weapon"
    ? "weapon"
    : card.type === "armor"
      ? "armor"
      : card.type === "minus-horse"
        ? "minusHorse"
        : card.type === "plus-horse"
          ? "plusHorse"
          : undefined;
  if (!slot) return { player, discarded: [] };
  const previous = player.equipment[slot];
  return {
    player: { ...player, equipment: { ...player.equipment, [slot]: card } },
    discarded: previous ? [previous] : [],
  };
}

export function playCard(state: DingState, actorId: PlayerId, cardUid: string, targetId?: PlayerId): DingState {
  if (state.status !== "playing" || state.phase !== "play" || state.stack.length > 0 || state.activePlayerId !== actorId) return state;
  const actor = getPlayer(state.players, actorId);
  if (!actor.alive) return state;
  const card = actor.hand.find((entry) => entry.id === cardUid);
  if (!card) return state;
  const targetOptions = getTargetOptions(state, actorId, card);
  const fallbackTarget = card.type === "focus"
    || card.type === "salve"
    || card.type === "horde"
    || card.type === "volley"
    || card.type === "grove"
    || card.type === "weapon"
    || card.type === "armor"
    || card.type === "minus-horse"
    || card.type === "plus-horse"
    ? actor.id
    : undefined;
  const requestedTarget = targetId ?? fallbackTarget;
  if (!requestedTarget || !targetOptions.includes(requestedTarget)) return state;

  let players = replacePlayer(state.players, actorId, (player) => ({
    ...player,
    hand: player.hand.filter((entry) => entry.id !== cardUid),
  }));
  const deck = state.deck;
  let discard = [...state.discard];
  const rngSeed = state.rngSeed;
  let stack: ResolutionFrame[] = [];
  let strikeUsed = state.strikeUsed;
  const texts = [`${actor.displayName}打出「${card.name}」。`];
  const boostedStrike = card.type === "strike"
    && actor.skillFlags["silenced"] !== true
    && actor.skillFlags[buffFlag("next-strike-damage")] === true;
  const unavoidableStrike = card.type === "strike"
    && actor.skillFlags["silenced"] !== true
    && actor.skillFlags[buffFlag("next-strike-unavoidable")] === true;
  if (boostedStrike || unavoidableStrike) {
    players = replacePlayer(players, actorId, (player) => ({
      ...player,
      skillFlags: {
        ...player.skillFlags,
        ...(boostedStrike ? { [buffFlag("next-strike-damage")]: false } : {}),
        ...(unavoidableStrike ? { [buffFlag("next-strike-unavoidable")]: false } : {}),
      },
    }));
  }

  switch (card.type) {
    case "strike": {
      if (!targetId) return state;
      const target = getPlayer(players, targetId);
      stack = [{
        kind: "strike",
        actorId,
        targetId,
        cardUid,
        damage: boostedStrike ? 2 : 1,
        ...(unavoidableStrike ? { unavoidable: true } : {}),
      }];
      strikeUsed = true;
      discard = [...discard, card];
      texts.push(unavoidableStrike
        ? `${target.displayName}无法打出「闪避」响应。`
        : `${target.displayName}可以打出「闪避」响应。`);
      break;
    }
    case "salve": {
      players = replacePlayer(players, actorId, (player) => ({
        ...player,
        hp: Math.min(player.maxHp, player.hp + 1),
      }));
      discard = [...discard, card];
      texts.push(`${actor.displayName}回复 1 点体力。`);
      break;
    }
    case "focus":
    case "dismantle":
    case "snatch":
    case "duel":
    case "horde":
    case "volley":
    case "grove":
    case "aid":
    case "probe": {
      discard = [...discard, card];
      const needsTarget = card.type === "dismantle"
        || card.type === "snatch"
        || card.type === "duel"
        || card.type === "aid"
        || card.type === "probe";
      const effectTarget = needsTarget ? targetId : undefined;
      if (needsTarget && !effectTarget) return state;
      stack = [createTrickFrame(state.revision + 1, actorId, cardUid, card.type, effectTarget, players)];
      texts.push(
        needsTarget
          ? `${actor.displayName}对${getPlayer(players, effectTarget!).displayName}使用「${card.name}」，等待无懈可击响应。`
          : `${actor.displayName}使用「${card.name}」，等待无懈可击响应。`,
      );
      break;
    }
    case "delay-play":
    case "delay-draw":
    case "delay-burn": {
      if (!targetId) return state;
      const target = getPlayer(players, targetId);
      const delayedTricks = {
        ...state.delayedTricks,
        [targetId]: [...(state.delayedTricks[targetId] ?? []), { card, sourceActorId: actorId }],
      };
      texts.push(`${actor.displayName}对${target.displayName}使用「${card.name}」，其进入判定区。`);
      return withAction({ ...state, players }, actorId, texts, { players, delayedTricks });
    }
    case "weapon":
    case "armor":
    case "minus-horse":
    case "plus-horse": {
      const equipped = equipCard(getPlayer(players, actorId), card);
      players = replacePlayer(players, actorId, () => equipped.player);
      discard = [...discard, ...equipped.discarded];
      texts.push(equipped.discarded.length > 0 ? `${actor.displayName}更换装备，旧的「${equipped.discarded[0].name}」进入弃牌堆。` : `${actor.displayName}装备「${card.name}」。`);
      break;
    }
    case "evade":
    case "nullify":
      return state;
  }

  return withAction(state, actorId, texts, {
    players,
    deck,
    discard,
    rngSeed,
    stack,
    strikeUsed,
  });
}

/** 结算一张未被抵消的锦囊帧，并可能把下一段挂起的锦囊一并结清。 */
function applyTrickEffect(
  draft: {
    players: DingPlayer[];
    deck: DingCard[];
    discard: DingCard[];
    delayedTricks: DingState["delayedTricks"];
    rngSeed: number;
    stack: ResolutionFrame[];
    texts: string[];
  },
  frame: PendingTrick,
): void {
  if (frame.cardType === "nullify") {
    const targetIndex = draft.stack.findIndex(
      (entry) => entry.kind === "trick" && entry.frameId === frame.counterFrameId,
    );
    if (targetIndex < 0) return;
    const target = draft.stack[targetIndex] as PendingTrick;
    draft.stack = draft.stack.map((entry) =>
      entry.kind === "trick" && entry.frameId === target.frameId ? { ...entry, negated: true } : entry,
    );
    draft.texts.push(
      `${getPlayer(draft.players, frame.actorId).displayName}的「无懈可击」生效，抵消了${getPlayer(draft.players, target.actorId).displayName}的「${cardNameInPile(draft.discard, target.cardUid)}」。`,
    );
    return;
  }

  const actor = getPlayer(draft.players, frame.actorId);
  const cardName = cardNameInPile(draft.discard, frame.cardUid);
  if (frame.cardType === "focus") {
    const drawn: DingCard[] = [];
    for (let count = 0; count < 2; count += 1) {
      const draw = drawOne(draft.deck, draft.discard, draft.rngSeed);
      draft.deck = draw.deck;
      draft.discard = draw.discard;
      draft.rngSeed = draw.seed;
      if (draw.card) drawn.push(draw.card);
    }
    draft.players = replacePlayer(draft.players, actor.id, (player) => ({
      ...player,
      hand: [...player.hand, ...drawn],
    }));
    draft.texts.push(`${actor.displayName}的「聚势」生效，摸 ${drawn.length} 张牌。`);
    return;
  }

  if (frame.cardType === "dismantle" && frame.targetId) {
    const target = getPlayer(draft.players, frame.targetId);
    if (target.alive && playerZoneCards(target, draft.delayedTricks[target.id] ?? []).length > 0) {
      const taken = takeRandomZoneCard(target, draft.delayedTricks[target.id] ?? [], draft.rngSeed);
      draft.rngSeed = taken.seed;
      if (taken.entry) {
        draft.players = replacePlayer(draft.players, target.id, () => taken.player);
        draft.delayedTricks = { ...draft.delayedTricks, [target.id]: taken.delayed };
        draft.discard = [...draft.discard, taken.entry.card];
        draft.texts.push(`${actor.displayName}的「${cardName}」生效，${target.displayName}弃置${zoneLabel(taken.entry)}里的「${taken.entry.card.name}」。`);
      }
    } else {
      draft.texts.push(`${actor.displayName}的「${cardName}」生效，但${target.displayName}没有可拆的牌。`);
    }
    return;
  }

  if (frame.cardType === "snatch" && frame.targetId) {
    const target = getPlayer(draft.players, frame.targetId);
    if (target.alive && playerZoneCards(target, draft.delayedTricks[target.id] ?? []).length > 0) {
      const taken = takeRandomZoneCard(target, draft.delayedTricks[target.id] ?? [], draft.rngSeed);
      draft.rngSeed = taken.seed;
      if (taken.entry) {
        draft.players = replacePlayer(draft.players, target.id, () => taken.player);
        draft.players = replacePlayer(draft.players, actor.id, (player) => ({
          ...player,
          hand: [...player.hand, taken.entry!.card],
        }));
        draft.delayedTricks = { ...draft.delayedTricks, [target.id]: taken.delayed };
        draft.texts.push(`${actor.displayName}的「${cardName}」生效，获得${target.displayName}${zoneLabel(taken.entry)}里的「${taken.entry.card.name}」。`);
      }
    } else {
      draft.texts.push(`${actor.displayName}的「${cardName}」生效，但${target.displayName}没有可取的牌。`);
    }
    return;
  }

  if (frame.cardType === "duel" && frame.targetId) {
    const target = getPlayer(draft.players, frame.targetId);
    if (target.alive && target.id !== actor.id) {
      draft.stack = [...draft.stack, {
        kind: "duel",
        actorId: actor.id,
        targetId: target.id,
        turnId: target.id,
        cardUid: frame.cardUid,
      }];
      draft.texts.push(`${actor.displayName}的「约斗」生效，${target.displayName}先出「刺击」。`);
    } else {
      draft.texts.push(`${actor.displayName}的「约斗」生效，但目标已不在场。`);
    }
    return;
  }

  if (frame.cardType === "horde" || frame.cardType === "volley") {
    const responders = aliveOrderFrom(draft.players, actor.id).filter((id) => id !== actor.id);
    if (responders.length === 0) {
      draft.texts.push(`${actor.displayName}的「${cardName}」生效，但没有其他角色需要响应。`);
      return;
    }
    draft.stack = [...draft.stack, frame.cardType === "horde"
      ? { kind: "horde", actorId: actor.id, cardUid: frame.cardUid, responders, cursor: 0 }
      : { kind: "volley", actorId: actor.id, cardUid: frame.cardUid, responders, cursor: 0 }];
    draft.texts.push(`${actor.displayName}的「${cardName}」生效，按座位顺序逐席响应。`);
    return;
  }

  if (frame.cardType === "aid" && frame.targetId) {
    const target = getPlayer(draft.players, frame.targetId);
    if (target.alive && target.hp < target.maxHp) {
      draft.players = replacePlayer(draft.players, target.id, (player) => ({ ...player, hp: player.hp + 1 }));
      draft.texts.push(`${actor.displayName}的「${cardName}」生效，${target.displayName}回复 1 点体力。`);
    } else {
      draft.texts.push(`${actor.displayName}的「${cardName}」生效，但目标已无需回复。`);
    }
    return;
  }

  if (frame.cardType === "probe" && frame.targetId) {
    const target = getPlayer(draft.players, frame.targetId);
    if (target.alive && !target.revealed) {
      const probeFrame: PendingProbe = {
        kind: "probe",
        actorId: actor.id,
        targetId: target.id,
        cardUid: frame.cardUid,
      };
      draft.stack = [...draft.stack, probeFrame];
      draft.texts.push(`${actor.displayName}的「${cardName}」生效，猜测${target.displayName}的身份。`);
    } else {
      draft.texts.push(`${actor.displayName}的「${cardName}」生效，但目标身份已公开或已不在场。`);
    }
    return;
  }

  if (frame.cardType === "grove") {
    let healed = 0;
    for (const player of draft.players.filter((entry) => entry.alive && entry.hp < entry.maxHp)) {
      draft.players = replacePlayer(draft.players, player.id, (entry) => ({ ...entry, hp: entry.hp + 1 }));
      healed += 1;
    }
    draft.texts.push(healed > 0
      ? `${actor.displayName}的「同袍」生效，${healed} 名角色回复 1 点体力。`
      : `${actor.displayName}的「同袍」生效，但没有角色受伤。`);
  }
}

/**
 * 从栈顶开始结清所有已就绪的锦囊帧：
 * 被抵消的帧直接弹出，等待链挂起的帧直接结算，仍在询问的帧停下等待响应。
 */
function settleTrickFrames(
  state: DingState,
  stack: readonly ResolutionFrame[],
  texts: readonly string[] = [],
): DingState {
  if (state.status !== "playing") return state;
  const draft = {
    players: [...state.players],
    deck: [...state.deck],
    discard: [...state.discard],
    delayedTricks: { ...state.delayedTricks },
    rngSeed: state.rngSeed,
    stack: [...stack],
    texts: [...texts],
    resolvedActors: [] as PlayerId[],
  };
  let settled = false;
  for (;;) {
    const top = topFrame(draft.stack);
    if (!top || top.kind !== "trick") break;
    if (top.awaitingResponse && !top.negated) break;
    draft.stack = draft.stack.slice(0, -1);
    settled = true;
    if (top.negated) {
      draft.texts.push(
        `${getPlayer(draft.players, top.actorId).displayName}的「${cardNameInPile(draft.discard, top.cardUid)}」被无懈可击抵消，不生效。`,
      );
      continue;
    }
    if (top.cardType !== "nullify") draft.resolvedActors.push(top.actorId);
    applyTrickEffect(draft, top);
  }
  if (!settled && draft.texts.length === 0) return state;
  let next = withAction(state, "table", draft.texts, {
    players: draft.players,
    deck: draft.deck,
    discard: draft.discard,
    delayedTricks: draft.delayedTricks,
    rngSeed: draft.rngSeed,
    stack: draft.stack,
  });
  for (const actorId of draft.resolvedActors) {
    next = runSkillTrigger(next, "trickResolved", actorId);
  }
  return next;
}

export function respondToTrick(state: DingState, responderId: PlayerId, cardUid?: string): DingState {
  const top = topFrame(state.stack);
  if (state.status !== "playing" || !top || top.kind !== "trick" || !top.awaitingResponse) return state;
  if (top.responders[top.cursor] !== responderId) return state;

  const responder = getPlayer(state.players, responderId);
  const card = cardUid ? responder.hand.find((entry) => entry.id === cardUid) : undefined;
  if (cardUid && card?.type !== "nullify") return state;

  if (card) {
    const players = replacePlayer(state.players, responderId, (player) => ({
      ...player,
      hand: player.hand.filter((entry) => entry.id !== cardUid),
    }));
    const discard = [...state.discard, card];
    const suspended = state.stack.map((entry) =>
      entry.kind === "trick" && entry.frameId === top.frameId ? { ...entry, awaitingResponse: false } : entry,
    );
    const frame = createTrickFrame(
      state.revision + 1,
      responderId,
      card.id,
      "nullify",
      undefined,
      players,
      top.frameId,
    );
    return withAction(state, responderId, [`${responder.displayName}打出「无懈可击」，指向「${cardNameInPile(state.discard, top.cardUid)}」。`], {
      players,
      discard,
      stack: [...suspended, frame],
    });
  }

  const nextCursor = top.cursor + 1;
  if (nextCursor < top.responders.length) {
    const stack = state.stack.map((entry) =>
      entry.kind === "trick" && entry.frameId === top.frameId ? { ...entry, cursor: nextCursor } : entry,
    );
    return withAction(state, responderId, [`${responder.displayName}不响应「${cardNameInPile(state.discard, top.cardUid)}」。`], { stack });
  }

  const stack = state.stack.map((entry) =>
    entry.kind === "trick" && entry.frameId === top.frameId ? { ...entry, awaitingResponse: false } : entry,
  );
  return settleTrickFrames(state, stack, [`${responder.displayName}不响应，开始结算「${cardNameInPile(state.discard, top.cardUid)}」。`]);
}

export function respondToProbe(state: DingState, actorId: PlayerId, guess?: IdentityId): DingState {
  const pending = topFrame(state.stack);
  if (state.status !== "playing" || !pending || pending.kind !== "probe" || pending.actorId !== actorId || !guess) return state;
  const actor = getPlayer(state.players, actorId);
  const target = getPlayer(state.players, pending.targetId);
  const remaining = state.stack.slice(0, -1);

  if (guess === target.identity) {
    const drawn: DingCard[] = [];
    let deck = state.deck;
    let discard = state.discard;
    let rngSeed = state.rngSeed;
    for (let count = 0; count < 2; count += 1) {
      const draw = drawOne(deck, discard, rngSeed);
      deck = draw.deck;
      discard = draw.discard;
      rngSeed = draw.seed;
      if (draw.card) drawn.push(draw.card);
    }
    let players = replacePlayer(state.players, target.id, (player) => ({ ...player, revealed: true }));
    players = replacePlayer(players, actor.id, (player) => ({ ...player, hand: [...player.hand, ...drawn] }));
    return withAction(state, actorId, [
      `${actor.displayName}猜中了：${target.displayName}是「${IDENTITY_NAMES[target.identity]}」，其身份公开；摸 ${drawn.length} 张牌。`,
    ], {
      players,
      deck,
      discard,
      rngSeed,
      stack: remaining,
    });
  }

  const taken = takeRandomHandCard(actor.hand, state.rngSeed);
  const players = taken.card
    ? replacePlayer(state.players, actor.id, (player) => ({ ...player, hand: taken.hand }))
    : state.players;
  const discard = taken.card ? [...state.discard, taken.card] : state.discard;
  return withAction(state, actorId, [
    taken.card
      ? `${actor.displayName}猜测${target.displayName}是「${IDENTITY_NAMES[guess]}」，猜错了；弃置「${taken.card.name}」。`
      : `${actor.displayName}猜测${target.displayName}是「${IDENTITY_NAMES[guess]}」，猜错了；但没有手牌可弃。`,
  ], {
    players,
    discard,
    rngSeed: taken.seed,
    stack: remaining,
  });
}

/** 群体锦囊当前响应者之后的下一名存活响应者；没有则返回 undefined。 */
function nextGroupCursor(
  players: readonly DingPlayer[],
  responders: readonly PlayerId[],
  cursor: number,
): number | undefined {
  for (let index = cursor + 1; index < responders.length; index += 1) {
    if (players.find((player) => player.id === responders[index])?.alive) return index;
  }
  return undefined;
}

export function respondToDuel(state: DingState, responderId: PlayerId, cardUid?: string): DingState {
  const top = topFrame(state.stack);
  if (state.status !== "playing" || !top || top.kind !== "duel" || top.turnId !== responderId) return state;
  const responder = getPlayer(state.players, responderId);
  const card = cardUid ? responder.hand.find((entry) => entry.id === cardUid) : undefined;
  if (cardUid && card?.type !== "strike") return state;

  const remaining = state.stack.slice(0, -1);
  if (card) {
    const players = replacePlayer(state.players, responderId, (player) => ({
      ...player,
      hand: player.hand.filter((entry) => entry.id !== cardUid),
    }));
    const nextTurnId = responderId === top.targetId ? top.actorId : top.targetId;
    const texts = [`${responder.displayName}打出「刺击」，轮到${getPlayer(players, nextTurnId).displayName}。`];
    return withAction(state, responderId, texts, {
      players,
      discard: [...state.discard, card],
      stack: [...remaining, { ...top, turnId: nextTurnId }],
    });
  }

  const winnerId = responderId === top.targetId ? top.actorId : top.targetId;
  const opened = withAction(state, responderId, [`${responder.displayName}打不出「刺击」。`], {});
  return damagePlayer({ ...opened, stack: remaining }, responderId, 1, winnerId);
}

export function respondToHorde(state: DingState, responderId: PlayerId, cardUid?: string): DingState {
  const top = topFrame(state.stack);
  if (state.status !== "playing" || !top || top.kind !== "horde") return state;
  if (top.responders[top.cursor] !== responderId) return state;
  const responder = getPlayer(state.players, responderId);
  const card = cardUid ? responder.hand.find((entry) => entry.id === cardUid) : undefined;
  if (cardUid && card?.type !== "strike") return state;

  const remaining = state.stack.slice(0, -1);
  if (card) {
    const players = replacePlayer(state.players, responderId, (player) => ({
      ...player,
      hand: player.hand.filter((entry) => entry.id !== cardUid),
    }));
    const cursor = nextGroupCursor(players, top.responders, top.cursor);
    return withAction(state, responderId, [`${responder.displayName}打出「刺击」抵御合围。`], {
      players,
      discard: [...state.discard, card],
      stack: cursor === undefined ? remaining : [...remaining, { ...top, cursor }],
    });
  }

  const cursor = nextGroupCursor(state.players, top.responders, top.cursor);
  const baseStack = cursor === undefined ? remaining : [...remaining, { ...top, cursor }];
  const opened = withAction(state, responderId, [`${responder.displayName}未打出「刺击」，受到合围伤害。`], {});
  return damagePlayer({ ...opened, stack: baseStack }, responderId, 1, top.actorId);
}

export function respondToVolley(state: DingState, responderId: PlayerId, cardUid?: string): DingState {
  const top = topFrame(state.stack);
  if (state.status !== "playing" || !top || top.kind !== "volley") return state;
  if (top.responders[top.cursor] !== responderId) return state;
  const responder = getPlayer(state.players, responderId);
  const card = cardUid ? responder.hand.find((entry) => entry.id === cardUid) : undefined;
  if (cardUid && card?.type !== "evade") return state;

  const remaining = state.stack.slice(0, -1);
  if (card) {
    const players = replacePlayer(state.players, responderId, (player) => ({
      ...player,
      hand: player.hand.filter((entry) => entry.id !== cardUid),
    }));
    const cursor = nextGroupCursor(players, top.responders, top.cursor);
    return withAction(state, responderId, [`${responder.displayName}打出「闪避」躲开齐射。`], {
      players,
      discard: [...state.discard, card],
      stack: cursor === undefined ? remaining : [...remaining, { ...top, cursor }],
    });
  }

  const cursor = nextGroupCursor(state.players, top.responders, top.cursor);
  const baseStack = cursor === undefined ? remaining : [...remaining, { ...top, cursor }];
  const opened = withAction(state, responderId, [`${responder.displayName}未打出「闪避」，受到齐射伤害。`], {});
  return damagePlayer({ ...opened, stack: baseStack }, responderId, 1, top.actorId);
}

function damagePlayer(
  state: DingState,
  targetId: PlayerId,
  amount: number,
  sourceId: PlayerId,
): DingState {
  const target = getPlayer(state.players, targetId);
  const armorReduction = target.equipment.armor && target.skillFlags["armor:reduced"] !== true ? 1 : 0;
  const skillReduction = target.skillFlags["silenced"] !== true
    && target.skillFlags[buffFlag("next-damage-reduction")]
    ? 1
    : 0;
  const reduction = armorReduction + skillReduction;
  const finalAmount = Math.max(0, amount - reduction);
  const nextHp = target.hp - finalAmount;

  let players = replacePlayer(state.players, targetId, (player) => ({
    ...player,
    hp: nextHp,
    skillFlags: {
      ...player.skillFlags,
      ...(armorReduction > 0 ? { "armor:reduced": true } : {}),
      ...(skillReduction > 0 ? { [buffFlag("next-damage-reduction")]: false } : {}),
    },
  }));
  const texts: string[] = [];
  if (armorReduction > 0) texts.push(`${target.displayName}的「${target.equipment.armor!.name}」抵挡了 1 点伤害。`);
  if (skillReduction > 0) texts.push(`${target.displayName}的增益抵挡了 1 点伤害。`);
  if (finalAmount > 0) texts.push(`${target.displayName}受到 ${finalAmount} 点伤害。`);

  let next = withAction(state, sourceId, texts, { players });
  if (finalAmount > 0) {
    next = runSkillTrigger(next, "damageDealt", sourceId);
    next = runSkillTrigger(next, "damageReceived", targetId);
  }

  if (nextHp <= 0) {
    const required = 1 - nextHp;
    const responders = aliveOrderFrom(players, targetId);
    const pending: PendingDying = { kind: "dying", targetId, required, offered: 0, responders, cursor: 0, sourceId };
    next = withAction(next, "table", [`${target.displayName}进入濒死，需要 ${required} 张「疗元」。`], {
      stack: [...next.stack, pending],
    });
    next = runSkillTrigger(next, "enterDying", targetId);

    const dyingTarget = getPlayer(next.players, targetId);
    if (dyingTarget.skillFlags["silenced"] !== true && dyingTarget.skillFlags[buffFlag("dying-draw")]) {
      const draw = drawOne(next.deck, next.discard, next.rngSeed);
      if (draw.card) {
        players = replacePlayer(next.players, targetId, (player) => ({
          ...player,
          hand: [...player.hand, draw.card!],
          skillFlags: { ...player.skillFlags, [buffFlag("dying-draw")]: false },
        }));
        next = withAction(next, targetId, [`${dyingTarget.displayName}的「余烬」触发，摸 1 张牌。`], {
          players,
          deck: draw.deck,
          discard: draw.discard,
          rngSeed: draw.seed,
        });
      } else {
        players = replacePlayer(next.players, targetId, (player) => ({
          ...player,
          skillFlags: { ...player.skillFlags, [buffFlag("dying-draw")]: false },
        }));
        next = withAction(next, targetId, [`${dyingTarget.displayName}的「余烬」触发，但牌堆已空。`], { players });
      }
    }
  }
  return next;
}

type DeathReward =
  | { readonly kind: "killer-draw"; readonly count: 3 }
  | { readonly kind: "killer-discard-hand" };

/**
 * 身份奖惩表：与胜负判定分离，只根据退场者与击杀者的公开身份给出奖惩。
 * 流谋的奖励被刻意取消，以维持其“最后独活”的特殊胜利路径；
 * 主君倒下立即终局，因此也不发放装饰性的摸 3 张奖励。
 */
function deathReward(target: DingPlayer, killer: DingPlayer | undefined): DeathReward | undefined {
  if (!killer?.alive || killer.id === target.id) return undefined;
  if (target.identity === "rebel") {
    return killer.identity === "renegade" ? undefined : { kind: "killer-draw", count: 3 };
  }
  // 主君倒下立即终局，叛锋的摸 3 奖励没有后续行动可影响，不再制造终局日志之外的副作用。
  if (target.identity === "loyalist" && killer.identity === "lord") {
    return { kind: "killer-discard-hand" };
  }
  return undefined;
}

/** 死亡结算：先处理死者自己的死亡技能，再让存活角色响应 playerDied 触发点。 */
function runDeathRattle(state: DingState, ownerId: PlayerId, sourceId: PlayerId | undefined): DingState {
  const owner = getPlayer(state.players, ownerId);
  const hero = heroOf(owner);
  const spec = hero?.triggers?.death;
  if (!spec || spec.effect !== "silence-source" || !sourceId || sourceId === ownerId) return state;
  const source = getPlayer(state.players, sourceId);
  if (!source.alive || source.skillFlags["silenced"] === true) return state;
  const players = replacePlayer(state.players, sourceId, (player) => ({
    ...player,
    skillFlags: { ...player.skillFlags, silenced: true },
  }));
  return withAction(state, "table", [
    `${owner.displayName}的「${hero.skillName}」触发，${source.displayName}失去所有武将技能。`,
  ], { players });
}

function runPlayerDiedTriggers(state: DingState): DingState {
  let next = state;
  for (const player of next.players) {
    if (player.alive) next = runSkillTrigger(next, "playerDied", player.id);
  }
  return next;
}

function resolveDeath(state: DingState, targetId: PlayerId, sourceId: PlayerId | undefined, stack: readonly ResolutionFrame[]): DingState {
  const target = getPlayer(state.players, targetId);
  const equipmentCards = (["weapon", "armor", "minusHorse", "plusHorse"] as const)
    .map((slot) => target.equipment[slot])
    .filter((card): card is DingCard => Boolean(card));
  const delayedCards = (state.delayedTricks[targetId] ?? []).map((entry) => entry.card);
  const corpseCards = [...target.hand, ...equipmentCards, ...delayedCards];
  let players = replacePlayer(state.players, targetId, (player) => ({
    ...player,
    alive: false,
    revealed: true,
    hp: 0,
    hand: [],
    equipment: {},
  }));
  const texts = [`${target.displayName}退场，身份是「${IDENTITY_NAMES[target.identity]}」。`];
  if (corpseCards.length > 0) texts.push(`${target.displayName}的 ${corpseCards.length} 张手牌、装备与判定区牌进入弃牌堆。`);

  let deck = state.deck;
  let discard = [...state.discard, ...corpseCards];
  let rngSeed = state.rngSeed;
  const killer = sourceId ? players.find((player) => player.id === sourceId) : undefined;
  const reward = deathReward(target, killer);
  if (reward?.kind === "killer-draw") {
    const drawn: DingCard[] = [];
    for (let count = 0; count < reward.count; count += 1) {
      const draw = drawOne(deck, discard, rngSeed);
      deck = draw.deck;
      discard = draw.discard;
      rngSeed = draw.seed;
      if (draw.card) drawn.push(draw.card);
    }
    players = replacePlayer(players, killer!.id, (player) => ({ ...player, hand: [...player.hand, ...drawn] }));
    texts.push(`${killer!.displayName}击退叛锋，摸 ${drawn.length} 张牌。`);
  } else if (reward?.kind === "killer-discard-hand") {
    const discardedHand = killer!.hand;
    players = replacePlayer(players, killer!.id, (player) => ({ ...player, hand: [] }));
    discard = [...discard, ...discardedHand];
    texts.push(`主君误伤辅臣，弃置全部 ${discardedHand.length} 张手牌。`);
  }

  const delayedTricks = { ...state.delayedTricks, [targetId]: [] };
  const resolved = withAction(state, "table", texts, {
    players,
    deck,
    discard,
    rngSeed,
    delayedTricks,
    stack,
  });
  const deathTriggered = runDeathRattle(resolved, targetId, sourceId);
  const witnessed = runPlayerDiedTriggers(deathTriggered);
  const winner = evaluateWinner(witnessed.players);
  if (winner) {
    return withAction(witnessed, "table", [winnerText(winner)], {
      status: "finished",
      phase: "finished",
      winner,
    });
  }
  return settleTrickFrames(witnessed, witnessed.stack);
}

export function evaluateWinner(players: readonly DingPlayer[]): MatchWinner | undefined {
  const lord = players.find((player) => player.identity === "lord")!;
  const living = players.filter((player) => player.alive);
  if (!lord.alive) {
    const livingRenegades = living.filter((player) => player.identity === "renegade");
    const livingNonLord = living.filter((player) => player.id !== lord.id);
    return livingNonLord.length === 1 && livingRenegades.length === 1 ? "renegade" : "rebel";
  }
  const rebelsAlive = living.some((player) => player.identity === "rebel");
  const renegadesAlive = living.some((player) => player.identity === "renegade");
  return !rebelsAlive && !renegadesAlive ? "lord-side" : undefined;
}

function winnerText(winner: MatchWinner): string {
  const copy = {
    "lord-side": "主君与辅臣达成胜利。",
    rebel: "叛锋达成胜利。",
    renegade: "流谋独掌大鼎。",
  } as const;
  return copy[winner];
}

export function respondToStrike(state: DingState, responderId: PlayerId, cardUid?: string): DingState {
  const pending = topFrame(state.stack);
  if (state.status !== "playing" || !pending || pending.kind !== "strike" || pending.targetId !== responderId) return state;
  const responder = getPlayer(state.players, responderId);
  const card = cardUid ? responder.hand.find((entry) => entry.id === cardUid) : undefined;
  if (cardUid && card?.type !== "evade") return state;
  if (card && pending.unavoidable) return state;

  let players = state.players;
  let discard = state.discard;
  const stack = state.stack.slice(0, -1);
  const texts: string[] = [];
  if (card) {
    players = replacePlayer(players, responderId, (player) => ({
      ...player,
      hand: player.hand.filter((entry) => entry.id !== cardUid),
    }));
    discard = [...discard, card];
    texts.push(`${responder.displayName}打出「闪避」，抵消了刺击。`);
  } else {
    const target = getPlayer(state.players, pending.targetId);
    const protector = target.identity === "lord"
      ? state.players.find((player) =>
        player.identity === "loyalist"
        && player.alive
        && player.id !== pending.actorId
        && player.hand.length > 0
      )
      : undefined;
    texts.push(`${responder.displayName}选择承受这一击。`);
    if (protector) {
      const protectFrame: PendingProtect = {
        kind: "protect",
        actorId: pending.actorId,
        targetId: pending.targetId,
        protectorId: protector.id,
        cardUid: pending.cardUid,
        damage: pending.damage,
      };
      return withAction({ ...state, stack }, "table", texts, {
        stack: [...stack, protectFrame],
      });
    }
    const next = damagePlayer(
      { ...state, stack },
      pending.targetId,
      pending.damage,
      pending.actorId,
    );
    return withAction(next, responderId, texts, {});
  }

  return withAction(state, responderId, texts, { players, discard, stack });
}

export function respondToProtect(state: DingState, protectorId: PlayerId, cardUid?: string): DingState {
  const pending = topFrame(state.stack);
  if (state.status !== "playing" || !pending || pending.kind !== "protect" || pending.protectorId !== protectorId) return state;
  const protector = getPlayer(state.players, protectorId);
  if (!protector.alive) return state;
  const card = cardUid ? protector.hand.find((entry) => entry.id === cardUid) : undefined;
  if (cardUid && !card) return state;

  const remaining = state.stack.slice(0, -1);
  const lord = getPlayer(state.players, pending.targetId);
  if (!card) {
    const next = damagePlayer(
      { ...state, stack: remaining },
      pending.targetId,
      pending.damage,
      pending.actorId,
    );
    return withAction(next, "table", [`无人护主，${lord.displayName}承受这一击。`], {});
  }

  const players = replacePlayer(state.players, protectorId, (player) => ({
    ...player,
    revealed: true,
    hand: player.hand.filter((entry) => entry.id !== card.id),
  }));
  const discard = [...state.discard, card];
  const finalDamage = Math.max(0, pending.damage - 1);
  const protectedState = withAction(
    { ...state, stack: remaining, players, discard },
    protectorId,
    [`${protector.displayName}弃置「${card.name}」护主，为主君抵挡 1 点伤害。`],
    { players, discard },
  );
  if (finalDamage === 0) {
    return withAction(protectedState, "table", [`${lord.displayName}未受到伤害。`], {});
  }
  return damagePlayer(protectedState, pending.targetId, finalDamage, pending.actorId);
}

export function respondToDying(state: DingState, responderId: PlayerId, cardUid?: string): DingState {
  const pending = topFrame(state.stack);
  if (state.status !== "playing" || !pending || pending.kind !== "dying") return state;
  const expectedResponder = pending.responders[pending.cursor];
  if (responderId !== expectedResponder) return state;

  const responder = getPlayer(state.players, responderId);
  const card = cardUid ? responder.hand.find((entry) => entry.id === cardUid) : undefined;
  if (cardUid && card?.type !== "salve") return state;

  let players = state.players;
  let discard = state.discard;
  let hp = getPlayer(players, pending.targetId).hp;
  let offered = pending.offered;
  const texts: string[] = [];
  if (card) {
    players = replacePlayer(players, responderId, (player) => ({
      ...player,
      hand: player.hand.filter((entry) => entry.id !== cardUid),
    }));
    discard = [...discard, card];
    hp += 1;
    offered += 1;
    players = replacePlayer(players, pending.targetId, (player) => ({ ...player, hp }));
    texts.push(`${responder.displayName}用「疗元」援救${getPlayer(players, pending.targetId).displayName}。`);
  } else {
    texts.push(`${responder.displayName}没有出手。`);
  }

  if (hp >= 1) {
    return withAction(state, "table", [...texts, `${getPlayer(players, pending.targetId).displayName}脱离濒死。`], {
      players,
      discard,
      stack: state.stack.slice(0, -1),
    });
  }

  const cursor = (pending.cursor + 1) % pending.responders.length;
  if (cursor === 0) {
    const death = resolveDeath(
      { ...state, players, discard, stack: state.stack.slice(0, -1) },
      pending.targetId,
      pending.sourceId,
      state.stack.slice(0, -1),
    );
    return withAction(death, "table", texts, {});
  }

  return withAction(state, responderId, texts, {
    players,
    discard,
    stack: [...state.stack.slice(0, -1), { ...pending, offered, cursor }],
  });
}

export function requiredDiscards(state: DingState, actorId: PlayerId): number {
  const actor = getPlayer(state.players, actorId);
  if (state.phase !== "discard" || state.activePlayerId !== actorId) return 0;
  return Math.max(0, actor.hand.length - actor.hp);
}

export function discardCards(state: DingState, actorId: PlayerId, cardUids: readonly string[]): DingState {
  if (state.status !== "playing" || state.phase !== "discard" || state.activePlayerId !== actorId || state.stack.length > 0) return state;
  const actor = getPlayer(state.players, actorId);
  if (!actor.alive) return settleEnd(state);
  const required = requiredDiscards(state, actorId);
  if (cardUids.length !== required) return state;
  const unique = new Set(cardUids);
  if (unique.size !== cardUids.length || cardUids.some((id) => !actor.hand.some((card) => card.id === id))) return state;
  const discarded = actor.hand.filter((card) => unique.has(card.id));
  const players = replacePlayer(state.players, actorId, (player) => ({
    ...player,
    hand: player.hand.filter((card) => !unique.has(card.id)),
  }));
  const next = withAction(state, actorId, [`${actor.displayName}弃置 ${discarded.length} 张手牌。`], {
    players,
    discard: [...state.discard, ...discarded],
  });
  return settleEnd(next);
}

export function endTurn(state: DingState, actorId: PlayerId): DingState {
  if (state.status !== "playing" || state.phase !== "play" || state.stack.length > 0 || state.activePlayerId !== actorId) return state;
  const actor = getPlayer(state.players, actorId);
  if (!actor.alive) return settleEnd(state);
  const next = withAction(state, actorId, [`${actor.displayName}结束出牌阶段。`], {});
  if (actor.hand.length > actor.hp) return { ...next, phase: "discard" };
  return settleEnd(next);
}

function roundOfTurn(turnNumber: number): number {
  return Math.ceil(turnNumber / 4);
}

function applyGlobalOverheat(players: readonly DingPlayer[], roundNumber: number): { players: DingPlayer[]; texts: string[] } {
  const amount = roundNumber - OVERHEAT_START_ROUND + 1;
  if (amount <= 0) return { players: [...players], texts: [] };
  let next = [...players];
  const texts: string[] = [];
  for (const player of [...next]) {
    if (!player.alive || player.hp <= 1) continue;
    const applied = Math.min(amount, player.hp - 1);
    if (applied <= 0) continue;
    next = replacePlayer(next, player.id, (entry) => ({ ...entry, hp: entry.hp - applied }));
    texts.push(`${player.displayName}受牌局过载影响，受到 ${applied} 点真实伤害。`);
  }
  return { players: next, texts };
}

function settleEnd(state: DingState): DingState {
  if (state.status !== "playing") return state;
  const actor = getPlayer(state.players, state.activePlayerId);
  const triggered = runSkillTrigger(state, "turnEnd", actor.id);
  let players = resetSkillFlags(triggered.players);
  const texts = [`${actor.displayName}的回合结束。`];
  if (state.phase === "discard") texts.unshift(`${actor.displayName}完成弃牌。`);

  const currentRound = roundOfTurn(state.turnNumber);
  const nextTurn = state.turnNumber + 1;
  const nextRound = roundOfTurn(nextTurn);
  if (nextRound > currentRound && nextRound >= OVERHEAT_START_ROUND) {
    const overheat = applyGlobalOverheat(players, nextRound);
    players = overheat.players;
    texts.push(...overheat.texts);
  }

  const nextId = nextAliveId(players, actor.id);
  return withAction(triggered, "table", texts, {
    phase: "prepare",
    activePlayerId: nextId,
    turnNumber: nextTurn,
    strikeUsed: false,
    players,
  });
}

export function respondToDelayed(state: DingState, judgeId: PlayerId): DingState {
  const pending = topFrame(state.stack);
  if (state.status !== "playing" || !pending || pending.kind !== "delayed" || pending.ownerId !== judgeId) return state;
  const owner = getPlayer(state.players, judgeId);
  const instance = state.delayedTricks[judgeId]?.find((entry) => entry.card.id === pending.cardUid);
  if (!instance) return state;

  let deck = state.deck;
  let discard = state.discard;
  let rngSeed = state.rngSeed;
  const judged = drawOne(deck, discard, rngSeed);
  deck = judged.deck;
  discard = [...judged.discard, ...(judged.card ? [judged.card] : [])];
  rngSeed = judged.seed;

  const delayedTricks = {
    ...state.delayedTricks,
    [judgeId]: (state.delayedTricks[judgeId] ?? []).filter((entry) => entry.card.id !== instance.card.id),
  };
  discard = [...discard, instance.card];
  const remaining = state.stack.slice(0, -1);
  const texts = judged.card
    ? [`${owner.displayName}判定「${instance.card.name}」，翻开「${judged.card.name}」。`]
    : [`${owner.displayName}判定「${instance.card.name}」，但牌堆已无牌可翻。`];
  let next = withAction(state, "table", texts, {
    deck,
    discard,
    rngSeed,
    delayedTricks,
    stack: remaining,
  });
  if (!judged.card) return next;

  let players = next.players;
  if (instance.card.type === "delay-play" && judged.card.type !== "strike") {
    players = replacePlayer(players, judgeId, (player) => ({
      ...player,
      skillFlags: { ...player.skillFlags, "delay:skip-play": true },
    }));
    next = withAction(next, "table", [`${owner.displayName}受「断锋」影响，跳过出牌阶段。`], { players });
  } else if (instance.card.type === "delay-draw" && judged.card.kind !== "trick") {
    players = replacePlayer(players, judgeId, (player) => ({
      ...player,
      skillFlags: { ...player.skillFlags, "delay:skip-draw": true },
    }));
    next = withAction(next, "table", [`${owner.displayName}受「困阵」影响，跳过摸牌阶段。`], { players });
  } else if (instance.card.type === "delay-burn" && judged.card.kind === "trick") {
    next = damagePlayer(next, judgeId, 1, instance.sourceActorId);
  } else {
    next = withAction(next, "table", [`${instance.card.name}未生效。`], {});
  }
  return next;
}

export function changeDifficulty(state: DingState, difficulty: DingDifficulty): DingState {
  if (state.difficulty === difficulty) return state;
  return withAction(state, "table", [`对手难度调整为「${DING_DIFFICULTY_NAMES[difficulty]}」。`], {
    difficulty,
  });
}

export function advancePhase(state: DingState): DingState {
  if (state.status !== "playing" || state.stack.length > 0) return state;
  const actor = getPlayer(state.players, state.activePlayerId);
  // 行动者在阶段推进前可能已经退场（例如焚营在判定阶段致死）：
  // 立即结束这个“死人回合”，把行动权交给下一名存活角色。
  if (!actor.alive) return settleEnd(state);

  if (state.phase === "prepare") {
    const triggered = runSkillTrigger(state, "turnStart", actor.id);
    // 跨回合持续到自己行动开始的标记，在回合开始时到期。
    const players = clearTurnStartFlags(triggered.players, actor.id);
    return withAction(triggered, "table", [`${actor.displayName}进入回合。`], { phase: "judge", players });
  }
  if (state.phase === "judge") {
    const instance = state.delayedTricks[actor.id]?.[0];
    if (!instance) {
      return withAction(state, "table", [`${actor.displayName}无需判定，进入摸牌阶段。`], { phase: "draw" });
    }
    const pending: PendingDelayed = {
      kind: "delayed",
      ownerId: actor.id,
      cardUid: instance.card.id,
      sourceActorId: instance.sourceActorId,
    };
    return withAction(state, "table", [`${actor.displayName}准备判定「${instance.card.name}」。`], {
      stack: [...state.stack, pending],
    });
  }
  if (state.phase === "draw") {
    const skipDraw = actor.skillFlags["delay:skip-draw"] === true;
    let deck = state.deck;
    let discard = state.discard;
    let rngSeed = state.rngSeed;
    let players = state.players;
    const drawn: DingCard[] = [];
    const texts: string[] = [];

    if (skipDraw) {
      players = replacePlayer(players, actor.id, (player) => ({
        ...player,
        skillFlags: { ...player.skillFlags, "delay:skip-draw": false },
      }));
      texts.push(`${actor.displayName}跳过摸牌阶段。`);
    } else {
      for (let count = 0; count < DRAW_PER_TURN; count += 1) {
        const draw = drawOne(deck, discard, rngSeed);
        deck = draw.deck;
        discard = draw.discard;
        rngSeed = draw.seed;
        if (draw.card) drawn.push(draw.card);
      }
      players = replacePlayer(players, actor.id, (player) => ({
        ...player,
        hand: [...player.hand, ...drawn],
      }));
      texts.push(`${actor.displayName}摸 ${drawn.length} 张牌。`);
    }

    if (players.find((player) => player.id === actor.id)?.skillFlags["delay:skip-play"] === true) {
      players = replacePlayer(players, actor.id, (player) => ({
        ...player,
        skillFlags: { ...player.skillFlags, "delay:skip-play": false },
      }));
      texts.push(`${actor.displayName}跳过出牌阶段。`);
      return withAction(state, "table", texts, {
        players,
        deck,
        discard,
        rngSeed,
        phase: "discard",
      });
    }

    return withAction(state, "table", texts, {
      players,
      deck,
      discard,
      rngSeed,
      phase: "play",
    });
  }
  if (state.phase === "play") return endTurn(state, actor.id);
  if (state.phase === "discard" && requiredDiscards(state, actor.id) === 0) {
    return settleEnd(withAction(state, actor.id, [`${actor.displayName}无需弃牌。`], {}));
  }
  return state;
}
