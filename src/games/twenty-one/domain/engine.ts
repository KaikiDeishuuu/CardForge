import type {
  HandSettlement,
  HandValue,
  InsuranceSettlement,
  PlayerHandState,
  PlayingCard,
  Rank,
  Suit,
  TableEvent,
  TwentyOneAction,
  TwentyOneLegalActions,
  TwentyOneRules,
  TwentyOneSettlement,
  TwentyOneState,
} from "./types";

const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const RANKS: readonly Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const SUIT_NAMES: Record<Suit, string> = {
  spades: "黑桃",
  hearts: "红心",
  diamonds: "方片",
  clubs: "梅花",
};

export const STARTING_CHIPS = 500;
export const BET_STEPS: readonly number[] = [10, 25, 50, 100];

export const DEFAULT_RULES: TwentyOneRules = {
  deckCount: 6,
  dealerSoft17: "stand",
  blackjackPayout: "3:2",
  maxPlayerHands: 4,
  doubleAfterSplit: true,
  resplitAces: false,
  hitSplitAces: false,
  allowInsurance: true,
  allowLateSurrender: true,
};

export const SINGLE_DECK_RULES: TwentyOneRules = {
  ...DEFAULT_RULES,
  deckCount: 1,
  dealerSoft17: "hit",
  maxPlayerHands: 3,
  doubleAfterSplit: false,
  allowLateSurrender: false,
};

export const HIGH_PRESSURE_RULES: TwentyOneRules = {
  ...DEFAULT_RULES,
  deckCount: 8,
  dealerSoft17: "hit",
  blackjackPayout: "6:5",
  maxPlayerHands: 2,
  doubleAfterSplit: false,
  allowLateSurrender: false,
};

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

/** 所有账目以半筹码为最小单位，消除连续结算后的浮点尾差。 */
export function normalizeChips(value: number): number {
  const normalized = Math.round(value * 2) / 2;
  return Object.is(normalized, -0) ? 0 : normalized;
}

/** 一副牌的 card id 带牌副编号，多副牌渲染、日志和存档均不会重键。 */
export function createDeck(deckIndex = 0): PlayingCard[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({
    id: `d${deckIndex}-${suit}-${rank}`,
    name: `${SUIT_NAMES[suit]} ${rank}`,
    suit,
    rank,
  })));
}

export function createShoe(deckCount: TwentyOneRules["deckCount"]): PlayingCard[] {
  return Array.from({ length: deckCount }, (_, deckIndex) => createDeck(deckIndex)).flat();
}

/** 约 75% penetration，并始终为最多四手与庄家留足一副牌的安全缓冲。 */
export function reshuffleThreshold(rules: TwentyOneRules): number {
  return Math.max(52, Math.ceil(rules.deckCount * 52 * 0.25));
}

function rankValue(rank: Rank): number {
  if (rank === "A") return 11;
  if (rank === "J" || rank === "Q" || rank === "K") return 10;
  return Number(rank);
}

export function evaluateHand(hand: readonly PlayingCard[]): HandValue {
  let total = hand.reduce((sum, card) => sum + rankValue(card.rank), 0);
  let softAces = hand.filter((card) => card.rank === "A").length;

  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces -= 1;
  }

  return {
    total,
    soft: softAces > 0,
    blackjack: hand.length === 2 && total === 21,
    busted: total > 21,
  };
}

export function isNaturalBlackjack(hand: PlayerHandState): boolean {
  return !hand.fromSplit && evaluateHand(hand.cards).blackjack;
}

function draw(deck: readonly PlayingCard[]): { card: PlayingCard; deck: PlayingCard[] } {
  const card = deck.at(-1);
  if (!card) throw new Error("Twenty One shoe is empty.");
  return { card, deck: deck.slice(0, -1) };
}

function tableEvent(
  revision: number,
  actor: TableEvent["actor"],
  type: TableEvent["type"],
  text: string,
  options: { readonly card?: PlayingCard; readonly handId?: string } = {},
): TableEvent {
  return { id: revision, actor, type, text, ...options };
}

function appendEvent(state: TwentyOneState, nextEvent: TableEvent): TwentyOneState {
  return {
    ...state,
    revision: nextEvent.id,
    lastEvent: nextEvent,
    log: [...state.log, nextEvent].slice(-20),
  };
}

