import { CARD_CATALOG, COMBATANT_SEEDS, STATUS_CATALOG, TEAM_NAMES, buildDeck } from "./data";
import type {
  AiMove,
  BattleCard,
  BattleLogEntry,
  CardEffect,
  CardInstance,
  Combatant,
  CombatantMetrics,
  Difficulty,
  EmberPactState,
  MatchWinner,
  ResolvedEvent,
  StatusId,
  StatusInstance,
} from "./types";

export const HAND_LIMIT = 7;
export const ACTIONS_PER_TURN = 2;
export const DRAW_PER_TURN = 2;
export const BLOCK_LIMIT = 6;
export const OVERHEAT_START_ROUND = 18;
export const INITIATIVE_ORDER = ["player", "scar", "luna", "ember"] as const;
export const DEFAULT_HUMAN_ID = "player";

interface DrawResult {
  readonly combatant: Combatant;
  readonly overflow?: CardInstance;
  readonly seed: number;
}

interface TurnSettlement {
  readonly activePlayerId: string;
  readonly actionsRemaining: number;
  readonly attackUsed: boolean;
  readonly phase: "action";
  readonly pendingAttack: undefined;
  readonly turnNumber: number;
  readonly roundNumber: number;
  readonly combatants: readonly Combatant[];
  readonly rngSeed: number;
  readonly winner?: MatchWinner;
}

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

