import { CARD_CATALOG, IDENTITY_NAMES, SEAT_ORDER, buildDeck } from "./data";
import type {
  DingCard,
  DingLogEntry,
  DingPlayer,
  DingState,
  EquipmentSlot,
  IdentityId,
  LastDingAction,
  MatchWinner,
  PendingDying,
  PendingTrick,
  PlayerId,
  ResolutionFrame,
  TrickCardType,
} from "./types";

export const DRAW_PER_TURN = 2;
export const STARTING_HAND = 4;
export const LORD_BONUS_HP = 1;
export const BASE_MAX_HP = 4;

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
  return Math.max(1, raw + plusHorse - minusHorse);
}

export function attackRange(player: DingPlayer): number {
  return player.equipment.weapon?.range ?? 1;
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

export function createInitialState(random: () => number = Math.random): DingState {
  const deck = shuffled(buildDeck(), random);
  let rngSeed = Math.floor(random() * 2_147_483_647) || 1;
  const identities = shuffled(IDENTITIES, random);
  const players: DingPlayer[] = SEAT_ORDER.map((id, seat) => {
    const identity = identities[seat];
    return {
      id,
      displayName: id === "south" ? "你" : id === "east" ? "东座" : id === "north" ? "北座" : "西座",
      controller: id === "south" ? "human" : "ai",
      seat,
      identity,
      revealed: identity === "lord",
      hp: identity === "lord" ? BASE_MAX_HP + LORD_BONUS_HP : BASE_MAX_HP,
      maxHp: identity === "lord" ? BASE_MAX_HP + LORD_BONUS_HP : BASE_MAX_HP,
      alive: true,
      hand: [],
      equipment: {},
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
    turnNumber: 1,
    activePlayerId: lord.id,
    players: dealt,
    deck: nextDeck,
    discard: nextDiscard,
    strikeUsed: false,
    stack: [],
    log: [{ id: 0, text: `四席就位。${lord.displayName}是主君，率先行动。` }],
    rngSeed,
  };
}

export function getPlayableCards(state: DingState, actorId: PlayerId): DingCard[] {
  const actor = getPlayer(state.players, actorId);
  if (state.status !== "playing" || state.phase !== "play" || state.stack.length > 0 || state.activePlayerId !== actorId) return [];
  return actor.hand.filter((card) => getTargetOptions(state, actorId, card).length > 0);
}

export function getTargetOptions(state: DingState, actorId: PlayerId, card: DingCard): readonly PlayerId[] {
  const actor = getPlayer(state.players, actorId);
  if (state.status !== "playing" || state.phase !== "play" || state.stack.length > 0 || state.activePlayerId !== actorId) return [];
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
      return state.players.filter((candidate) => candidate.id !== actor.id && candidate.alive && candidate.hand.length > 0).map((candidate) => candidate.id);
    case "snatch":
      return state.players
        .filter((candidate) => candidate.id !== actor.id && candidate.alive && candidate.hand.length > 0 && distanceBetween(state.players, actor.id, candidate.id) === 1)
        .map((candidate) => candidate.id);
    case "weapon": {
      const current = actor.equipment.weapon;
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

function takeRandomHandCard(hand: readonly DingCard[], seed: number): { card?: DingCard; hand: DingCard[]; seed: number } {
  if (hand.length === 0) return { hand: [...hand], seed };
  const random = nextRandom(seed);
  const index = Math.floor(random.sample * hand.length);
  return { card: hand[index], hand: hand.filter((_, entryIndex) => entryIndex !== index), seed: random.seed };
}

function equipCard(player: DingPlayer, card: DingCard): { player: DingPlayer; discarded: DingCard[] } {
  const slot: EquipmentSlot | undefined = card.type === "weapon"
    ? "weapon"
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
  const card = actor.hand.find((entry) => entry.id === cardUid);
  if (!card) return state;
  if (!getTargetOptions(state, actorId, card).includes(targetId ?? (card.type === "focus" || card.type === "salve" || card.type === "weapon" || card.type === "minus-horse" || card.type === "plus-horse" ? actor.id : "" as PlayerId))) return state;

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

  switch (card.type) {
    case "strike": {
      if (!targetId) return state;
      const target = getPlayer(players, targetId);
      stack = [{ kind: "strike", actorId, targetId, cardUid, damage: 1 }];
      strikeUsed = true;
      discard = [...discard, card];
      texts.push(`${target.displayName}可以打出「闪避」响应。`);
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
    case "snatch": {
      discard = [...discard, card];
      const effectTarget = card.type === "focus" ? undefined : targetId;
      if (card.type !== "focus" && !effectTarget) return state;
      stack = [createTrickFrame(state.revision + 1, actorId, cardUid, card.type, effectTarget, players)];
      texts.push(
        card.type === "focus"
          ? `${actor.displayName}使用「聚势」，等待无懈可击响应。`
          : `${actor.displayName}对${getPlayer(players, effectTarget!).displayName}使用「${card.name}」，等待无懈可击响应。`,
      );
      break;
    }
    case "weapon":
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
  draft: { players: DingPlayer[]; deck: DingCard[]; discard: DingCard[]; rngSeed: number; stack: ResolutionFrame[]; texts: string[] },
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
    if (target.alive && target.hand.length > 0) {
      const taken = takeRandomHandCard(target.hand, draft.rngSeed);
      draft.rngSeed = taken.seed;
      if (taken.card) {
        draft.players = replacePlayer(draft.players, target.id, (player) => ({ ...player, hand: taken.hand }));
        draft.discard = [...draft.discard, taken.card];
        draft.texts.push(`${actor.displayName}的「${cardName}」生效，${target.displayName}弃置「${taken.card.name}」。`);
      }
    } else {
      draft.texts.push(`${actor.displayName}的「${cardName}」生效，但${target.displayName}没有手牌可拆。`);
    }
    return;
  }

  if (frame.cardType === "snatch" && frame.targetId) {
    const target = getPlayer(draft.players, frame.targetId);
    if (target.alive && target.hand.length > 0) {
      const taken = takeRandomHandCard(target.hand, draft.rngSeed);
      draft.rngSeed = taken.seed;
      if (taken.card) {
        draft.players = replacePlayer(draft.players, target.id, (player) => ({ ...player, hand: taken.hand }));
        draft.players = replacePlayer(draft.players, actor.id, (player) => ({ ...player, hand: [...player.hand, taken.card!] }));
        draft.texts.push(`${actor.displayName}的「${cardName}」生效，获得${target.displayName}的「${taken.card.name}」。`);
      }
    } else {
      draft.texts.push(`${actor.displayName}的「${cardName}」生效，但${target.displayName}没有手牌可取。`);
    }
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
    rngSeed: state.rngSeed,
    stack: [...stack],
    texts: [...texts],
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
    applyTrickEffect(draft, top);
  }
  if (!settled && draft.texts.length === 0) return state;
  return withAction(state, "table", draft.texts, {
    players: draft.players,
    deck: draft.deck,
    discard: draft.discard,
    rngSeed: draft.rngSeed,
    stack: draft.stack,
  });
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

function damagePlayer(
  state: DingState,
  targetId: PlayerId,
  amount: number,
  sourceId: PlayerId,
): DingState {
  const target = getPlayer(state.players, targetId);
  const nextHp = target.hp - amount;
  const players = replacePlayer(state.players, targetId, (player) => ({ ...player, hp: nextHp }));
  let next: DingState = withAction(state, sourceId, [`${target.displayName}受到 ${amount} 点伤害。`], { players });

  if (nextHp <= 0) {
    const required = 1 - nextHp;
    const responders = aliveOrderFrom(players, targetId);
    const pending: PendingDying = { kind: "dying", targetId, required, offered: 0, responders, cursor: 0, sourceId };
    next = withAction(next, "table", [`${target.displayName}进入濒死，需要 ${required} 张「疗元」。`], {
      stack: [...next.stack, pending],
    });
  }
  return next;
}

function resolveDeath(state: DingState, targetId: PlayerId, sourceId: PlayerId | undefined, stack: readonly ResolutionFrame[]): DingState {
  const target = getPlayer(state.players, targetId);
  const equipmentCards = (["weapon", "minusHorse", "plusHorse"] as const)
    .map((slot) => target.equipment[slot])
    .filter((card): card is DingCard => Boolean(card));
  const corpseCards = [...target.hand, ...equipmentCards];
  let players = replacePlayer(state.players, targetId, (player) => ({
    ...player,
    alive: false,
    revealed: true,
    hp: 0,
    hand: [],
    equipment: {},
  }));
  const texts = [`${target.displayName}退场，身份是「${IDENTITY_NAMES[target.identity]}」。`];
  if (corpseCards.length > 0) texts.push(`${target.displayName}的 ${corpseCards.length} 张手牌与装备进入弃牌堆。`);

  let deck = state.deck;
  let discard = [...state.discard, ...corpseCards];
  let rngSeed = state.rngSeed;
  const killer = sourceId ? players.find((player) => player.id === sourceId) : undefined;
  if (killer?.alive && target.identity === "rebel") {
    const drawn: DingCard[] = [];
    for (let count = 0; count < 3; count += 1) {
      const draw = drawOne(deck, discard, rngSeed);
      deck = draw.deck;
      discard = draw.discard;
      rngSeed = draw.seed;
      if (draw.card) drawn.push(draw.card);
    }
    players = replacePlayer(players, killer.id, (player) => ({ ...player, hand: [...player.hand, ...drawn] }));
    texts.push(`${killer.displayName}击退叛锋，摸 ${drawn.length} 张牌。`);
  }
  if (killer?.alive && killer.identity === "lord" && target.identity === "loyalist") {
    const discardedHand = killer.hand;
    players = replacePlayer(players, killer.id, (player) => ({ ...player, hand: [] }));
    discard = [...discard, ...discardedHand];
    texts.push(`主君误伤辅臣，弃置全部 ${discardedHand.length} 张手牌。`);
  }

  const winner = evaluateWinner(players);
  if (winner) {
    texts.push(winnerText(winner));
    return withAction(state, "table", texts, {
      players,
      deck,
      discard,
      rngSeed,
      stack,
      status: "finished",
      phase: "finished",
      winner,
    });
  }

  const resolved = withAction(state, "table", texts, {
    players,
    deck,
    discard,
    rngSeed,
    stack,
  });
  return settleTrickFrames(resolved, resolved.stack);
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
    const next = damagePlayer(
      { ...state, stack },
      pending.targetId,
      pending.damage,
      pending.actorId,
    );
    texts.push(`${responder.displayName}选择承受这一击。`);
    return withAction(next, responderId, texts, {});
  }

  return withAction(state, responderId, texts, { players, discard, stack });
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
  const required = requiredDiscards(state, actorId);
  if (cardUids.length !== required) return state;
  const actor = getPlayer(state.players, actorId);
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
  const next = withAction(state, actorId, [`${actor.displayName}结束出牌阶段。`], {});
  if (actor.hand.length > actor.hp) return { ...next, phase: "discard" };
  return settleEnd(next);
}

function settleEnd(state: DingState): DingState {
  if (state.status !== "playing") return state;
  const actor = getPlayer(state.players, state.activePlayerId);
  const nextId = nextAliveId(state.players, actor.id);
  const texts = [`${actor.displayName}的回合结束。`];
  if (state.phase === "discard") texts.unshift(`${actor.displayName}完成弃牌。`);
  return withAction(state, "table", texts, {
    phase: "prepare",
    activePlayerId: nextId,
    turnNumber: state.turnNumber + 1,
    strikeUsed: false,
  });
}

export function advancePhase(state: DingState): DingState {
  if (state.status !== "playing" || state.stack.length > 0) return state;
  const actor = getPlayer(state.players, state.activePlayerId);

  if (state.phase === "prepare") {
    return withAction(state, "table", [`${actor.displayName}进入回合。`], { phase: "draw" });
  }
  if (state.phase === "draw") {
    let deck = state.deck;
    let discard = state.discard;
    let rngSeed = state.rngSeed;
    const drawn: DingCard[] = [];
    for (let count = 0; count < DRAW_PER_TURN; count += 1) {
      const draw = drawOne(deck, discard, rngSeed);
      deck = draw.deck;
      discard = draw.discard;
      rngSeed = draw.seed;
      if (draw.card) drawn.push(draw.card);
    }
    const players = replacePlayer(state.players, actor.id, (player) => ({
      ...player,
      hand: [...player.hand, ...drawn],
    }));
    return withAction(state, "table", [`${actor.displayName}摸 ${drawn.length} 张牌。`], {
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