function withEvent(
  state: TwentyOneState,
  actor: TableEvent["actor"],
  type: TableEvent["type"],
  text: string,
  options?: { readonly card?: PlayingCard; readonly handId?: string },
): TwentyOneState {
  return appendEvent(state, tableEvent(state.revision + 1, actor, type, text, options));
}

export function getActiveHand(state: TwentyOneState): PlayerHandState | undefined {
  return state.activeHandIndex === null ? undefined : state.hands[state.activeHandIndex];
}

function replaceHand(state: TwentyOneState, index: number, hand: PlayerHandState): TwentyOneState {
  return {
    ...state,
    hands: state.hands.map((entry, handIndex) => handIndex === index ? hand : entry),
  };
}

function blackjackProfitRatio(rules: TwentyOneRules): number {
  return rules.blackjackPayout === "3:2" ? 1.5 : 1.2;
}

function handResult(
  hand: PlayerHandState,
  dealerValue: HandValue,
  dealerBlackjack: boolean,
  rules: TwentyOneRules,
): HandSettlement {
  const value = evaluateHand(hand.cards);
  let outcome: HandSettlement["outcome"];
  let returned = 0;
  let reason: string;

  if (hand.status === "surrendered") {
    outcome = "surrender";
    returned = hand.wager / 2;
    reason = "迟投降，退回一半主注";
  } else if (value.busted || hand.status === "busted") {
    outcome = "loss";
    reason = `爆牌（${value.total} 点）`;
  } else if (isNaturalBlackjack(hand) && dealerBlackjack) {
    outcome = "push";
    returned = hand.wager;
    reason = "双方 Blackjack";
  } else if (isNaturalBlackjack(hand)) {
    outcome = "blackjack";
    returned = hand.wager * (1 + blackjackProfitRatio(rules));
    reason = `Blackjack ${rules.blackjackPayout}`;
  } else if (dealerBlackjack) {
    outcome = "loss";
    reason = "庄家 Blackjack";
  } else if (dealerValue.busted) {
    outcome = "win";
    returned = hand.wager * 2;
    reason = "庄家爆牌";
  } else if (value.total > dealerValue.total) {
    outcome = "win";
    returned = hand.wager * 2;
    reason = `${value.total} 对 ${dealerValue.total}`;
  } else if (dealerValue.total > value.total) {
    outcome = "loss";
    reason = `${value.total} 对 ${dealerValue.total}`;
  } else {
    outcome = "push";
    returned = hand.wager;
    reason = `同为 ${value.total} 点`;
  }

  const normalizedReturn = normalizeChips(returned);
  return {
    handId: hand.id,
    outcome,
    wager: hand.wager,
    returned: normalizedReturn,
    net: normalizeChips(normalizedReturn - hand.wager),
    reason,
  };
}

function insuranceResult(state: TwentyOneState, dealerBlackjack: boolean): InsuranceSettlement {
  const wager = state.insurance.wager;
  if (wager > 0) {
    const returned = dealerBlackjack ? normalizeChips(wager * 3) : 0;
    return {
      status: dealerBlackjack ? "won" : "lost",
      wager,
      returned,
      net: normalizeChips(returned - wager),
    };
  }
  return {
    status: state.insurance.status === "declined" ? "declined" : "not-offered",
    wager: 0,
    returned: 0,
    net: 0,
  };
}

function settlementReason(
  handResults: readonly HandSettlement[],
  insurance: InsuranceSettlement,
  dealerValue: HandValue,
  net: number,
): string {
  if (handResults.length === 1 && insurance.wager > 0) {
    if (net === 0 && insurance.net > 0) return "保险赔付抵消了主注损失";
    if (net > 0 && insurance.net < 0) return `${handResults[0].reason}，扣除保险后仍有净收益`;
    if (net < 0 && insurance.net < 0) return `${handResults[0].reason}，保险损失后本轮净亏`;
    return `${handResults[0].reason}，计入保险后完成结算`;
  }
  if (handResults.length === 1) return handResults[0].reason;
  if (dealerValue.busted) return "庄家爆牌，多手统一结算";
  if (net > 0) return "多手结算后取得净收益";
  if (net < 0) return "多手结算后产生净损失";
  return "多手盈亏相抵";
}

