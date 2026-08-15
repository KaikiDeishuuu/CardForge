import type { ControllerKind } from "../../../shared/types/game";
import type {
  CardCombo,
  CardRank,
  ComboType,
  GuandanAction,
  GuandanCard,
  GuandanDifficulty,
  GuandanPlayer,
  GuandanState,
  MatchState,
  NumberRank,
  PlayerId,
  Suit,
  TeamId,
} from "./types";

export const PLAYER_ORDER: readonly PlayerId[] = ["human", "east", "partner", "west"];
export const NUMBER_RANKS: readonly NumberRank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

const SUITS: readonly Exclude<Suit, "joker">[] = ["spades", "hearts", "diamonds", "clubs"];
const SUIT_NAMES: Record<Suit, string> = {
  spades: "黑桃",
  hearts: "红心",
  diamonds: "方片",
  clubs: "梅花",
  joker: "王",
};
const COMBO_LABELS: Record<ComboType, string> = {
  single: "单张",
  pair: "对子",
  triple: "三张",
  "full-house": "三带二",
  straight: "顺子",
  bomb: "炸弹",
};
const STRAIGHT_SEQUENCES: readonly (readonly NumberRank[])[] = [
  ["A", "2", "3", "4", "5"],
  ["2", "3", "4", "5", "6"],
  ["3", "4", "5", "6", "7"],
  ["4", "5", "6", "7", "8"],
  ["5", "6", "7", "8", "9"],
  ["6", "7", "8", "9", "10"],
  ["7", "8", "9", "10", "J"],
  ["8", "9", "10", "J", "Q"],
  ["9", "10", "J", "Q", "K"],
  ["10", "J", "Q", "K", "A"],
];

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function createDeck(): GuandanCard[] {
  const decks: GuandanCard[] = [];
  for (const deckIndex of [0, 1] as const) {
    for (const suit of SUITS) {
      for (const rank of NUMBER_RANKS) {
        decks.push({
          id: `${deckIndex}-${suit}-${rank}`,
          name: `${SUIT_NAMES[suit]} ${rank}`,
          suit,
          rank,
          deckIndex,
        });
      }
    }
    decks.push({ id: `${deckIndex}-small-joker`, name: "小王", suit: "joker", rank: "small-joker", deckIndex });
    decks.push({ id: `${deckIndex}-big-joker`, name: "大王", suit: "joker", rank: "big-joker", deckIndex });
  }
  return decks;
}

export function isWild(card: GuandanCard, levelRank: NumberRank): boolean {
  return card.suit === "hearts" && card.rank === levelRank;
}

export function rankPower(rank: CardRank, levelRank: NumberRank): number {
  if (rank === "small-joker") return 13;
  if (rank === "big-joker") return 14;
  if (rank === levelRank) return 12;
  return NUMBER_RANKS.filter((entry) => entry !== levelRank).indexOf(rank);
}

export function sortHand(cards: readonly GuandanCard[], levelRank: NumberRank): GuandanCard[] {
  const suitOrder: Record<Suit, number> = { diamonds: 0, clubs: 1, hearts: 2, spades: 3, joker: 4 };
  return [...cards].sort((left, right) =>
    rankPower(left.rank, levelRank) - rankPower(right.rank, levelRank)
    || suitOrder[left.suit] - suitOrder[right.suit]
    || left.deckIndex - right.deckIndex,
  );
}

function combo(type: ComboType, cards: readonly GuandanCard[], power: number, bombSize?: number, label?: string): CardCombo {
  return { type, cards: [...cards], power, bombSize, label: label ?? COMBO_LABELS[type] };
}

function nonWildRankCounts(cards: readonly GuandanCard[], levelRank: NumberRank): Map<CardRank, number> {
  const counts = new Map<CardRank, number>();
  for (const card of cards) {
    if (isWild(card, levelRank)) continue;
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }
  return counts;
}

function sameRankPower(cards: readonly GuandanCard[], levelRank: NumberRank): number | undefined {
  const nonWild = cards.filter((card) => !isWild(card, levelRank));
  if (nonWild.some((card) => card.suit === "joker")) {
    const first = nonWild[0]?.rank;
    return nonWild.every((card) => card.rank === first) && nonWild.length === cards.length && first
      ? rankPower(first, levelRank)
      : undefined;
  }
  const ranks = new Set(nonWild.map((card) => card.rank));
  if (ranks.size > 1) return undefined;
  const targetRank = nonWild[0]?.rank ?? levelRank;
  return rankPower(targetRank, levelRank);
}

