import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  HIGH_PRESSURE_RULES,
  SINGLE_DECK_RULES,
  STARTING_CHIPS,
  availableBets,
  canDouble,
  canSplit,
  canSurrender,
  configureRules,
  createDeck,
  createInitialState,
  createShoe,
  dealerStep,
  declineInsurance,
  evaluateHand,
  getActiveHand,
  legalActions,
  nextHand,
  normalizeChips,
  placeBet,
  playerDouble,
  playerHit,
  playerSplit,
  playerStand,
  playerSurrender,
  reshuffleThreshold,
  takeInsurance,
  transition,
} from "./engine";
import type { PlayerHandState, PlayingCard, Rank, Suit, TwentyOneRules, TwentyOneState } from "./types";

const TEST_RULES: TwentyOneRules = {
  ...DEFAULT_RULES,
  deckCount: 1,
};

let cardId = 0;
function card(rank: Rank, suit: Suit = "spades"): PlayingCard {
  cardId += 1;
  return { id: `test-${cardId}-${suit}-${rank}`, name: `${suit} ${rank}`, rank, suit };
}

function hand(
  cards: readonly PlayingCard[],
  overrides: Partial<PlayerHandState> = {},
): PlayerHandState {
  return {
    id: `hand-${cardId}`,
    cards,
    wager: 25,
    status: "playing",
    fromSplit: false,
    splitAces: false,
    doubled: false,
    ...overrides,
  };
}

function state(overrides: Partial<TwentyOneState> = {}): TwentyOneState {
  return {
    ...createInitialState(() => 0.37, TEST_RULES, 200),
    phase: "player-turn",
    deck: [card("5", "clubs"), card("4", "diamonds"), card("3", "hearts")],
    dealerHand: [card("10", "clubs"), card("6", "diamonds")],
    hands: [hand([card("10"), card("6", "hearts")])],
    activeHandIndex: 0,
    baseBet: 25,
    chips: 175,
    ...overrides,
  };
}

/** draw 从末尾取；前置一副不同编号的垫牌，避免测试牌靴触发换靴。 */
function stackedDeck(...drawOrder: readonly PlayingCard[]): PlayingCard[] {
  return [...createDeck(99), ...[...drawOrder].reverse()];
}

function initialWithCards(
  drawOrder: readonly PlayingCard[],
  rules: TwentyOneRules = TEST_RULES,
  chips = 200,
): TwentyOneState {
  return {
    ...createInitialState(() => 0.37, rules, chips),
    deck: stackedDeck(...drawOrder),
  };
}

function settleDealer(stateToSettle: TwentyOneState): TwentyOneState {
  let current = stateToSettle;
  for (let step = 0; step < 12 && current.phase === "dealer-turn"; step += 1) {
    current = dealerStep(current);
  }
  return current;
}