function settleRound(state: TwentyOneState): TwentyOneState {
  if (state.phase === "settled" && state.settlement) return state;
  const dealerValue = evaluateHand(state.dealerHand);
  const dealerBlackjack = dealerValue.blackjack;
  const handResults = state.hands.map((hand) => handResult(hand, dealerValue, dealerBlackjack, state.rules));
  const insurance = insuranceResult(state, dealerBlackjack);
  const totalWagered = normalizeChips(
    handResults.reduce((sum, result) => sum + result.wager, 0) + insurance.wager,
  );
  const returned = normalizeChips(
    handResults.reduce((sum, result) => sum + result.returned, 0) + insurance.returned,
  );
  const net = normalizeChips(returned - totalWagered);
  const outcome: TwentyOneSettlement["outcome"] = net > 0 ? "player" : net < 0 ? "dealer" : "push";
  const reason = settlementReason(handResults, insurance, dealerValue, net);
  const settlement: TwentyOneSettlement = {
    outcome,
    handResults,
    insurance,
    totalWagered,
    returned,
    net,
    reason,
  };

  return withEvent({
    ...state,
    phase: "settled",
    dealerRevealed: true,
    activeHandIndex: null,
    chips: normalizeChips(state.chips + returned),
    insurance: { status: insurance.status, wager: insurance.wager },
    settlement,
  }, "table", "settle", `${reason}，本轮净输赢 ${net > 0 ? "+" : ""}${net}。`);
}

function dealerUpcardCanBlackjack(state: TwentyOneState): boolean {
  const rank = state.dealerHand[0]?.rank;
  return rank === "A" || (rank !== undefined && rankValue(rank) === 10);
}

function resolveOpening(state: TwentyOneState): TwentyOneState {
  const dealerBlackjack = dealerUpcardCanBlackjack(state) && evaluateHand(state.dealerHand).blackjack;
  const insurance = state.insurance.wager > 0
    ? { ...state.insurance, status: dealerBlackjack ? "won" as const : "lost" as const }
    : state.insurance;
  const checked = { ...state, insurance };
  const firstHand = checked.hands[0];

  if (dealerBlackjack || (firstHand !== undefined && isNaturalBlackjack(firstHand))) {
    return settleRound(checked);
  }
  return {
    ...checked,
    phase: "player-turn",
    activeHandIndex: 0,
  };
}

function freshRoundState(
  state: TwentyOneState,
  handNumber: number,
  deck: readonly PlayingCard[] = state.deck,
): TwentyOneState {
  return {
    ...state,
    phase: "betting",
    deck,
    dealerHand: [],
    dealerRevealed: false,
    hands: [],
    activeHandIndex: null,
    baseBet: 0,
    insurance: { status: "not-offered", wager: 0 },
    settlement: undefined,
    handNumber,
  };
}

export function createInitialState(
  random: () => number = Math.random,
  rules: TwentyOneRules = DEFAULT_RULES,
  chips = STARTING_CHIPS,
): TwentyOneState {
  return {
    revision: 0,
    phase: "betting",
    rules: { ...rules },
    deck: shuffled(createShoe(rules.deckCount), random),
    dealerHand: [],
    dealerRevealed: false,
    hands: [],
    activeHandIndex: null,
    baseBet: 0,
    insurance: { status: "not-offered", wager: 0 },
    chips: normalizeChips(Math.max(0, chips)),
    handNumber: 1,
    log: [tableEvent(0, "table", "deal", "牌靴已洗好。先决定这一手压多少。")],
  };
}

export function availableBets(state: TwentyOneState): readonly number[] {
  return BET_STEPS.filter((amount) => amount <= state.chips);
}

function canHit(state: TwentyOneState): boolean {
  const hand = getActiveHand(state);
  return state.phase === "player-turn"
    && hand?.status === "playing"
    && (!hand.splitAces || state.rules.hitSplitAces);
}

export function canDouble(state: TwentyOneState): boolean {
  const hand = getActiveHand(state);
  return state.phase === "player-turn"
    && hand?.status === "playing"
    && hand.cards.length === 2
    && !hand.doubled
    && state.chips >= hand.wager
    && (!hand.fromSplit || state.rules.doubleAfterSplit)
    && (!hand.splitAces || state.rules.hitSplitAces);
}

export function canSplit(state: TwentyOneState): boolean {
  const hand = getActiveHand(state);
  if (state.phase !== "player-turn" || hand?.status !== "playing" || hand.cards.length !== 2) return false;
  if (state.hands.length >= state.rules.maxPlayerHands || state.chips < hand.wager) return false;
  if (rankValue(hand.cards[0].rank) !== rankValue(hand.cards[1].rank)) return false;
  return hand.cards[0].rank !== "A" || !hand.fromSplit || state.rules.resplitAces;
}