function fullHousePower(cards: readonly GuandanCard[], levelRank: NumberRank): number | undefined {
  // Exactly five cards is what makes the wild arithmetic below hold: once every
  // non-wild card belongs to the triple or the pair, the wilds necessarily fill
  // the remaining slots, so only the per-rank caps still need checking.
  if (cards.length !== 5) return undefined;
  const counts = nonWildRankCounts(cards, levelRank);
  if ([...counts.keys()].some((rank) => rank === "small-joker" || rank === "big-joker")) return undefined;

  const matches: number[] = [];
  for (const tripleRank of NUMBER_RANKS) {
    for (const pairRank of NUMBER_RANKS) {
      if (pairRank === tripleRank) continue;
      if ([...counts.keys()].some((rank) => rank !== tripleRank && rank !== pairRank)) continue;
      if ((counts.get(tripleRank) ?? 0) > 3 || (counts.get(pairRank) ?? 0) > 2) continue;
      matches.push(rankPower(tripleRank, levelRank));
    }
  }
  return matches.length > 0 ? Math.max(...matches) : undefined;
}

function straightPower(cards: readonly GuandanCard[], levelRank: NumberRank): number | undefined {
  const nonWild = cards.filter((card) => !isWild(card, levelRank));
  if (nonWild.some((card) => card.suit === "joker")) return undefined;
  const ranks = nonWild.map((card) => card.rank as NumberRank);
  if (new Set(ranks).size !== ranks.length) return undefined;

  const matches = STRAIGHT_SEQUENCES
    .map((sequence, index) => ({ sequence, index }))
    .filter(({ sequence }) => ranks.every((rank) => sequence.includes(rank)))
    .map(({ index }) => index);
  return matches.length > 0 ? Math.max(...matches) : undefined;
}

export function classifyCombo(cards: readonly GuandanCard[], levelRank: NumberRank): CardCombo | undefined {
  if (cards.length === 0) return undefined;
  const sorted = sortHand(cards, levelRank);

  const jokerBomb = cards.length === 4
    && cards.every((card) => card.suit === "joker")
    && cards.filter((card) => card.rank === "small-joker").length === 2
    && cards.filter((card) => card.rank === "big-joker").length === 2;
  if (jokerBomb) return combo("bomb", sorted, 100, 100, "四王炸");

  if (cards.length >= 4) {
    const power = sameRankPower(cards, levelRank);
    if (power !== undefined && cards.every((card) => card.suit !== "joker")) {
      return combo("bomb", sorted, power, cards.length, `${cards.length} 张炸弹`);
    }
  }

  if (cards.length === 1) return combo("single", sorted, rankPower(cards[0].rank, levelRank));
  if (cards.length === 2) {
    const power = sameRankPower(cards, levelRank);
    return power === undefined ? undefined : combo("pair", sorted, power);
  }
  if (cards.length === 3) {
    const power = sameRankPower(cards, levelRank);
    return power === undefined ? undefined : combo("triple", sorted, power);
  }
  if (cards.length === 5) {
    const housePower = fullHousePower(cards, levelRank);
    if (housePower !== undefined) return combo("full-house", sorted, housePower);
    const runPower = straightPower(cards, levelRank);
    if (runPower !== undefined) return combo("straight", sorted, runPower);
  }
  return undefined;
}

export function canBeat(candidate: CardCombo, target?: CardCombo): boolean {
  if (!target) return true;
  if (candidate.type === "bomb" && target.type !== "bomb") return true;
  if (candidate.type !== "bomb" && target.type === "bomb") return false;
  if (candidate.type !== target.type) return false;
  if (candidate.type === "bomb" && target.type === "bomb") {
    const candidateSize = candidate.bombSize ?? candidate.cards.length;
    const targetSize = target.bombSize ?? target.cards.length;
    return candidateSize > targetSize || (candidateSize === targetSize && candidate.power > target.power);
  }
  return candidate.cards.length === target.cards.length && candidate.power > target.power;
}

export function getPlayer(state: GuandanState, id: PlayerId): GuandanPlayer {
  const player = state.players.find((entry) => entry.id === id);
  if (!player) throw new Error(`Unknown Guandan player: ${id}`);
  return player;
}

function nextActivePlayerId(players: readonly GuandanPlayer[], from: PlayerId): PlayerId {
  const start = PLAYER_ORDER.indexOf(from);
  for (let offset = 1; offset <= PLAYER_ORDER.length; offset += 1) {
    const id = PLAYER_ORDER[(start + offset) % PLAYER_ORDER.length];
    const player = players.find((entry) => entry.id === id);
    if (player && player.hand.length > 0) return id;
  }
  return from;
}

