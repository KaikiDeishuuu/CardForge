import { describe, expect, it } from "vitest";
import { legalActions } from "./engine";
import { getStrategyHint } from "./strategy";
import type {
  PlayerHandState,
  PlayingCard,
  Rank,
  Suit,
  TwentyOneRules,
  TwentyOneState,
} from "./types";

const DEFAULT_TEST_RULES: TwentyOneRules = {
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

let cardSequence = 0;

function card(rank: Rank, suit: Suit = "spades"): PlayingCard {
  cardSequence += 1;
  return { id: `${suit}-${rank}-strategy-${cardSequence}`, name: `${suit} ${rank}`, rank, suit };
}

interface StateOptions {
  readonly rules?: Partial<TwentyOneRules>;
  readonly hand?: Partial<PlayerHandState>;
  readonly phase?: TwentyOneState["phase"];
  readonly chips?: number;
  readonly insurance?: TwentyOneState["insurance"];
  readonly activeHandIndex?: number | null;
}

function state(
  playerCards: readonly PlayingCard[],
  dealerUpcard: PlayingCard,
  options: StateOptions = {},
): TwentyOneState {
  const hand: PlayerHandState = {
    id: "hand-1",
    cards: playerCards,
    wager: 25,
    status: "playing",
    fromSplit: false,
    splitAces: false,
    doubled: false,
    ...options.hand,
  };

  return {
    revision: 1,
    phase: options.phase ?? "player-turn",
    rules: { ...DEFAULT_TEST_RULES, ...options.rules },
    deck: Array.from({ length: 24 }, (_, index) => card(String((index % 8) + 2) as Rank, "clubs")),
    dealerHand: [dealerUpcard, card("7", "diamonds")],
    dealerRevealed: false,
    hands: [hand],
    activeHandIndex: options.activeHandIndex === undefined ? 0 : options.activeHandIndex,
    baseBet: 25,
    insurance: options.insurance ?? { status: "not-offered", wager: 0 },
    chips: options.chips ?? 200,
    handNumber: 1,
    log: [],
  };
}

describe("Twenty One basic strategy", () => {
  it("always declines insurance instead of recommending the side bet", () => {
    const current = state([card("10"), card("7")], card("A"), {
      phase: "insurance",
      insurance: { status: "offered", wager: 0 },
    });

    expect(legalActions(current).takeInsurance).toBe(true);
    expect(getStrategyHint(current)).toMatchObject({
      action: "decline-insurance",
      reason: expect.stringContaining("期望值为负"),
    });
  });

  it("covers representative multi-deck hard totals", () => {
    expect(getStrategyHint(state([card("10"), card("2")], card("6"), {
      rules: { allowLateSurrender: false },
    }))?.action).toBe("stand");
    expect(getStrategyHint(state([card("6"), card("5")], card("6"), {
      rules: { allowLateSurrender: false },
    }))?.action).toBe("double");
    expect(getStrategyHint(state([card("10"), card("6")], card("7"), {
      rules: { allowLateSurrender: false },
    }))?.action).toBe("hit");
  });

  it("uses the single-deck hard table instead of the multi-deck table", () => {
    const cards = [card("5"), card("4")] as const;
    const dealer = card("2");
    const single = state(cards, dealer, { rules: { deckCount: 1, allowLateSurrender: false } });
    const multi = state(cards, dealer, { rules: { deckCount: 2, allowLateSurrender: false } });

    expect(getStrategyHint(single)?.action).toBe("double");
    expect(getStrategyHint(multi)?.action).toBe("hit");
  });

  it("covers soft totals and the H17 soft-19 deviation", () => {
    expect(getStrategyHint(state([card("A"), card("7")], card("9"), {
      rules: { allowLateSurrender: false },
    }))?.action).toBe("hit");
    expect(getStrategyHint(state([card("A"), card("7")], card("6"), {
      rules: { allowLateSurrender: false },
    }))?.action).toBe("double");

    const softNineteen = [card("A"), card("8")] as const;
    expect(getStrategyHint(state(softNineteen, card("6"), {
      rules: { dealerSoft17: "stand", allowLateSurrender: false },
    }))?.action).toBe("stand");
    expect(getStrategyHint(state(softNineteen, card("6"), {
      rules: { dealerSoft17: "hit", allowLateSurrender: false },
    }))?.action).toBe("double");
  });

  it("uses DAS when choosing whether to split fours", () => {
    const fours = [card("4"), card("4", "hearts")] as const;
    expect(getStrategyHint(state(fours, card("6"), {
      rules: { doubleAfterSplit: true, allowLateSurrender: false },
    }))?.action).toBe("split");
    expect(getStrategyHint(state(fours, card("6"), {
      rules: { doubleAfterSplit: false, allowLateSurrender: false },
    }))?.action).toBe("hit");
  });

  it("splits eights but stands on nines against a dealer seven", () => {
    expect(getStrategyHint(state([card("8"), card("8", "hearts")], card("10"), {
      rules: { allowLateSurrender: false },
    }))?.action).toBe("split");
    expect(getStrategyHint(state([card("9"), card("9", "hearts")], card("7"), {
      rules: { allowLateSurrender: false },
    }))?.action).toBe("stand");
  });

  it("recommends late surrender and applies the H17 exception", () => {
    expect(getStrategyHint(state([card("10"), card("6")], card("10")))?.action).toBe("surrender");

    const hardSeventeen = [card("10"), card("7")] as const;
    expect(getStrategyHint(state(hardSeventeen, card("A"), {
      rules: { dealerSoft17: "stand" },
    }))?.action).toBe("stand");
    expect(getStrategyHint(state(hardSeventeen, card("A"), {
      rules: { dealerSoft17: "hit" },
    }))?.action).toBe("surrender");
  });

  it("falls back from an illegal double to a legal hit", () => {
    const current = state([card("6"), card("5")], card("6"), {
      rules: { allowLateSurrender: false },
      chips: 0,
    });
    expect(legalActions(current).double).toBe(false);
    expect(legalActions(current).hit).toBe(true);
    expect(getStrategyHint(current)).toMatchObject({
      action: "hit",
      reason: expect.stringContaining("当前不可加倍"),
    });
  });

  it("falls back from an illegal split to the unsplit hand table", () => {
    const current = state([card("8"), card("8", "hearts")], card("6"), {
      rules: { maxPlayerHands: 1, allowLateSurrender: false },
    });
    expect(legalActions(current).split).toBe(false);
    expect(legalActions(current).stand).toBe(true);
    expect(getStrategyHint(current)).toMatchObject({
      action: "stand",
      reason: expect.stringContaining("当前不可拆牌"),
    });
  });

  it("falls back from unavailable surrender to hit or stand", () => {
    const current = state([card("8"), card("5"), card("3")], card("10"));
    expect(legalActions(current).surrender).toBe(false);
    expect(getStrategyHint(current)).toMatchObject({
      action: "hit",
      reason: expect.stringContaining("当前不可迟投降"),
    });
  });

  it("never returns a hint outside insurance or an active player hand", () => {
    expect(getStrategyHint(state([], card("6"), { phase: "betting", activeHandIndex: null }))).toBeUndefined();
    expect(getStrategyHint(state([card("10"), card("7")], card("6"), {
      phase: "dealer-turn",
      activeHandIndex: null,
    }))).toBeUndefined();
  });
});