export function canSurrender(state: TwentyOneState): boolean {
  const hand = getActiveHand(state);
  return state.phase === "player-turn"
    && state.rules.allowLateSurrender
    && state.hands.length === 1
    && state.activeHandIndex === 0
    && hand?.status === "playing"
    && !hand.fromSplit
    && !hand.doubled
    && hand.cards.length === 2;
}

export function insuranceCost(state: TwentyOneState): number {
  return normalizeChips(state.baseBet / 2);
}

export function legalActions(state: TwentyOneState): TwentyOneLegalActions {
  const hand = getActiveHand(state);
  const playerCanStand = state.phase === "player-turn" && hand?.status === "playing";
  const cost = insuranceCost(state);
  return {
    bets: state.phase === "betting" ? availableBets(state) : [],
    takeInsurance: state.phase === "insurance" && state.insurance.status === "offered" && cost > 0 && state.chips >= cost,
    declineInsurance: state.phase === "insurance" && state.insurance.status === "offered",
    hit: canHit(state),
    stand: playerCanStand,
    double: canDouble(state),
    split: canSplit(state),
    surrender: canSurrender(state),
    dealerStep: state.phase === "dealer-turn",
    nextHand: state.phase === "settled",
    configureRules: state.phase === "betting",
  };
}

/** 下注即发牌：玩家两张明牌，庄家一明一暗。 */
export function placeBet(
  state: TwentyOneState,
  amount: number,
  random: () => number = Math.random,
): TwentyOneState {
  if (state.phase !== "betting" || !BET_STEPS.includes(amount) || amount > state.chips) return state;

  let deck: readonly PlayingCard[] = state.deck.length < reshuffleThreshold(state.rules)
    ? shuffled(createShoe(state.rules.deckCount), random)
    : state.deck;
  const playerCards: PlayingCard[] = [];
  const dealerHand: PlayingCard[] = [];
  for (let round = 0; round < 2; round += 1) {
    const playerDraw = draw(deck);
    playerCards.push(playerDraw.card);
    deck = playerDraw.deck;
    const dealerDraw = draw(deck);
    dealerHand.push(dealerDraw.card);
    deck = dealerDraw.deck;
  }

  const hand: PlayerHandState = {
    id: `h${state.handNumber}-0`,
    cards: playerCards,
    wager: amount,
    status: "playing",
    fromSplit: false,
    splitAces: false,
    doubled: false,
  };
  const dealt = withEvent({
    ...state,
    phase: "player-turn",
    deck,
    dealerHand,
    dealerRevealed: false,
    hands: [hand],
    activeHandIndex: 0,
    baseBet: amount,
    insurance: { status: "not-offered", wager: 0 },
    settlement: undefined,
    chips: normalizeChips(state.chips - amount),
  }, "player", "bet", `你压下 ${amount} 枚筹码。`, { handId: hand.id });

  const insuranceOffered = dealt.rules.allowInsurance && dealt.dealerHand[0]?.rank === "A";
  if (insuranceOffered) {
    return withEvent({
      ...dealt,
      phase: "insurance",
      activeHandIndex: null,
      insurance: { status: "offered", wager: 0 },
    }, "table", "insurance", `庄家明牌为 A，可用 ${insuranceCost(dealt)} 枚筹码购买保险。`);
  }
  return resolveOpening(dealt);
}

export function takeInsurance(state: TwentyOneState): TwentyOneState {
  if (!legalActions(state).takeInsurance) return state;
  const wager = insuranceCost(state);
  const insured = withEvent({
    ...state,
    chips: normalizeChips(state.chips - wager),
    insurance: { status: "offered", wager },
  }, "player", "insurance", `你用 ${wager} 枚筹码购买保险。`);
  return resolveOpening(insured);
}

export function declineInsurance(state: TwentyOneState): TwentyOneState {
  if (!legalActions(state).declineInsurance) return state;
  const declined = withEvent({
    ...state,
    insurance: { status: "declined", wager: 0 },
  }, "player", "insurance", "你放弃保险，庄家检查底牌。");
  return resolveOpening(declined);
}

function startDealerOrSettle(state: TwentyOneState): TwentyOneState {
  if (state.hands.every((hand) => hand.status === "busted" || hand.status === "surrendered")) {
    return settleRound(state);
  }
  return withEvent({
    ...state,
    phase: "dealer-turn",
    activeHandIndex: null,
    dealerRevealed: true,
  }, "table", "reveal", "所有玩家手牌已完成，庄家翻开底牌。");
}