function action(
  id: number,
  actorId: GuandanAction["actorId"],
  type: GuandanAction["type"],
  text: string,
  comboValue?: CardCombo,
): GuandanAction {
  return { id, actorId, type, text, cards: comboValue?.cards, combo: comboValue };
}

function appendAction(state: GuandanState, nextAction: GuandanAction): GuandanState {
  return {
    ...state,
    revision: nextAction.id,
    lastAction: nextAction,
    log: [...state.log, nextAction].slice(-24),
  };
}

export const INITIAL_MATCH: MatchState = {
  levels: { vermillion: "2", indigo: "2" },
  dealNumber: 1,
  attackingTeam: "vermillion",
};

const SEATS: readonly { id: PlayerId; displayName: string; controller: ControllerKind; team: TeamId }[] = [
  { id: "human", displayName: "你", controller: "human", team: "vermillion" },
  { id: "east", displayName: "东座", controller: "ai", team: "indigo" },
  { id: "partner", displayName: "对家", controller: "ai", team: "vermillion" },
  { id: "west", displayName: "西座", controller: "ai", team: "indigo" },
];

/** 升级：打过 A 才算赢下整场，其余情况最多停在 A。 */
export function advanceLevel(from: NumberRank, gained: number): { level: NumberRank; champion: boolean } {
  if (from === "A") return { level: "A", champion: true };
  const target = Math.min(NUMBER_RANKS.indexOf(from) + gained, NUMBER_RANKS.length - 1);
  return { level: NUMBER_RANKS[target], champion: false };
}

/** 头游队友的名次决定升几级：双下 3 级，三游 2 级，末游 1 级。 */
export function levelsForPartnerPlace(partnerPlace: number): number {
  if (partnerPlace <= 2) return 3;
  if (partnerPlace === 3) return 2;
  return 1;
}

function createDeal(
  match: MatchState,
  leadPlayerId: PlayerId,
  random: () => number,
  difficulty: GuandanDifficulty,
): GuandanState {
  const hands: Record<PlayerId, GuandanCard[]> = { human: [], east: [], partner: [], west: [] };
  shuffled(createDeck(), random).forEach((card, index) => {
    hands[PLAYER_ORDER[index % PLAYER_ORDER.length]].push(card);
  });

  const levelRank = match.levels[match.attackingTeam];
  const players = SEATS.map((seat) => ({ ...seat, hand: sortHand(hands[seat.id], levelRank) }));
  const opening = match.dealNumber === 1
    ? `双副牌已发完。本局打 ${levelRank}，${getPlayerFrom(players, leadPlayerId).displayName}先领出。`
    : `第 ${match.dealNumber} 局开始，打 ${teamName(match.attackingTeam)}的 ${levelRank}。${getPlayerFrom(players, leadPlayerId).displayName}先领出。`;
  const dealAction = action(0, "table", "deal", opening);

  return {
    revision: 0,
    status: "playing",
    levelRank,
    players,
    activePlayerId: leadPlayerId,
    consecutivePasses: 0,
    finishOrder: [],
    match,
    difficulty,
    lastAction: dealAction,
    log: [dealAction],
  };
}

function getPlayerFrom(players: readonly GuandanPlayer[], id: PlayerId): GuandanPlayer {
  const player = players.find((entry) => entry.id === id);
  if (!player) throw new Error(`Unknown Guandan player: ${id}`);
  return player;
}

export function createInitialState(
  random: () => number = Math.random,
  difficulty: GuandanDifficulty = "standard",
): GuandanState {
  return createDeal(INITIAL_MATCH, "human", random, difficulty);
}

/** 开下一局：由上一局头游先领出，级牌换成新的打级方级别，难度保持不变。 */
export function startNextDeal(state: GuandanState, random: () => number = Math.random): GuandanState {
  if (state.status !== "finished" || state.match.champion) return state;
  const lead = state.finishOrder[0] ?? "human";
  return createDeal({ ...state.match, dealNumber: state.match.dealNumber + 1 }, lead, random, state.difficulty);
}

/** 重开整场比赛，级别归零；可沿用当前难度。 */
export function restartMatch(
  random: () => number = Math.random,
  difficulty: GuandanDifficulty = "standard",
): GuandanState {
  return createInitialState(random, difficulty);
}

export const GUANDAN_DIFFICULTY_NAMES: Readonly<Record<GuandanDifficulty, string>> = {
  relaxed: "见习",
  standard: "标准",
  tactician: "战术",
};