describe("Twenty One engine", () => {
  it("creates unique card ids in the default six-deck shoe", () => {
    expect(createDeck()).toHaveLength(52);
    const shoe = createShoe(6);
    expect(shoe).toHaveLength(312);
    expect(new Set(shoe.map((entry) => entry.id)).size).toBe(312);

    const initial = createInitialState(() => 0.37);
    expect(initial.rules).toEqual(DEFAULT_RULES);
    expect(initial.deck).toHaveLength(312);
    expect(initial.phase).toBe("betting");
    expect(initial.hands).toEqual([]);
    expect(initial.chips).toBe(STARTING_CHIPS);
  });

  it("exports coherent single-deck and high-pressure presets", () => {
    expect(SINGLE_DECK_RULES).toMatchObject({
      deckCount: 1,
      dealerSoft17: "hit",
      blackjackPayout: "3:2",
      maxPlayerHands: 3,
      doubleAfterSplit: false,
      allowInsurance: true,
      allowLateSurrender: false,
    });
    expect(HIGH_PRESSURE_RULES).toMatchObject({
      deckCount: 8,
      dealerSoft17: "hit",
      blackjackPayout: "6:5",
      maxPlayerHands: 2,
      allowLateSurrender: false,
    });
  });

  it("scores aces and distinguishes a physical two-card 21", () => {
    expect(evaluateHand([card("A"), card("K")])).toEqual({ total: 21, soft: true, blackjack: true, busted: false });
    expect(evaluateHand([card("A"), card("9"), card("8")])).toMatchObject({ total: 18, soft: false, busted: false });
    expect(evaluateHand([card("K"), card("Q"), card("2")]).busted).toBe(true);
  });

  it("deals one player hand, escrows a legal bet and rejects illegal bets", () => {
    const dealt = placeBet(initialWithCards([card("10"), card("6"), card("7"), card("10", "clubs")]), 25);
    expect(dealt.phase).toBe("player-turn");
    expect(dealt.hands).toHaveLength(1);
    expect(dealt.hands[0].cards).toHaveLength(2);
    expect(dealt.dealerHand).toHaveLength(2);
    expect(dealt.baseBet).toBe(25);
    expect(dealt.hands[0].wager).toBe(25);
    expect(dealt.chips).toBe(175);

    const initial = createInitialState(() => 0.37, TEST_RULES);
    expect(placeBet(initial, 0)).toBe(initial);
    expect(placeBet(initial, 37)).toBe(initial);
    expect(placeBet(initial, STARTING_CHIPS + 10)).toBe(initial);
    expect(availableBets({ ...initial, chips: 30 })).toEqual([10, 25]);
  });

  it("reshuffles at a deck-count-aware cut card", () => {
    expect(reshuffleThreshold(TEST_RULES)).toBe(52);
    expect(reshuffleThreshold(DEFAULT_RULES)).toBe(78);
    const thin = { ...createInitialState(() => 0.37, TEST_RULES), deck: createDeck().slice(0, 19) };
    const dealt = placeBet(thin, 25, () => 0.37);
    expect(dealt.deck).toHaveLength(48);
  });

  it("pays natural Blackjack at 3:2 or 6:5 without losing half chips", () => {
    const cards = [card("A"), card("6"), card("K"), card("10", "clubs")];
    const classic = placeBet(initialWithCards(cards), 25);
    expect(classic.phase).toBe("settled");
    expect(classic.settlement?.handResults[0].outcome).toBe("blackjack");
    expect(classic.settlement?.net).toBe(37.5);
    expect(classic.chips).toBe(237.5);

    const sixToFiveRules = { ...TEST_RULES, blackjackPayout: "6:5" as const };
    const sixToFive = placeBet(initialWithCards([
      card("A"), card("6"), card("K"), card("10", "clubs"),
    ], sixToFiveRules), 25);
    expect(sixToFive.settlement?.net).toBe(30);
    expect(sixToFive.chips).toBe(230);
    expect(normalizeChips(37.499999999)).toBe(37.5);
  });

  it("peeks under a ten-value upcard and settles a dealer natural", () => {
    const settled = placeBet(initialWithCards([
      card("9"), card("K", "clubs"), card("7"), card("A", "clubs"),
    ]), 25);
    expect(settled.phase).toBe("settled");
    expect(settled.settlement?.outcome).toBe("dealer");
    expect(settled.settlement?.handResults[0].reason).toBe("庄家 Blackjack");
    expect(settled.chips).toBe(175);
  });

  it("offers half-bet insurance on an ace and pays it at 2:1 profit", () => {
    const offered = placeBet(initialWithCards([
      card("9"), card("A", "clubs"), card("8"), card("K", "clubs"),
    ]), 25);
    expect(offered.phase).toBe("insurance");
    expect(legalActions(offered)).toMatchObject({ takeInsurance: true, declineInsurance: true });

    const insured = takeInsurance(offered);
    expect(insured.phase).toBe("settled");
    expect(insured.insurance).toEqual({ status: "won", wager: 12.5 });
    expect(insured.settlement?.insurance).toEqual({ status: "won", wager: 12.5, returned: 37.5, net: 25 });
    expect(insured.settlement?.handResults[0].net).toBe(-25);
    expect(insured.settlement?.totalWagered).toBe(37.5);
    expect(insured.settlement?.net).toBe(0);
    expect(insured.settlement?.reason).toBe("保险赔付抵消了主注损失");
    expect(insured.chips).toBe(200);
  });

  it("declines insurance or records its loss before normal player action", () => {
    const dealerNatural = placeBet(initialWithCards([
      card("9"), card("A", "clubs"), card("8"), card("K", "clubs"),
    ]), 25);
    const declined = declineInsurance(dealerNatural);
    expect(declined.phase).toBe("settled");
    expect(declined.settlement?.insurance.status).toBe("declined");
    expect(declined.settlement?.net).toBe(-25);

    const noNatural = placeBet(initialWithCards([
      card("10"), card("A", "clubs"), card("7"), card("6", "clubs"),
    ]), 25);
    const insured = takeInsurance(noNatural);
    expect(insured.phase).toBe("player-turn");
    expect(insured.insurance).toEqual({ status: "lost", wager: 12.5 });
    expect(insured.chips).toBe(162.5);
    const settled = settleDealer(playerStand(insured));
    expect(settled.settlement?.handResults[0].outcome).toBe("push");
    expect(settled.settlement?.insurance.net).toBe(-12.5);
    expect(settled.settlement?.reason).toBe("同为 17 点，保险损失后本轮净亏");
    expect(settled.chips).toBe(187.5);
  });

  it("still presents insurance when unaffordable and allows an explicit decline", () => {
    const cannotInsure = placeBet(initialWithCards([
      card("9"), card("A", "clubs"), card("8"), card("6", "clubs"),
    ], TEST_RULES, 25), 25);
    expect(cannotInsure.phase).toBe("insurance");
    expect(legalActions(cannotInsure)).toMatchObject({ takeInsurance: false, declineInsurance: true });
    const declinedWithoutFunds = declineInsurance(cannotInsure);
    expect(declinedWithoutFunds.phase).toBe("player-turn");
    expect(declinedWithoutFunds.insurance.status).toBe("declined");
  });

  it("resolves both-natural pushes when insurance is disabled", () => {
    const bothNatural = placeBet(initialWithCards([
      card("A"), card("A", "clubs"), card("K"), card("K", "clubs"),
    ], { ...TEST_RULES, allowInsurance: false }), 25);
    expect(bothNatural.settlement?.outcome).toBe("push");
    expect(bothNatural.chips).toBe(200);
  });

  it("allows late surrender only before the original hand acts", () => {
    const dealt = placeBet(initialWithCards([
      card("10"), card("6", "clubs"), card("6"), card("10", "clubs"),
    ]), 25);
    expect(canSurrender(dealt)).toBe(true);
    const surrendered = playerSurrender(dealt);
    expect(surrendered.phase).toBe("settled");
    expect(surrendered.settlement?.handResults[0]).toMatchObject({ outcome: "surrender", returned: 12.5, net: -12.5 });
    expect(surrendered.chips).toBe(187.5);

    const afterHit = playerHit(placeBet(initialWithCards([
      card("6"), card("6", "clubs"), card("6"), card("10", "clubs"), card("2"),
    ]), 25));
    expect(canSurrender(afterHit)).toBe(false);
    expect(playerSurrender(afterHit)).toBe(afterHit);
    expect(canSurrender({ ...dealt, rules: { ...dealt.rules, allowLateSurrender: false } })).toBe(false);
  });

  it("splits equal-value ten cards, escrows a matching wager and advances hands", () => {
    const dealt = placeBet(initialWithCards([
      card("10"), card("6", "clubs"), card("K"), card("10", "clubs"), card("K", "hearts"), card("3"),
    ]), 25);
    expect(canSplit(dealt)).toBe(true);
    const split = playerSplit(dealt);
    expect(split.hands).toHaveLength(2);
    expect(split.hands.map((entry) => entry.cards.map((entryCard) => entryCard.rank))).toEqual([["10", "K"], ["K", "3"]]);
    expect(split.hands.every((entry) => entry.fromSplit && entry.wager === 25)).toBe(true);
    expect(split.chips).toBe(150);
    expect(split.activeHandIndex).toBe(0);

    const stood = playerStand(split);
    expect(stood.activeHandIndex).toBe(1);
    expect(getActiveHand(stood)?.id).toBe(stood.hands[1].id);
  });

  it("enforces split bankroll, hand cap and double-after-split rules", () => {
    const pair = state({
      hands: [hand([card("8"), card("8", "hearts")])],
      chips: 24,
    });
    expect(canSplit(pair)).toBe(false);
    expect(canSplit({ ...pair, chips: 100, rules: { ...pair.rules, maxPlayerHands: 1 } })).toBe(false);

    const dealt = placeBet(initialWithCards([
      card("8"), card("6", "clubs"), card("8", "hearts"), card("10", "clubs"), card("3"), card("2"),
    ], { ...TEST_RULES, doubleAfterSplit: false }), 25);
    const split = playerSplit(dealt);
    expect(canDouble(split)).toBe(false);
    expect(canDouble({ ...split, rules: { ...split.rules, doubleAfterSplit: true } })).toBe(true);
  });

  it("settles split hands independently and conserves funds through a double", () => {
    const dealt = placeBet(initialWithCards([
      card("8"), card("6", "clubs"), card("8", "hearts"), card("10", "clubs"),
      card("K"), card("3"), card("10", "hearts"), card("5", "diamonds"),
    ]), 25);
    let current = playerSplit(dealt);
    current = playerStand(current); // 18
    current = playerDouble(current); // 11 -> 21, wager 50
    expect(current.phase).toBe("dealer-turn");
    current = settleDealer(current); // dealer 16 -> 21

    expect(current.phase).toBe("settled");
    expect(current.settlement?.handResults.map((result) => result.outcome)).toEqual(["loss", "push"]);
    expect(current.settlement).toMatchObject({ totalWagered: 75, returned: 50, net: -25 });
    expect(current.chips).toBe(175);
    expect(current.chips).toBe(200 + (current.settlement?.net ?? 0));
  });

  it("never pays split twenty-one as natural Blackjack", () => {
    const dealt = placeBet(initialWithCards([
      card("A"), card("10", "clubs"), card("A", "hearts"), card("10", "diamonds"), card("K"), card("K", "hearts"),
    ]), 25);
    let current = playerSplit(dealt);
    expect(current.phase).toBe("dealer-turn");
    current = settleDealer(current);
    expect(current.settlement?.handResults.map((result) => result.outcome)).toEqual(["win", "win"]);
    expect(current.settlement?.handResults.map((result) => result.returned)).toEqual([50, 50]);
    expect(current.settlement?.net).toBe(50);
  });

  it("stands split aces after one card unless hit or resplit rules permit more", () => {
    const baseCards = [
      card("A"), card("6", "clubs"), card("A", "hearts"), card("10", "diamonds"), card("5"), card("6", "hearts"),
    ];
    const stood = playerSplit(placeBet(initialWithCards(baseCards), 25));
    expect(stood.hands.map((entry) => entry.status)).toEqual(["stood", "stood"]);
    expect(stood.phase).toBe("dealer-turn");

    const hittableRules = { ...TEST_RULES, hitSplitAces: true };
    const hittable = playerSplit(placeBet(initialWithCards([
      card("A"), card("6", "clubs"), card("A", "hearts"), card("10", "diamonds"), card("5"), card("6", "hearts"),
    ], hittableRules), 25));
    expect(hittable.phase).toBe("player-turn");
    expect(legalActions(hittable).hit).toBe(true);

    const resplitRules = { ...TEST_RULES, resplitAces: true };
    const resplittable = playerSplit(placeBet(initialWithCards([
      card("A"), card("6", "clubs"), card("A", "hearts"), card("10", "diamonds"), card("A", "diamonds"), card("6", "hearts"),
    ], resplitRules), 25));
    expect(resplittable.hands[0].cards.every((entry) => entry.rank === "A")).toBe(true);
    expect(legalActions(resplittable).split).toBe(true);
  });

  it("auto-stands a pending split-ace hand once a resplit reaches the hand cap", () => {
    const cappedRules = { ...TEST_RULES, maxPlayerHands: 3 as const, resplitAces: true };
    let current = playerSplit(placeBet(initialWithCards([
      card("A"), card("6", "clubs"), card("A", "hearts"), card("10", "diamonds"),
      card("A", "diamonds"), card("A", "clubs"), card("5"), card("6", "hearts"),
    ], cappedRules), 25));
    expect(legalActions(current).split).toBe(true);
    current = playerSplit(current);
    expect(current.hands).toHaveLength(3);
    // The newly created A+5 hand and the old pending A+A hand both have their one allowed draw.
    expect(current.hands.every((entry) => entry.status === "stood")).toBe(true);
    expect(current.phase).toBe("dealer-turn");
  });

  it("auto-advances at 21, settles an all-bust table without dealer draws, and rejects stale actions", () => {
    const hitState = state({
      hands: [hand([card("10"), card("7")])],
      deck: [card("4")],
    });
    const twentyOne = playerHit(hitState);
    expect(evaluateHand(twentyOne.hands[0].cards).total).toBe(21);
    expect(twentyOne.phase).toBe("dealer-turn");

    const bustState = state({
      hands: [hand([card("K"), card("Q")])],
      deck: [card("5")],
    });
    const busted = playerHit(bustState);
    expect(busted.phase).toBe("settled");
    expect(busted.dealerHand).toEqual(bustState.dealerHand);
    expect(busted.settlement?.net).toBe(-25);
    expect(playerHit(busted)).toBe(busted);
    expect(playerStand(busted)).toBe(busted);
  });

  it("honors stand-soft-17 and hit-soft-17", () => {
    const stoodHand = hand([card("10"), card("8")], { status: "stood" });
    const softSeventeen = state({
      phase: "dealer-turn",
      activeHandIndex: null,
      hands: [stoodHand],
      dealerRevealed: true,
      dealerHand: [card("A"), card("6", "clubs")],
      deck: [card("2")],
    });
    expect(dealerStep(softSeventeen).phase).toBe("settled");

    const hitRules = { ...softSeventeen.rules, dealerSoft17: "hit" as const };
    const hit = dealerStep({ ...softSeventeen, rules: hitRules });
    expect(hit.phase).toBe("dealer-turn");
    expect(evaluateHand(hit.dealerHand).total).toBe(19);
    expect(dealerStep(hit).settlement?.outcome).toBe("dealer");
  });

  it("keeps the current shoe between rounds and applies new rules only from betting", () => {
    const settled = playerSurrender(state());
    const next = nextHand(settled);
    expect(next.phase).toBe("betting");
    expect(next.handNumber).toBe(2);
    expect(next.chips).toBe(settled.chips);
    expect(next.deck).toEqual(settled.deck);
    expect(next.hands).toEqual([]);
    expect(next.settlement).toBeUndefined();
    expect(nextHand(next)).toBe(next);

    const configured = configureRules({ ...next, handNumber: 9 }, HIGH_PRESSURE_RULES, () => 0.37);
    expect(configured.rules).toEqual(HIGH_PRESSURE_RULES);
    expect(configured.deck).toHaveLength(416);
    expect(configured.handNumber).toBe(1);
    expect(configured.chips).toBe(next.chips);
    const activeRound = state();
    expect(configureRules(activeRound, HIGH_PRESSURE_RULES)).toBe(activeRound);
  });

  it("exposes one pure transition entry point and phase-specific legal actions", () => {
    const initial = createInitialState(() => 0.37, TEST_RULES, 30);
    expect(legalActions(initial)).toMatchObject({
      bets: [10, 25],
      hit: false,
      dealerStep: false,
      configureRules: true,
    });
    expect(transition(initial, { type: "hit" })).toBe(initial);

    const dealt = transition(initialWithCards([
      card("10"), card("6", "clubs"), card("7"), card("10", "clubs"),
    ]), { type: "place-bet", amount: 25 });
    expect(legalActions(dealt)).toMatchObject({ hit: true, stand: true, double: true, surrender: true });
    expect(transition(dealt, { type: "stand" }).phase).toBe("dealer-turn");
  });
});