function activateNextHand(state: TwentyOneState, startIndex: number): TwentyOneState {
  const hands = [...state.hands];
  for (let index = startIndex; index < hands.length; index += 1) {
    const hand = hands[index];
    if (hand.status !== "playing") continue;
    if (!hand.splitAces || state.rules.hitSplitAces) {
      return { ...state, hands, activeHandIndex: index };
    }

    const pairOfAces = hand.cards.length === 2 && hand.cards.every((card) => card.rank === "A");
    const canResplit = pairOfAces
      && state.rules.resplitAces
      && hands.length < state.rules.maxPlayerHands
      && state.chips >= hand.wager;
    if (canResplit) return { ...state, hands, activeHandIndex: index };

    // 分 A 后只补一张；若此刻已不能再分，领域层直接完成该手。
    hands[index] = { ...hand, status: "stood" };
  }
  return startDealerOrSettle({ ...state, hands, activeHandIndex: null });
}

function advanceAfterHand(state: TwentyOneState, currentIndex: number): TwentyOneState {
  return activateNextHand(state, currentIndex + 1);
}

export function playerHit(state: TwentyOneState): TwentyOneState {
  if (!legalActions(state).hit || state.activeHandIndex === null) return state;
  const index = state.activeHandIndex;
  const hand = state.hands[index];
  const nextDraw = draw(state.deck);
  const cards = [...hand.cards, nextDraw.card];
  const value = evaluateHand(cards);
  const status: PlayerHandState["status"] = value.busted ? "busted" : value.total === 21 ? "stood" : "playing";
  const nextHand = { ...hand, cards, status };
  const hit = withEvent(replaceHand({ ...state, deck: nextDraw.deck }, index, nextHand), "player", "hit", `手牌 ${index + 1} 取得「${nextDraw.card.name}」。`, {
    card: nextDraw.card,
    handId: hand.id,
  });
  return status === "playing" ? hit : advanceAfterHand(hit, index);
}

export function playerStand(state: TwentyOneState): TwentyOneState {
  if (!legalActions(state).stand || state.activeHandIndex === null) return state;
  const index = state.activeHandIndex;
  const hand = state.hands[index];
  const stood = withEvent(
    replaceHand(state, index, { ...hand, status: "stood" }),
    "player",
    "stand",
    `手牌 ${index + 1} 停在 ${evaluateHand(hand.cards).total} 点。`,
    { handId: hand.id },
  );
  return advanceAfterHand(stood, index);
}

/** 加倍：再托管等额筹码，只补一张并完成当前手。 */
export function playerDouble(state: TwentyOneState): TwentyOneState {
  if (!legalActions(state).double || state.activeHandIndex === null) return state;
  const index = state.activeHandIndex;
  const hand = state.hands[index];
  const nextDraw = draw(state.deck);
  const cards = [...hand.cards, nextDraw.card];
  const status: PlayerHandState["status"] = evaluateHand(cards).busted ? "busted" : "stood";
  const doubled: PlayerHandState = {
    ...hand,
    cards,
    wager: normalizeChips(hand.wager * 2),
    status,
    doubled: true,
  };
  const next = withEvent(replaceHand({
    ...state,
    deck: nextDraw.deck,
    chips: normalizeChips(state.chips - hand.wager),
  }, index, doubled), "player", "double", `手牌 ${index + 1} 加倍并取得「${nextDraw.card.name}」。`, {
    card: nextDraw.card,
    handId: hand.id,
  });
  return advanceAfterHand(next, index);
}

function splitChildStatus(
  cards: readonly PlayingCard[],
  splitAces: boolean,
  rules: TwentyOneRules,
  canAffordResplit: boolean,
): PlayerHandState["status"] {
  if (evaluateHand(cards).total === 21) return "stood";
  if (!splitAces || rules.hitSplitAces) return "playing";
  const pairOfAces = cards.length === 2 && cards.every((card) => card.rank === "A");
  return pairOfAces && rules.resplitAces && canAffordResplit ? "playing" : "stood";
}

