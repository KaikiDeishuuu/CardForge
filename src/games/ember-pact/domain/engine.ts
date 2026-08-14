import { CARD_CATALOG, COMBATANT_SEEDS, STATUS_CATALOG, TEAM_NAMES, buildDeck } from "./data";
import type {
  AiMove,
  BattleCard,
  BattleLogEntry,
  CardEffect,
  CardInstance,
  Combatant,
  EmberPactState,
  ResolvedEvent,
  StatusId,
  StatusInstance,
  TeamId,
} from "./types";

export const HAND_LIMIT = 6;
export const OVERHEAT_START_ROUND = 13;

interface DrawResult {
  readonly combatant: Combatant;
  readonly overflow?: CardInstance;
  readonly seed: number;
}

interface AdvanceResult {
  readonly state: EmberPactState;
  readonly events: readonly ResolvedEvent[];
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

// Reshuffling happens mid-match, deep inside turn advancement, so the engine
// carries a seed in state instead of threading a random callback through every
// entry point. Mulberry32 keeps every operation in exact 32-bit arithmetic,
// leaving actions as pure functions of the state they receive.
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
      combatant: {
        ...combatant,
        deck: deck.slice(0, -1),
        discard: [...discard, card],
      },
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

function dealOpeningHand(combatant: Combatant, seed: number): { combatant: Combatant; seed: number } {
  let result = combatant;
  let current = seed;
  for (let count = 0; count < 4; count += 1) {
    const draw = drawOne(result, current);
    result = draw.combatant;
    current = draw.seed;
  }
  return { combatant: result, seed: current };
}

export const DEFAULT_HUMAN_ID = "player";

/** 可选出战角色：四人任选其一，其余交给 AI，阵营随所选角色确定。 */
export function selectableCombatantIds(): readonly string[] {
  return COMBATANT_SEEDS.map((seed) => seed.id);
}

export function createInitialState(
  random: () => number = Math.random,
  humanId: string = DEFAULT_HUMAN_ID,
): EmberPactState {
  let rngSeed = Math.floor(random() * 2_147_483_647) || 1;
  const combatants: Combatant[] = [];
  const controlled = COMBATANT_SEEDS.some((seed) => seed.id === humanId) ? humanId : DEFAULT_HUMAN_ID;

  for (const seed of COMBATANT_SEEDS) {
    const dealt = dealOpeningHand({
      ...seed,
      controller: seed.id === controlled ? "human" : "ai",
      hp: seed.maxHp,
      block: 0,
      statuses: [],
      hand: [],
      deck: shuffled(buildDeck(seed.id), random),
      discard: [],
    }, rngSeed);
    combatants.push(dealt.combatant);
    rngSeed = dealt.seed;
  }

  return {
    revision: 0,
    turnNumber: 1,
    roundNumber: 1,
    activePlayerId: "player",
    combatants,
    status: "playing",
    log: [{ id: 0, text: "熔炉点亮。晨铸同盟先行。" }],
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

export function getValidTargetIds(
  state: EmberPactState,
  actorId: string,
  cardUid: string,
): readonly string[] {
  const actor = getCombatant(state, actorId);
  const instance = actor?.hand.find((candidate) => candidate.uid === cardUid);
  if (!actor || !instance || actor.hp <= 0 || state.activePlayerId !== actorId) return [];

  const card = getCard(instance);
  if (card.target === "self") return [actor.id];

  return state.combatants
    .filter((candidate) => {
      if (candidate.hp <= 0) return false;
      return card.target === "enemy" ? candidate.team !== actor.team : candidate.team === actor.team;
    })
    .map((candidate) => candidate.id);
}

export function enumerateLegalMoves(state: EmberPactState, actorId: string): readonly AiMove[] {
  const actor = getCombatant(state, actorId);
  if (!actor || state.status !== "playing" || state.activePlayerId !== actorId) return [];

  return actor.hand.flatMap((card) =>
    getValidTargetIds(state, actorId, card.uid).map((targetId) => ({ cardUid: card.uid, targetId })),
  );
}

function removeStatus(statuses: readonly StatusInstance[], id: StatusId): StatusInstance[] {
  return statuses.filter((status) => status.id !== id);
}

function putStatus(
  combatants: readonly Combatant[],
  targetId: string,
  statusId: StatusId,
  duration: number | undefined,
  source: ResolvedEvent["source"],
  events: ResolvedEvent[],
): Combatant[] {
  const target = combatants.find((combatant) => combatant.id === targetId);
  // A card's earlier effect can defeat its own target, so a status must not land
  // on someone already off the battlefield.
  if (!target || target.hp <= 0) return [...combatants];
  const existing = target.statuses.find((status) => status.id === statusId);
  const nextStatus: StatusInstance = duration === undefined
    ? { id: statusId }
    : { id: statusId, remainingTurns: duration };

  if (existing && statusId !== "burning") return [...combatants];

  events.push({
    kind: "status-applied",
    targetId,
    source,
    statusId,
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

function pushDefeatIfNeeded(before: Combatant, after: Combatant, events: ResolvedEvent[]) {
  if (before.hp > 0 && after.hp === 0) {
    events.push({
      kind: "defeated",
      targetId: after.id,
      source: "system",
      text: `${after.displayName}退出了战场。`,
    });
  }
}

function resolveDirectDamage(
  combatants: readonly Combatant[],
  actorId: string,
  targetId: string,
  baseAmount: number,
  events: ResolvedEvent[],
): Combatant[] {
  let next = [...combatants];
  let actor = next.find((combatant) => combatant.id === actorId);
  let target = next.find((combatant) => combatant.id === targetId);
  if (!actor || !target) return next;

  let amount = baseAmount;
  if (hasStatus(actor, "tempered")) {
    amount += 2;
    next = consumeStatus(next, actorId, "tempered", events);
    actor = next.find((combatant) => combatant.id === actorId)!;
  }
  if (actor.passiveId === "siegebreaker" && target.block > 0) amount += 2;
  if (actor.passiveId === "firehunt" && hasStatus(target, "burning")) amount += 2;
  if (hasStatus(target, "exposed")) {
    amount += 2;
    next = consumeStatus(next, targetId, "exposed", events);
    target = next.find((combatant) => combatant.id === targetId)!;
  }

  const before = target;
  const absorbed = Math.min(target.block, amount);
  const hpDamage = amount - absorbed;
  const after: Combatant = {
    ...target,
    block: target.block - absorbed,
    hp: Math.max(0, target.hp - hpDamage),
  };
  next = replaceCombatant(next, targetId, () => after);
  events.push({
    kind: "damage",
    targetId,
    source: "card",
    amount: hpDamage,
    absorbed,
    text: `${target.displayName}受到 ${hpDamage} 点伤害${absorbed > 0 ? `，护盾吸收 ${absorbed} 点` : ""}。`,
  });
  pushDefeatIfNeeded(before, after, events);
  return next;
}

function resolveTrueDamage(
  combatants: readonly Combatant[],
  targetId: string,
  amount: number,
  source: "status" | "system",
  events: ResolvedEvent[],
): Combatant[] {
  const target = combatants.find((combatant) => combatant.id === targetId);
  if (!target || target.hp <= 0) return [...combatants];
  const after = { ...target, hp: Math.max(0, target.hp - amount) };
  const kind = source === "system" ? "overheat" : "damage";
  const label = source === "system" ? "炉温过载" : "灼烧";
  const next = replaceCombatant(combatants, targetId, () => after);
  events.push({
    kind,
    targetId,
    source,
    amount,
    text: `${target.displayName}因${label}受到 ${amount} 点真实伤害。`,
  });
  pushDefeatIfNeeded(target, after, events);
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
  if (!target || !actor) return [...combatants];
  events.push({
    kind: "block",
    targetId,
    source,
    amount,
    text: `${target.displayName}获得 ${amount} 点护盾。`,
  });
  let next = replaceCombatant(combatants, targetId, (combatant) => ({
    ...combatant,
    block: combatant.block + amount,
  }));
  if (source === "card" && actorId === targetId && actor.passiveId === "furnace-heart") {
    next = putStatus(next, targetId, "tempered", undefined, "passive", events);
  }
  return next;
}

function resolveHeal(
  combatants: readonly Combatant[],
  actorId: string,
  targetId: string,
  amount: number,
  events: ResolvedEvent[],
): Combatant[] {
  const target = combatants.find((combatant) => combatant.id === targetId);
  const actor = combatants.find((combatant) => combatant.id === actorId);
  if (!target || !actor) return [...combatants];
  const recovered = Math.min(amount, target.maxHp - target.hp);
  let next = replaceCombatant(combatants, targetId, (combatant) => ({
    ...combatant,
    hp: combatant.hp + recovered,
  }));
  if (recovered > 0) {
    events.push({
      kind: "heal",
      targetId,
      source: "card",
      amount: recovered,
      text: `${target.displayName}恢复 ${recovered} 点生命。`,
    });
  }
  if (actor.passiveId === "afterglow") {
    next = resolveBlock(next, actorId, targetId, 2, "passive", events);
  }
  return next;
}

function resolveCleanse(
  combatants: readonly Combatant[],
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
      source: "card",
      statusId,
      text: `${target.displayName}移除了「${STATUS_CATALOG[statusId].name}」。`,
    });
  }
  return next;
}

function resolveEffect(
  combatants: readonly Combatant[],
  actorId: string,
  chosenTargetId: string,
  effect: CardEffect,
  events: ResolvedEvent[],
): Combatant[] {
  const targetId = effect.target === "self" ? actorId : chosenTargetId;
  switch (effect.kind) {
    case "damage":
      return resolveDirectDamage(combatants, actorId, targetId, effect.amount, events);
    case "block":
      return resolveBlock(combatants, actorId, targetId, effect.amount, "card", events);
    case "heal":
      return resolveHeal(combatants, actorId, targetId, effect.amount, events);
    case "apply-status":
      return putStatus(combatants, targetId, effect.status, effect.duration, "card", events);
    case "cleanse":
      return resolveCleanse(combatants, targetId, effect.statuses, events);
  }
}

function winningTeam(combatants: readonly Combatant[]): TeamId | undefined {
  const dawnAlive = combatants.some((combatant) => combatant.team === "dawn" && combatant.hp > 0);
  const duskAlive = combatants.some((combatant) => combatant.team === "dusk" && combatant.hp > 0);
  if (dawnAlive && !duskAlive) return "dawn";
  if (duskAlive && !dawnAlive) return "dusk";
  return undefined;
}

function resolveEndOfTurn(
  combatants: readonly Combatant[],
  actorId: string,
  roundNumber: number,
  events: ResolvedEvent[],
): Combatant[] {
  let next = [...combatants];
  let actor = next.find((combatant) => combatant.id === actorId);
  const burning = actor?.statuses.find((status) => status.id === "burning");

  if (actor && burning) {
    next = resolveTrueDamage(next, actorId, 2, "status", events);
    next = replaceCombatant(next, actorId, (combatant) => ({
      ...combatant,
      statuses: burning.remainingTurns && burning.remainingTurns > 1
        ? combatant.statuses.map((status) => status.id === "burning"
          ? { ...status, remainingTurns: burning.remainingTurns! - 1 }
          : status)
        : removeStatus(combatant.statuses, "burning"),
    }));
    if (!burning.remainingTurns || burning.remainingTurns <= 1) {
      events.push({
        kind: "status-removed",
        targetId: actorId,
        source: "status",
        statusId: "burning",
        text: `${actor.displayName}身上的灼烧熄灭了。`,
      });
    }
  }

  actor = next.find((combatant) => combatant.id === actorId);
  if (actor && actor.hp > 0 && roundNumber >= OVERHEAT_START_ROUND) {
    next = resolveTrueDamage(next, actorId, roundNumber - OVERHEAT_START_ROUND + 1, "system", events);
  }
  return next;
}

function advanceTurn(state: EmberPactState): AdvanceResult {
  const activeIndex = state.combatants.findIndex((combatant) => combatant.id === state.activePlayerId);
  let nextIndex = activeIndex;

  for (let offset = 1; offset <= state.combatants.length; offset += 1) {
    const candidateIndex = (activeIndex + offset) % state.combatants.length;
    if (state.combatants[candidateIndex].hp > 0) {
      nextIndex = candidateIndex;
      break;
    }
  }

  const nextId = state.combatants[nextIndex].id;
  const nextRound = nextIndex <= activeIndex ? state.roundNumber + 1 : state.roundNumber;
  const currentNext = state.combatants[nextIndex];
  const draw = drawOne({ ...currentNext, block: 0 }, state.rngSeed);
  const combatants = replaceCombatant(state.combatants, nextId, () => draw.combatant);
  const events: ResolvedEvent[] = [];
  if (draw.overflow) {
    events.push({
      kind: "card-overflow",
      targetId: nextId,
      source: "system",
      text: `${currentNext.displayName}手牌已满，「${getCard(draw.overflow).name}」进入弃牌堆。`,
    });
  }

  return {
    state: {
      ...state,
      activePlayerId: nextId,
      turnNumber: state.turnNumber + 1,
      roundNumber: nextRound,
      combatants,
      rngSeed: draw.seed,
    },
    events,
  };
}

function appendEntries(
  log: readonly BattleLogEntry[],
  texts: readonly string[],
  revision: number,
): readonly BattleLogEntry[] {
  const entries = texts.map((text, index) => ({ id: revision * 100 + index, text }));
  return [...log, ...entries].slice(-14);
}

function commitAction(
  state: EmberPactState,
  actorId: string,
  cardId: string | undefined,
  header: string,
  initialCombatants: readonly Combatant[],
  initialEvents: readonly ResolvedEvent[],
): EmberPactState {
  let combatants = [...initialCombatants];
  const events = [...initialEvents];
  let winner = winningTeam(combatants);

  if (!winner) {
    combatants = resolveEndOfTurn(combatants, actorId, state.roundNumber, events);
    winner = winningTeam(combatants);
  }

  let nextState: EmberPactState = { ...state, combatants };
  if (!winner) {
    const advanced = advanceTurn(nextState);
    nextState = advanced.state;
    events.push(...advanced.events);
  }

  const revision = state.revision + 1;
  const texts = [header, ...events.map((event) => event.text)];
  if (winner) texts.push(`${TEAM_NAMES[winner]}赢得了这场试炼。`);

  return {
    ...nextState,
    revision,
    status: winner ? "finished" : "playing",
    winner,
    lastAction: { revision, actorId, cardId, events },
    log: appendEntries(state.log, texts, revision),
  };
}

function actionText(actor: Combatant, target: Combatant, card: BattleCard): string {
  const verbs: Record<BattleCard["kind"], string> = {
    attack: "击向",
    guard: "护住",
    restore: "修复",
    tactic: "影响",
  };
  return `${actor.displayName}打出「${card.name}」，${verbs[card.kind]}${target.displayName}。`;
}

export function playCard(
  state: EmberPactState,
  actorId: string,
  cardUid: string,
  targetId: string,
): EmberPactState {
  if (state.status !== "playing" || state.activePlayerId !== actorId) return state;

  const actor = getCombatant(state, actorId);
  const target = getCombatant(state, targetId);
  const instance = actor?.hand.find((candidate) => candidate.uid === cardUid);
  if (!actor || !target || !instance || !getValidTargetIds(state, actorId, cardUid).includes(targetId)) {
    return state;
  }

  const card = getCard(instance);
  const events: ResolvedEvent[] = [];
  let combatants = replaceCombatant(state.combatants, actorId, (combatant) => ({
    ...combatant,
    hand: combatant.hand.filter((candidate) => candidate.uid !== cardUid),
    discard: [...combatant.discard, instance],
  }));

  for (const effect of card.effects) {
    combatants = resolveEffect(combatants, actorId, targetId, effect, events);
  }

  return commitAction(state, actorId, card.id, actionText(actor, target, card), combatants, events);
}

export function passTurn(state: EmberPactState, actorId: string): EmberPactState {
  if (state.status !== "playing" || state.activePlayerId !== actorId) return state;
  const actor = getCombatant(state, actorId);
  if (!actor) return state;
  return commitAction(state, actorId, undefined, `${actor.displayName}暂缓行动。`, state.combatants, []);
}