/** 切换对手难度：作为一条系统记录写入牌局，因此会触发存档。 */
export function changeDifficulty(state: GuandanState, difficulty: GuandanDifficulty): GuandanState {
  if (state.difficulty === difficulty) return state;
  const notice = action(
    state.revision + 1,
    "table",
    "settings",
    `对手难度调整为「${GUANDAN_DIFFICULTY_NAMES[difficulty]}」。`,
  );
  return appendAction({ ...state, difficulty }, notice);
}

export function getPlayError(state: GuandanState, actorId: PlayerId, cardIds: readonly string[]): string | undefined {
  if (state.status !== "playing") return "本局已经结束。";
  if (state.activePlayerId !== actorId) return "还没有轮到这位玩家。";
  if (cardIds.length === 0) return "先选择要出的牌。";
  const player = getPlayer(state, actorId);
  const ids = new Set(cardIds);
  if (ids.size !== cardIds.length || cardIds.some((id) => !player.hand.some((card) => card.id === id))) return "选牌不属于当前手牌。";
  const selected = player.hand.filter((card) => ids.has(card.id));
  const selectedCombo = classifyCombo(selected, state.levelRank);
  if (!selectedCombo) return "这些牌还不能组成有效牌型。";
  if (!canBeat(selectedCombo, state.trick?.combo)) return `需要跟出更大的${state.trick?.combo.label ?? "牌"}，或使用炸弹。`;
  return undefined;
}

export function playCards(state: GuandanState, actorId: PlayerId, cardIds: readonly string[]): GuandanState {
  if (getPlayError(state, actorId, cardIds)) return state;
  const actor = getPlayer(state, actorId);
  const idSet = new Set(cardIds);
  const selected = actor.hand.filter((card) => idSet.has(card.id));
  const selectedCombo = classifyCombo(selected, state.levelRank)!;
  const remainingHand = actor.hand.filter((card) => !idSet.has(card.id));
  const justFinished = remainingHand.length === 0 && actor.finishedPlace === undefined;
  const finishOrder = justFinished ? [...state.finishOrder, actorId] : state.finishOrder;
  const players = state.players.map((player) => player.id === actorId
    ? { ...player, hand: remainingHand, finishedPlace: justFinished ? finishOrder.length : player.finishedPlace }
    : player,
  );
  // 一队两人都走完即定局；胜方是头游所在队，与谁先走空无关。
  const dealOver = (["vermillion", "indigo"] as const).some((team) =>
    players.filter((player) => player.team === team).every((player) => player.hand.length === 0),
  );
  const winner = dealOver && finishOrder.length > 0
    ? getPlayerFrom(players, finishOrder[0]).team
    : undefined;
  const match = winner ? settleMatch(state.match, winner, finishOrder, players) : state.match;
  const text = justFinished
    ? `${actor.displayName}打出${selectedCombo.label}并收完手牌。`
    : `${actor.displayName}打出${selectedCombo.label}，还剩 ${remainingHand.length} 张。`;
  const nextAction = action(state.revision + 1, actorId, justFinished ? "finish" : "play", text, selectedCombo);

  const played = appendAction({
    ...state,
    status: winner ? "finished" : "playing",
    winner,
    players,
    finishOrder,
    match,
    activePlayerId: winner ? actorId : nextActivePlayerId(players, actorId),
    trick: { actorId, combo: selectedCombo },
    consecutivePasses: 0,
  }, nextAction);

  const result = winner ? match.lastResult : undefined;
  if (!result) return played;
  const summary = match.champion
    ? `${teamName(winner!)}打过 A，赢下整场比赛。`
    : `${teamName(winner!)}${result.partnerPlace <= 2 ? "双下" : "获胜"}，升 ${result.gained} 级至 ${result.toLevel}。`;
  return appendAction(played, action(played.revision + 1, "table", "settle", summary));
}

function settleMatch(
  match: MatchState,
  winner: TeamId,
  finishOrder: readonly PlayerId[],
  players: readonly GuandanPlayer[],
): MatchState {
  const leader = finishOrder[0];
  const partner = players.find((player) => player.team === winner && player.id !== leader);
  const partnerIndex = partner ? finishOrder.indexOf(partner.id) : -1;
  // 没进结算顺序的只可能是最后一个还握着牌的人，也就是末游。
  const partnerPlace = partnerIndex >= 0 ? partnerIndex + 1 : PLAYER_ORDER.length;
  const gained = levelsForPartnerPlace(partnerPlace);
  const fromLevel = match.levels[winner];
  const { level: toLevel, champion } = advanceLevel(fromLevel, gained);

  return {
    levels: { ...match.levels, [winner]: toLevel },
    dealNumber: match.dealNumber,
    attackingTeam: winner,
    champion: champion ? winner : undefined,
    lastResult: { winner, partnerPlace, gained, fromLevel, toLevel, finishOrder },
  };
}