export function playerSplit(state: TwentyOneState): TwentyOneState {
  if (!legalActions(state).split || state.activeHandIndex === null) return state;
  const index = state.activeHandIndex;
  const hand = state.hands[index];
  const firstDraw = draw(state.deck);
  const secondDraw = draw(firstDraw.deck);
  const splitAces = hand.cards[0].rank === "A";
  const handsAfterSplit = state.hands.length + 1;
  const chipsAfterSplit = normalizeChips(state.chips - hand.wager);
  const canAffordResplit = handsAfterSplit < state.rules.maxPlayerHands && chipsAfterSplit >= hand.wager;
  const firstCards = [hand.cards[0], firstDraw.card];
  const secondCards = [hand.cards[1], secondDraw.card];
  const idStem = `${hand.id}.${state.revision + 1}`;
  const firstHand: PlayerHandState = {
    id: `${idStem}a`,
    cards: firstCards,
    wager: hand.wager,
    status: splitChildStatus(firstCards, splitAces, state.rules, canAffordResplit),
    fromSplit: true,
    splitAces,
    doubled: false,
  };
  const secondHand: PlayerHandState = {
    id: `${idStem}b`,
    cards: secondCards,
    wager: hand.wager,
    status: splitChildStatus(secondCards, splitAces, state.rules, canAffordResplit),
    fromSplit: true,
    splitAces,
    doubled: false,
  };
  const hands = [...state.hands];
  hands.splice(index, 1, firstHand, secondHand);
  const split = withEvent({
    ...state,
    deck: secondDraw.deck,
    hands,
    activeHandIndex: index,
    chips: chipsAfterSplit,
  }, "player", "split", `手牌 ${index + 1} 分为两手，并追加等额下注 ${hand.wager}。`, { handId: hand.id });
  return activateNextHand(split, index);
}

export function playerSurrender(state: TwentyOneState): TwentyOneState {
  if (!legalActions(state).surrender || state.activeHandIndex === null) return state;
  const index = state.activeHandIndex;
  const hand = state.hands[index];
  const surrendered = withEvent(
    replaceHand(state, index, { ...hand, status: "surrendered" }),
    "player",
    "surrender",
    `你选择迟投降，手牌 ${index + 1} 退回一半主注。`,
    { handId: hand.id },
  );
  return settleRound(surrendered);
}

function dealerShouldHit(state: TwentyOneState): boolean {
  const value = evaluateHand(state.dealerHand);
  return value.total < 17 || (value.total === 17 && value.soft && state.rules.dealerSoft17 === "hit");
}

export function dealerStep(state: TwentyOneState): TwentyOneState {
  if (!legalActions(state).dealerStep) return state;
  if (!dealerShouldHit(state)) return settleRound(state);

  const nextDraw = draw(state.deck);
  const dealerHand = [...state.dealerHand, nextDraw.card];
  return withEvent({ ...state, deck: nextDraw.deck, dealerHand }, "dealer", "hit", `庄家取得「${nextDraw.card.name}」。`, {
    card: nextDraw.card,
  });
}

/** 结算后开下一手：保留规则、筹码与牌靴。 */
export function nextHand(state: TwentyOneState): TwentyOneState {
  if (!legalActions(state).nextHand) return state;
  const handNumber = state.handNumber + 1;
  return withEvent(
    freshRoundState(state, handNumber),
    "table",
    "deal",
    `第 ${handNumber} 手。牌靴剩余 ${state.deck.length} 张。`,
  );
}

export function configureRules(
  state: TwentyOneState,
  rules: TwentyOneRules,
  random: () => number = Math.random,
): TwentyOneState {
  if (!legalActions(state).configureRules) return state;
  const configured = freshRoundState({
    ...state,
    rules: { ...rules },
  }, 1, shuffled(createShoe(rules.deckCount), random));
  return withEvent(configured, "table", "rules", `房规已应用，换入 ${rules.deckCount} 副新牌靴。`);
}

export function transition(
  state: TwentyOneState,
  action: TwentyOneAction,
  random: () => number = Math.random,
): TwentyOneState {
  switch (action.type) {
    case "place-bet": return placeBet(state, action.amount, random);
    case "take-insurance": return takeInsurance(state);
    case "decline-insurance": return declineInsurance(state);
    case "hit": return playerHit(state);
    case "stand": return playerStand(state);
    case "double": return playerDouble(state);
    case "split": return playerSplit(state);
    case "surrender": return playerSurrender(state);
    case "dealer-step": return dealerStep(state);
    case "next-hand": return nextHand(state);
    case "configure-rules": return configureRules(state, action.rules, random);
  }
}