function reshuffle<T>(items: readonly T[], seed: number): { items: T[]; seed: number } {
  const result = [...items];
  let current = seed;
  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = nextRandom(current);
    current = random.seed;
    const swapIndex = Math.floor(random.sample * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return { items: result, seed: current };
}

function replaceCombatant(
  combatants: readonly Combatant[],
  id: string,
  update: (combatant: Combatant) => Combatant,
): Combatant[] {
  return combatants.map((combatant) => combatant.id === id ? update(combatant) : combatant);
}

function drawOne(combatant: Combatant, seed: number): DrawResult {
  let deck = [...combatant.deck];
  let discard = [...combatant.discard];
  let nextSeed = seed;

  if (deck.length === 0 && discard.length > 0) {
    const recycled = reshuffle(discard, seed);
    deck = recycled.items;
    nextSeed = recycled.seed;
    discard = [];
  }

  const card = deck.at(-1);
  if (!card) return { combatant: { ...combatant, deck, discard }, seed: nextSeed };

  if (combatant.hand.length >= HAND_LIMIT) {
    return {
      combatant: { ...combatant, deck: deck.slice(0, -1), discard: [...discard, card] },
      overflow: card,
      seed: nextSeed,
    };
  }

  return {
    combatant: {
      ...combatant,
      deck: deck.slice(0, -1),
      discard,
      hand: [...combatant.hand, card],
    },
    seed: nextSeed,
  };
}

function drawCards(
  combatant: Combatant,
  count: number,
  seed: number,
): { combatant: Combatant; overflow: readonly CardInstance[]; seed: number } {
  let current = combatant;
  let currentSeed = seed;
  const overflow: CardInstance[] = [];
  for (let drawn = 0; drawn < count; drawn += 1) {
    const result = drawOne(current, currentSeed);
    current = result.combatant;
    currentSeed = result.seed;
    if (result.overflow) overflow.push(result.overflow);
  }
  return { combatant: current, overflow, seed: currentSeed };
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

export function selectableCombatantIds(): readonly string[] {
  return COMBATANT_SEEDS.map((seed) => seed.id);
}

export function createInitialState(
  random: () => number = Math.random,
  humanId: string = DEFAULT_HUMAN_ID,
  difficulty: Difficulty = "standard",
): EmberPactState {
  let rngSeed = Math.floor(random() * 2_147_483_647) || 1;
  const controlled = COMBATANT_SEEDS.some((seed) => seed.id === humanId) ? humanId : DEFAULT_HUMAN_ID;
  const combatants: Combatant[] = [];

  for (const seed of COMBATANT_SEEDS) {
    const dealt = drawCards({
      ...seed,
      controller: seed.id === controlled ? "human" : "ai",
      hp: seed.maxHp,
      reviveAvailable: true,
      block: 0,
      statuses: [],
      hand: [],
      deck: shuffled(buildDeck(seed.id), random),
      discard: [],
    }, 4, rngSeed);
    combatants.push(dealt.combatant);
    rngSeed = dealt.seed;
  }

  return {
    revision: 0,
    turnNumber: 1,
    roundNumber: 1,
    activePlayerId: INITIATIVE_ORDER[0],
    actionsRemaining: ACTIONS_PER_TURN,
    attackUsed: false,
    phase: "action",
    difficulty,
    combatants,
    metrics: Object.fromEntries(combatants.map((combatant) => [combatant.id, emptyMetrics()])),
    status: "playing",
    log: [{ id: 0, text: "四席就位。守炉庭先行。" }],
    rngSeed,
  };
}

export function getCombatant(state: EmberPactState, id: string): Combatant | undefined {
  return state.combatants.find((combatant) => combatant.id === id);
}

export function getCard(card: CardInstance): BattleCard {
  return CARD_CATALOG[card.definitionId];
}

export function hasStatus(combatant: Combatant, statusId: StatusId): boolean {
  return combatant.statuses.some((status) => status.id === statusId);
}

export function getInitiativeOrder(): readonly string[] {
  return INITIATIVE_ORDER;
}

function isCardPlayable(state: EmberPactState, actor: Combatant, card: BattleCard): boolean {
  return state.status === "playing"
    && state.phase === "action"
    && state.activePlayerId === actor.id
    && actor.hp > 0
    && card.cost <= state.actionsRemaining
    && !(card.kind === "attack" && state.attackUsed);
}

export function getValidTargetIds(
  state: EmberPactState,
  actorId: string,
  cardUid: string,
): readonly string[] {
  const actor = getCombatant(state, actorId);
  const instance = actor?.hand.find((candidate) => candidate.uid === cardUid);
  if (!actor || !instance) return [];
  const card = getCard(instance);
  if (!card || !isCardPlayable(state, actor, card)) return [];
  if (card.target === "self") return [actor.id];

  return state.combatants
    .filter((candidate) => {
      if (card.target === "enemy") return candidate.team !== actor.team && candidate.hp > 0;
      if (candidate.team !== actor.team) return false;
      return candidate.hp > 0 || Boolean(card.canTargetDefeatedAllies && candidate.reviveAvailable);
    })
    .map((candidate) => candidate.id);
}

export function enumerateLegalMoves(state: EmberPactState, actorId: string): readonly AiMove[] {
  const actor = getCombatant(state, actorId);
  if (!actor || state.phase !== "action") return [];
  return actor.hand.flatMap((card) =>
    getValidTargetIds(state, actorId, card.uid).map((targetId) => ({ kind: "card" as const, cardUid: card.uid, targetId })),
  );
}

export function getResponseCards(state: EmberPactState, responderId: string): readonly CardInstance[] {
  if (state.status !== "playing" || state.phase !== "response" || state.pendingAttack?.targetId !== responderId) return [];
  const responder = getCombatant(state, responderId);
  if (!responder || responder.hp <= 0) return [];
  return responder.hand.filter((instance) => (getCard(instance)?.responsePower ?? 0) > 0);
}

function removeStatus(statuses: readonly StatusInstance[], id: StatusId): StatusInstance[] {
  return statuses.filter((status) => status.id !== id);
}

function isCrossSeatCombo(combatants: readonly Combatant[], actorId: string, sourceActorId?: string): boolean {
  if (!sourceActorId || sourceActorId === actorId) return false;
  const actor = combatants.find((combatant) => combatant.id === actorId);
  const source = combatants.find((combatant) => combatant.id === sourceActorId);
  return Boolean(actor && source && actor.team === source.team);
}

function putStatus(
  combatants: readonly Combatant[],
  targetId: string,
  statusId: StatusId,
  duration: number | undefined,
  source: ResolvedEvent["source"],
  sourceActorId: string,
  events: ResolvedEvent[],
): Combatant[] {
  const target = combatants.find((combatant) => combatant.id === targetId);
  if (!target || target.hp <= 0) return [...combatants];
  const existing = target.statuses.find((status) => status.id === statusId);
  const nextStatus: StatusInstance = {
    id: statusId,
    ...(duration === undefined ? {} : { remainingTurns: duration }),
    sourceActorId,
  };

  if (existing
    && existing.remainingTurns === nextStatus.remainingTurns
    && existing.sourceActorId === nextStatus.sourceActorId) return [...combatants];

  events.push({
    kind: "status-applied",
    targetId,
    actorId: sourceActorId,
    source,
    statusId,
    combo: isCrossSeatCombo(combatants, targetId, sourceActorId) && !STATUS_CATALOG[statusId].harmful,
    text: `${target.displayName}${existing ? "刷新" : "获得"}「${STATUS_CATALOG[statusId].name}」。`,
  });

  return replaceCombatant(combatants, targetId, (combatant) => ({
    ...combatant,
    statuses: existing
      ? combatant.statuses.map((status) => status.id === statusId ? nextStatus : status)
      : [...combatant.statuses, nextStatus],
  }));
}

function consumeStatus(
  combatants: readonly Combatant[],
  targetId: string,
  statusId: StatusId,
  events: ResolvedEvent[],
): Combatant[] {
  const target = combatants.find((combatant) => combatant.id === targetId);
  if (!target || !hasStatus(target, statusId)) return [...combatants];
  events.push({
    kind: "status-removed",
    targetId,
    source: "status",
    statusId,
    text: `${target.displayName}消耗了「${STATUS_CATALOG[statusId].name}」。`,
  });
  return replaceCombatant(combatants, targetId, (combatant) => ({
    ...combatant,
    statuses: removeStatus(combatant.statuses, statusId),
  }));
}

function pushDefeatIfNeeded(
  before: Combatant,
  after: Combatant,
  actorId: string | undefined,
  source: "card" | "status" | "system",
  events: ResolvedEvent[],
) {
  if (before.hp <= 0 || after.hp > 0) return;
  events.push({
    kind: "defeated",
    targetId: after.id,
    actorId,
    source,
    text: `${after.displayName}退出了战场。`,
  });
}

function resolveDirectDamage(
  combatants: readonly Combatant[],
  actorId: string,
  targetId: string,
  baseAmount: number,
  responseReduction: number,
  events: ResolvedEvent[],
): Combatant[] {
  let next = [...combatants];
  let actor = next.find((combatant) => combatant.id === actorId);
  let target = next.find((combatant) => combatant.id === targetId);
  if (!actor || !target || target.hp <= 0) return next;

  let amount = baseAmount;
  let combo = false;
  const tempered = actor.statuses.find((status) => status.id === "tempered");
  if (tempered) {
    amount += 2;
    combo ||= isCrossSeatCombo(next, actorId, tempered.sourceActorId);
    next = consumeStatus(next, actorId, "tempered", events);
    actor = next.find((combatant) => combatant.id === actorId)!;
  }
  if (actor.passiveId === "siegebreaker" && target.block > 0) amount += 1;
  const burning = target.statuses.find((status) => status.id === "burning");
  if (actor.passiveId === "firehunt" && burning) {
    amount += 2;
    combo ||= isCrossSeatCombo(next, actorId, burning.sourceActorId);
  }
  const exposed = target.statuses.find((status) => status.id === "exposed");
  if (exposed) {
    amount += 2;
    combo ||= isCrossSeatCombo(next, actorId, exposed.sourceActorId);
    next = consumeStatus(next, targetId, "exposed", events);
    target = next.find((combatant) => combatant.id === targetId)!;
  }

  const prevented = Math.min(responseReduction, amount);
  const afterResponse = amount - prevented;
  const absorbed = Math.min(target.block, afterResponse);
  const hpDamage = afterResponse - absorbed;
  const after: Combatant = {
    ...target,
    block: target.block - absorbed,
    hp: Math.max(0, target.hp - hpDamage),
  };
  next = replaceCombatant(next, targetId, () => after);
  events.push({
    kind: "damage",
    targetId,
    actorId,
    source: "card",
    amount: hpDamage,
    absorbed,
    prevented,
    combo,
    text: `${target.displayName}受到 ${hpDamage} 点伤害${prevented > 0 ? `，卸力化解 ${prevented} 点` : ""}${absorbed > 0 ? `，护盾吸收 ${absorbed} 点` : ""}${combo ? " · 联携" : ""}。`,
  });
  pushDefeatIfNeeded(target, after, actorId, "card", events);
  return next;
}

function resolveTrueDamage(
  combatants: readonly Combatant[],
  targetId: string,
  amount: number,
  source: "status" | "system",
  actorId: string | undefined,
  events: ResolvedEvent[],
  canDefeat = true,
): Combatant[] {
  const target = combatants.find((combatant) => combatant.id === targetId);
  if (!target || target.hp <= 0) return [...combatants];
  const applied = Math.min(amount, canDefeat ? target.hp : Math.max(0, target.hp - 1));
  if (applied <= 0) return [...combatants];
  const after = { ...target, hp: target.hp - applied };
  const label = source === "system" ? "源炉过载" : "灼烧";
  const next = replaceCombatant(combatants, targetId, () => after);
  events.push({
    kind: source === "system" ? "overheat" : "damage",
    targetId,
    actorId,
    source,
    amount: applied,
    combo: source === "status" && isCrossSeatCombo(combatants, targetId, actorId),
    text: `${target.displayName}因${label}受到 ${applied} 点真实伤害。`,
  });
  pushDefeatIfNeeded(target, after, actorId, source, events);
  return next;
}

function resolveBlock(
  combatants: readonly Combatant[],
  actorId: string,
  targetId: string,
  amount: number,
  source: "card" | "passive",
  events: ResolvedEvent[],
): Combatant[] {
  const target = combatants.find((combatant) => combatant.id === targetId);
  const actor = combatants.find((combatant) => combatant.id === actorId);
  if (!target || !actor || target.hp <= 0) return [...combatants];
  const granted = Math.max(0, Math.min(amount, BLOCK_LIMIT - target.block));
  let next = replaceCombatant(combatants, targetId, (combatant) => ({
    ...combatant,
    block: combatant.block + granted,
  }));
  if (granted > 0) {
    events.push({
      kind: "block",
      targetId,
      actorId,
      source,
      amount: granted,
      combo: actorId !== targetId,
      text: `${target.displayName}获得 ${granted} 点护盾${actorId !== targetId ? " · 联携" : ""}。`,
    });
  }
  if (granted > 0 && source === "card" && actorId === targetId && actor.passiveId === "furnace-heart") {
    next = putStatus(next, targetId, "tempered", undefined, "passive", actorId, events);
  }
  return next;
}

function resolveHeal(
  combatants: readonly Combatant[],
  actorId: string,
  targetId: string,
  amount: number,
  canRevive: boolean,
  events: ResolvedEvent[],
): Combatant[] {
  const target = combatants.find((combatant) => combatant.id === targetId);
  const actor = combatants.find((combatant) => combatant.id === actorId);
  if (!target || !actor) return [...combatants];
  if (target.hp <= 0 && (!canRevive || !target.reviveAvailable)) return [...combatants];

  const recovered = target.hp <= 0
    ? Math.min(3, amount, target.maxHp)
    : Math.min(amount, target.maxHp - target.hp);
  let next = replaceCombatant(combatants, targetId, (combatant) => ({
    ...combatant,
    hp: combatant.hp <= 0 ? recovered : combatant.hp + recovered,
    reviveAvailable: combatant.hp <= 0 ? false : combatant.reviveAvailable,
    block: combatant.hp <= 0 ? 0 : combatant.block,
    statuses: combatant.hp <= 0
      ? combatant.statuses.filter((status) => !STATUS_CATALOG[status.id].harmful)
      : combatant.statuses,
  }));
  if (recovered > 0) {
    const revived = target.hp <= 0;
    events.push({
      kind: revived ? "revive" : "heal",
      targetId,
      actorId,
      source: "card",
      amount: recovered,
      combo: actorId !== targetId,
      text: revived
        ? `${actor.displayName}援护${target.displayName}以 ${recovered} 点生命归队 · 联携。`
        : `${target.displayName}恢复 ${recovered} 点生命${actorId !== targetId ? " · 联携" : ""}。`,
    });
    if (actor.passiveId === "afterglow") {
      next = resolveBlock(next, actorId, targetId, 2, "passive", events);
    }
  }
  return next;
}

function resolveCleanse(
  combatants: readonly Combatant[],
  actorId: string,
  targetId: string,
  statuses: readonly StatusId[],
  events: ResolvedEvent[],
): Combatant[] {
  let next = [...combatants];
  for (const statusId of statuses) {
    const target = next.find((combatant) => combatant.id === targetId);
    if (!target || !hasStatus(target, statusId)) continue;
    next = replaceCombatant(next, targetId, (combatant) => ({
      ...combatant,
      statuses: removeStatus(combatant.statuses, statusId),
    }));
    events.push({
      kind: "status-removed",
      targetId,
      actorId,
      source: "card",
      statusId,
      combo: actorId !== targetId,
      text: `${target.displayName}移除了「${STATUS_CATALOG[statusId].name}」${actorId !== targetId ? " · 联携" : ""}。`,
    });
  }
  return next;
}

function resolveEffect(
  combatants: readonly Combatant[],
  actorId: string,
  chosenTargetId: string,
  effect: CardEffect,
  response: { remaining: number },
  events: ResolvedEvent[],
): Combatant[] {
  const targetId = effect.target === "self" ? actorId : chosenTargetId;
  switch (effect.kind) {
    case "damage": {
      const reduction = effect.target === "chosen" ? response.remaining : 0;
      response.remaining = Math.max(0, response.remaining - reduction);
      return resolveDirectDamage(combatants, actorId, targetId, effect.amount, reduction, events);
    }
    case "block":
      return resolveBlock(combatants, actorId, targetId, effect.amount, "card", events);
    case "heal":
      return resolveHeal(combatants, actorId, targetId, effect.amount, Boolean(effect.canRevive), events);
    case "apply-status":
      return putStatus(combatants, targetId, effect.status, effect.duration, "card", actorId, events);
    case "cleanse":
      return resolveCleanse(combatants, actorId, targetId, effect.statuses, events);
  }
}

function winningTeam(combatants: readonly Combatant[]): MatchWinner | undefined {
  const dawnAlive = combatants.some((combatant) => combatant.team === "dawn" && combatant.hp > 0);
  const duskAlive = combatants.some((combatant) => combatant.team === "dusk" && combatant.hp > 0);
  if (!dawnAlive && !duskAlive) return "draw";
  if (dawnAlive && !duskAlive) return "dawn";
  if (duskAlive && !dawnAlive) return "dusk";
  return undefined;
}

function resolveEndOfTurn(
  combatants: readonly Combatant[],
  actorId: string,
  events: ResolvedEvent[],
): Combatant[] {
  let next = [...combatants];
  const actor = next.find((combatant) => combatant.id === actorId);
  const burning = actor?.statuses.find((status) => status.id === "burning");
  if (!actor || !burning) return next;

  next = resolveTrueDamage(next, actorId, 2, "status", burning.sourceActorId, events);
  next = replaceCombatant(next, actorId, (combatant) => ({
    ...combatant,
    statuses: burning.remainingTurns === undefined
      ? combatant.statuses
      : burning.remainingTurns > 1
        ? combatant.statuses.map((status) => status.id === "burning"
          ? { ...status, remainingTurns: burning.remainingTurns! - 1 }
          : status)
        : removeStatus(combatant.statuses, "burning"),
  }));
  if (burning.remainingTurns !== undefined && burning.remainingTurns <= 1) {
    events.push({
      kind: "status-removed",
      targetId: actorId,
      source: "status",
      statusId: "burning",
      text: `${actor.displayName}身上的灼烧熄灭了。`,
    });
  }
  return next;
}

function resolveGlobalOverheat(
  combatants: readonly Combatant[],
  roundNumber: number,
  events: ResolvedEvent[],
): Combatant[] {
  const amount = roundNumber - OVERHEAT_START_ROUND + 1;
  if (amount <= 0) return [...combatants];
  let next = [...combatants];
  const livingIds = combatants.filter((combatant) => combatant.hp > 0).map((combatant) => combatant.id);
  // Overheat compresses a stalled board but never awards the final defeat;
  // a card or status must still decide the match.
  for (const targetId of livingIds) next = resolveTrueDamage(next, targetId, amount, "system", undefined, events, false);
  return next;
}

function nextLivingId(combatants: readonly Combatant[], activePlayerId: string): { id: string; wrapped: boolean } {
  const activeIndex = INITIATIVE_ORDER.indexOf(activePlayerId as typeof INITIATIVE_ORDER[number]);
  for (let offset = 1; offset <= INITIATIVE_ORDER.length; offset += 1) {
    const rawIndex = activeIndex + offset;
    const candidateId = INITIATIVE_ORDER[rawIndex % INITIATIVE_ORDER.length];
    if ((combatants.find((combatant) => combatant.id === candidateId)?.hp ?? 0) > 0) {
      return { id: candidateId, wrapped: rawIndex >= INITIATIVE_ORDER.length };
    }
  }
  return { id: activePlayerId, wrapped: false };
}

function settleTurn(
  state: EmberPactState,
  actorId: string,
  initialCombatants: readonly Combatant[],
  events: ResolvedEvent[],
): TurnSettlement {
  let combatants = resolveEndOfTurn(initialCombatants, actorId, events);
  let winner = winningTeam(combatants);
  let activePlayerId = actorId;
  let roundNumber = state.roundNumber;
  let rngSeed = state.rngSeed;

  if (!winner) {
    const next = nextLivingId(combatants, actorId);
    activePlayerId = next.id;
    if (next.wrapped) {
      roundNumber += 1;
      combatants = resolveGlobalOverheat(combatants, roundNumber, events);
      winner = winningTeam(combatants);
      // Overheat resolves simultaneously at the round boundary. The seat we
      // selected before it may have just left play, so choose again without
      // advancing the round a second time.
      if (!winner && (combatants.find((combatant) => combatant.id === activePlayerId)?.hp ?? 0) <= 0) {
        activePlayerId = nextLivingId(combatants, actorId).id;
      }
    }
  }

  if (!winner) {
    const incoming = combatants.find((combatant) => combatant.id === activePlayerId)!;
    const draw = drawCards(incoming, DRAW_PER_TURN, rngSeed);
    combatants = replaceCombatant(combatants, activePlayerId, () => draw.combatant);
    rngSeed = draw.seed;
    for (const overflow of draw.overflow) {
      events.push({
        kind: "card-overflow",
        targetId: activePlayerId,
        source: "system",
        text: `${incoming.displayName}手牌已满，「${getCard(overflow).name}」进入弃牌堆。`,
      });
    }
  }

  return {
    activePlayerId,
    actionsRemaining: ACTIONS_PER_TURN,
    attackUsed: false,
    phase: "action",
    pendingAttack: undefined,
    turnNumber: state.turnNumber + (winner ? 0 : 1),
    roundNumber,
    combatants,
    rngSeed,
    winner,
  };
}

function appendEntries(
  log: readonly BattleLogEntry[],
  texts: readonly string[],
  revision: number,
): readonly BattleLogEntry[] {
  const entries = texts.map((text, index) => ({ id: revision * 100 + index, text }));
  return [...log, ...entries].slice(-24);
}

function updateMetric(
  metrics: Readonly<Record<string, CombatantMetrics>>,
  id: string,
  update: (metric: CombatantMetrics) => CombatantMetrics,
): Readonly<Record<string, CombatantMetrics>> {
  const current = metrics[id];
  return current ? { ...metrics, [id]: update(current) } : metrics;
}

function recordCardPlayed(metrics: Readonly<Record<string, CombatantMetrics>>, actorId: string): Readonly<Record<string, CombatantMetrics>> {
  return updateMetric(metrics, actorId, (metric) => ({ ...metric, cardsPlayed: metric.cardsPlayed + 1 }));
}

function recordEvents(
  initial: Readonly<Record<string, CombatantMetrics>>,
  events: readonly ResolvedEvent[],
): Readonly<Record<string, CombatantMetrics>> {
  let metrics = initial;
  for (const event of events) {
    if ((event.kind === "damage" || event.kind === "overheat") && (event.amount ?? 0) > 0) {
      metrics = updateMetric(metrics, event.targetId, (metric) => ({
        ...metric,
        damageTaken: metric.damageTaken + (event.amount ?? 0),
      }));
      if (event.actorId) {
        metrics = updateMetric(metrics, event.actorId, (metric) => ({
          ...metric,
          damageDealt: metric.damageDealt + (event.amount ?? 0),
          biggestHit: Math.max(metric.biggestHit, event.amount ?? 0),
          combos: metric.combos + (event.combo ? 1 : 0),
        }));
      }
    }
    if ((event.kind === "heal" || event.kind === "revive") && event.actorId) {
      metrics = updateMetric(metrics, event.actorId, (metric) => ({
        ...metric,
        healingDone: metric.healingDone + (event.amount ?? 0),
        combos: metric.combos + (event.combo ? 1 : 0),
      }));
    }
    if (event.kind === "block" && event.actorId) {
      metrics = updateMetric(metrics, event.actorId, (metric) => ({
        ...metric,
        blockGranted: metric.blockGranted + (event.amount ?? 0),
        combos: metric.combos + (event.combo ? 1 : 0),
      }));
    }
    if (event.kind === "response" && event.actorId) {
      metrics = updateMetric(metrics, event.actorId, (metric) => ({ ...metric, responses: metric.responses + 1 }));
    }
    if (event.kind === "defeated" && event.actorId) {
      metrics = updateMetric(metrics, event.actorId, (metric) => ({ ...metric, defeats: metric.defeats + 1 }));
    }
  }
  return metrics;
}

function winnerText(winner: MatchWinner): string {
  return winner === "draw" ? "双方火种同时熄灭，本局战平。" : `${TEAM_NAMES[winner]}赢得了这场争焰。`;
}

function completeResolution(
  state: EmberPactState,
  actorId: string,
  cardId: string | undefined,
  header: string,
  initialCombatants: readonly Combatant[],
  initialEvents: readonly ResolvedEvent[],
  initialMetrics: Readonly<Record<string, CombatantMetrics>> = state.metrics,
): EmberPactState {
  const events = [...initialEvents];
  let combatants = [...initialCombatants];
  let winner = winningTeam(combatants);
  let nextFields: Partial<TurnSettlement> = {
    activePlayerId: state.activePlayerId,
    actionsRemaining: state.actionsRemaining,
    attackUsed: state.attackUsed,
    phase: "action",
    pendingAttack: undefined,
    turnNumber: state.turnNumber,
    roundNumber: state.roundNumber,
    combatants,
    rngSeed: state.rngSeed,
  };

  if (!winner && state.actionsRemaining <= 0) {
    nextFields = settleTurn(state, actorId, combatants, events);
    combatants = [...nextFields.combatants!];
    winner = nextFields.winner;
  }

  const revision = state.revision + 1;
  const summary = events.at(-1)?.text ?? header;
  const eventTexts = events.map((event) => event.text);
  const texts = eventTexts[0] === header ? eventTexts : [header, ...eventTexts];
  if (winner) texts.push(winnerText(winner));

  return {
    ...state,
    ...nextFields,
    revision,
    combatants,
    metrics: recordEvents(initialMetrics, events),
    status: winner ? "finished" : "playing",
    winner,
    lastAction: { revision, actorId, cardId, events, summary },
    log: appendEntries(state.log, texts, revision),
  };
}

function actionText(actor: Combatant, target: Combatant, card: BattleCard): string {
  const verbs: Record<BattleCard["kind"], string> = {
    attack: "攻向",
    guard: "护住",
    restore: "援助",
    tactic: "影响",
  };
  return `${actor.displayName}打出「${card.name}」，${verbs[card.kind]}${target.displayName}。`;
}

function resolveCardEffects(
  combatants: readonly Combatant[],
  actorId: string,
  targetId: string,
  card: BattleCard,
  responseReduction: number,
  events: ResolvedEvent[],
): Combatant[] {
  let next = [...combatants];
  const response = { remaining: responseReduction };
  for (const effect of card.effects) next = resolveEffect(next, actorId, targetId, effect, response, events);
  return next;
}

export function playCard(
  state: EmberPactState,
  actorId: string,
  cardUid: string,
  targetId: string,
): EmberPactState {
  if (state.status !== "playing" || state.phase !== "action" || state.activePlayerId !== actorId) return state;
  const actor = getCombatant(state, actorId);
  const target = getCombatant(state, targetId);
  const instance = actor?.hand.find((candidate) => candidate.uid === cardUid);
  if (!actor || !target || !instance || !getValidTargetIds(state, actorId, cardUid).includes(targetId)) return state;

  const card = getCard(instance);
  const header = actionText(actor, target, card);
  const combatants = replaceCombatant(state.combatants, actorId, (combatant) => ({
    ...combatant,
    hand: combatant.hand.filter((candidate) => candidate.uid !== cardUid),
    discard: [...combatant.discard, instance],
  }));
  const actionState: EmberPactState = {
    ...state,
    combatants,
    actionsRemaining: state.actionsRemaining - card.cost,
    attackUsed: state.attackUsed || card.kind === "attack",
    metrics: recordCardPlayed(state.metrics, actorId),
  };

  const responderHasCard = combatants
    .find((combatant) => combatant.id === targetId)
    ?.hand.some((candidate) => (getCard(candidate)?.responsePower ?? 0) > 0);
  if (card.respondable && responderHasCard) {
    const revision = state.revision + 1;
    const summary = `${target.displayName}可以打出「卸力」响应。`;
    return {
      ...actionState,
      revision,
      phase: "response",
      pendingAttack: { actorId, targetId, cardUid, definitionId: card.id, header },
      lastAction: { revision, actorId, cardId: card.id, events: [], summary },
      log: appendEntries(state.log, [header, summary], revision),
    };
  }

  const events: ResolvedEvent[] = [];
  const resolved = resolveCardEffects(combatants, actorId, targetId, card, 0, events);
  return completeResolution(actionState, actorId, card.id, header, resolved, events, actionState.metrics);
}

export function respondToAttack(
  state: EmberPactState,
  responderId: string,
  responseCardUid?: string,
): EmberPactState {
  const pending = state.pendingAttack;
  if (state.status !== "playing" || state.phase !== "response" || !pending || pending.targetId !== responderId) return state;
  const responder = getCombatant(state, responderId);
  const responseCard = responseCardUid
    ? responder?.hand.find((candidate) => candidate.uid === responseCardUid)
    : undefined;
  if (responseCardUid && (!responseCard || (getCard(responseCard)?.responsePower ?? 0) <= 0)) return state;

  let combatants = [...state.combatants];
  let metrics = state.metrics;
  let reduction = 0;
  const events: ResolvedEvent[] = [];
  let responseText = `${responder?.displayName ?? "目标"}选择承受这次攻击。`;
  if (responseCard) {
    const definition = getCard(responseCard);
    reduction = definition.responsePower ?? 0;
    combatants = replaceCombatant(combatants, responderId, (combatant) => ({
      ...combatant,
      hand: combatant.hand.filter((candidate) => candidate.uid !== responseCard.uid),
      discard: [...combatant.discard, responseCard],
    }));
    metrics = recordCardPlayed(metrics, responderId);
    responseText = `${responder!.displayName}打出「${definition.name}」，准备化解 ${reduction} 点伤害。`;
    events.push({
      kind: "response",
      targetId: responderId,
      actorId: responderId,
      source: "response",
      amount: reduction,
      text: responseText,
    });
  }

  const card = CARD_CATALOG[pending.definitionId];
  combatants = resolveCardEffects(combatants, pending.actorId, pending.targetId, card, reduction, events);
  const actionState: EmberPactState = { ...state, phase: "action", pendingAttack: undefined, combatants, metrics };
  return completeResolution(actionState, pending.actorId, card.id, responseText, combatants, events, metrics);
}

export function declineResponse(state: EmberPactState, responderId: string): EmberPactState {
  return respondToAttack(state, responderId);
}

export function endTurn(state: EmberPactState, actorId: string): EmberPactState {
  if (state.status !== "playing" || state.phase !== "action" || state.activePlayerId !== actorId) return state;
  const actor = getCombatant(state, actorId);
  if (!actor || actor.hp <= 0) return state;
  const events: ResolvedEvent[] = [];
  const settled = settleTurn(state, actorId, state.combatants, events);
  const winner = settled.winner;
  const revision = state.revision + 1;
  const header = `${actor.displayName}结束回合。`;
  const texts = [header, ...events.map((event) => event.text)];
  if (winner) texts.push(winnerText(winner));
  return {
    ...state,
    ...settled,
    revision,
    metrics: recordEvents(state.metrics, events),
    status: winner ? "finished" : "playing",
    winner,
    lastAction: { revision, actorId, events, summary: events.at(-1)?.text ?? header },
    log: appendEntries(state.log, texts, revision),
  };
}

/** Compatibility alias retained for callers and v1 tests while the UI now says “结束回合”. */
export function passTurn(state: EmberPactState, actorId: string): EmberPactState {
  return endTurn(state, actorId);
}