export function canPass(state: GuandanState, actorId: PlayerId): boolean {
  return state.status === "playing" && state.activePlayerId === actorId && Boolean(state.trick);
}

export function passTurn(state: GuandanState, actorId: PlayerId): GuandanState {
  if (!canPass(state, actorId) || !state.trick) return state;
  const actor = getPlayer(state, actorId);
  const passes = state.consecutivePasses + 1;
  const requiredPasses = state.players.filter((player) => player.hand.length > 0 && player.id !== state.trick?.actorId).length;

  if (passes >= requiredPasses) {
    const trickActor = getPlayer(state, state.trick.actorId);
    const leader = trickActor.hand.length > 0 ? trickActor.id : nextActivePlayerId(state.players, trickActor.id);
    return appendAction({
      ...state,
      activePlayerId: leader,
      trick: undefined,
      consecutivePasses: 0,
    }, action(state.revision + 1, actorId, "clear", `${actor.displayName}过牌，牌墩清空。${getPlayer(state, leader).displayName}重新领出。`));
  }

  return appendAction({
    ...state,
    activePlayerId: nextActivePlayerId(state.players, actorId),
    consecutivePasses: passes,
  }, action(state.revision + 1, actorId, "pass", `${actor.displayName}选择过牌。`));
}

export function generateLegalCombos(state: GuandanState, actorId: PlayerId): CardCombo[] {
  const player = getPlayer(state, actorId);
  const target = state.trick?.combo;
  const results: CardCombo[] = [];
  const signatures = new Set<string>();
  const add = (cards: readonly GuandanCard[] | undefined) => {
    if (!cards) return;
    const signature = [...cards].map((card) => card.id).sort().join("|");
    if (signatures.has(signature)) return;
    const candidate = classifyCombo(cards, state.levelRank);
    if (!candidate || !canBeat(candidate, target)) return;
    signatures.add(signature);
    results.push(candidate);
  };

  player.hand.forEach((card) => add([card]));
  for (const rank of [...NUMBER_RANKS, "small-joker", "big-joker"] as const) {
    const exact = player.hand.filter((card) => card.rank === rank && !isWild(card, state.levelRank));
    const wilds = rank === "small-joker" || rank === "big-joker"
      ? []
      : player.hand.filter((card) => isWild(card, state.levelRank));
    const pool = [...exact, ...wilds];
    if (pool.length >= 2) add(pool.slice(0, 2));
    if (pool.length >= 3) add(pool.slice(0, 3));
    if (rank !== "small-joker" && rank !== "big-joker") {
      for (let size = 4; size <= Math.min(pool.length, 10); size += 1) add(pool.slice(0, size));
    }
  }

  for (const tripleRank of NUMBER_RANKS) {
    for (const pairRank of NUMBER_RANKS) {
      if (tripleRank === pairRank) continue;
      const tripleNaturals = player.hand.filter((card) => card.rank === tripleRank && !isWild(card, state.levelRank)).slice(0, 3);
      const pairNaturals = player.hand.filter((card) => card.rank === pairRank && !isWild(card, state.levelRank)).slice(0, 2);
      const deficit = (3 - tripleNaturals.length) + (2 - pairNaturals.length);
      const wilds = player.hand.filter((card) => isWild(card, state.levelRank)).slice(0, deficit);
      if (wilds.length !== deficit) continue;
      add([...tripleNaturals, ...pairNaturals, ...wilds]);
    }
  }

  for (const sequence of STRAIGHT_SEQUENCES) {
    const naturalCards: GuandanCard[] = [];
    for (const rank of sequence) {
      const card = player.hand.find((entry) => entry.rank === rank && !isWild(entry, state.levelRank));
      if (card) naturalCards.push(card);
    }
    const deficit = 5 - naturalCards.length;
    const wilds = player.hand.filter((card) => isWild(card, state.levelRank)).slice(0, deficit);
    if (wilds.length === deficit) add([...naturalCards, ...wilds]);
  }

  const jokers = player.hand.filter((card) => card.suit === "joker");
  if (jokers.length === 4) add(jokers);
  return results;
}

export function teamName(team: TeamId): string {
  return team === "vermillion" ? "朱雀方" : "青岳方";
}
