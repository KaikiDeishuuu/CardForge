import { describe, expect, it } from "vitest";
import { chooseTexasBotAction } from "./ai";
import { countStraightOrBetterOuts } from "./evaluator";
import type { TexasObservation } from "./observation";
import type { TexasCard, TexasRank, TexasStreet, TexasSuit } from "./types";

function card(rank: TexasRank, suit: TexasSuit): TexasCard {
  return { id: `${suit}-${rank}`, name: `${suit}-${rank}`, rank, suit };
}

interface ObservationOptions {
  readonly hole: readonly TexasCard[];
  readonly board: readonly TexasCard[];
  readonly street?: TexasStreet;
  readonly pot?: number;
  readonly callAmount?: number;
  readonly check?: boolean;
  readonly raisePresets?: readonly number[];
  readonly dealerIndex?: number;
  readonly revision?: number;
}

/** The bot always sits as "east", seat index 1, so dealerIndex 1 puts it on the button. */
function observation(options: ObservationOptions): TexasObservation {
  const callAmount = options.callAmount ?? 0;
  return {
    actorId: "east",
    revision: options.revision ?? 7,
    handNumber: 3,
    street: options.street ?? "flop",
    dealerIndex: options.dealerIndex ?? 0,
    bigBlind: 20,
    hole: options.hole,
    board: options.board,
    pot: options.pot ?? 100,
    players: [
      { id: "human", displayName: "你", stack: 900, folded: false, allIn: false, streetCommitted: callAmount, totalCommitted: 100 },
      { id: "east", displayName: "对手", stack: 900, folded: false, allIn: false, streetCommitted: 0, totalCommitted: 100 },
    ],
    legal: {
      fold: true,
      check: options.check ?? false,
      callAmount,
      minRaiseTo: 100,
      maxRaiseTo: 900,
      raisePresets: options.raisePresets ?? [100, 200, 400],
    },
  };
}

describe("Texas outs counting", () => {
  it("counts a four-flush as nine outs", () => {
    const outs = countStraightOrBetterOuts([
      card("A", "hearts"), card("9", "hearts"),
      card("K", "hearts"), card("5", "hearts"), card("2", "spades"),
    ]);
    expect(outs).toBe(9);
  });

  it("counts an open-ended run as eight outs and a gutshot as four", () => {
    const openEnded = countStraightOrBetterOuts([
      card("9", "spades"), card("8", "hearts"),
      card("7", "diamonds"), card("6", "clubs"), card("2", "spades"),
    ]);
    const gutshot = countStraightOrBetterOuts([
      card("9", "spades"), card("8", "hearts"),
      card("6", "diamonds"), card("5", "clubs"), card("2", "spades"),
    ]);
    expect(openEnded).toBe(8);
    expect(gutshot).toBe(4);
  });

  it("reports no outs for air and for a hand that already made the straight", () => {
    const air = countStraightOrBetterOuts([
      card("A", "spades"), card("7", "hearts"),
      card("K", "diamonds"), card("9", "clubs"), card("2", "spades"),
    ]);
    const made = countStraightOrBetterOuts([
      card("9", "spades"), card("8", "hearts"),
      card("7", "diamonds"), card("6", "clubs"), card("5", "spades"),
    ]);
    expect(air).toBe(0);
    expect(made).toBe(0);
  });

  it("ignores card counts outside a flop or turn holding", () => {
    expect(countStraightOrBetterOuts([card("A", "spades"), card("7", "hearts")])).toBe(0);
  });
});

describe("Texas bot pricing draws", () => {
  const flushDraw = {
    hole: [card("A", "hearts"), card("9", "hearts")],
    board: [card("K", "hearts"), card("5", "hearts"), card("2", "spades")],
  };
  /** Same ace-high shape, no draw: isolates the draw premium from the made hand. */
  const air = {
    hole: [card("A", "spades"), card("9", "hearts")],
    board: [card("K", "clubs"), card("5", "diamonds"), card("2", "spades")],
  };

  /** The largest bet into a 100 pot the bot will still pay. */
  function callingThreshold(options: ObservationOptions): number {
    let largest = 0;
    for (let callAmount = 5; callAmount <= 400; callAmount += 5) {
      const action = chooseTexasBotAction(observation({ ...options, pot: 100, callAmount }));
      if (action.type !== "fold") largest = callAmount;
    }
    return largest;
  }

  it("pays more to continue with a live draw than with the same high card alone", () => {
    expect(callingThreshold(flushDraw)).toBeGreaterThan(callingThreshold(air));
  });

  it("drops the premium once the river leaves nothing to come", () => {
    const turn = {
      hole: flushDraw.hole,
      board: [...flushDraw.board, card("8", "clubs")],
      street: "turn" as const,
    };
    const river = {
      hole: flushDraw.hole,
      board: [...flushDraw.board, card("8", "clubs"), card("3", "diamonds")],
      street: "river" as const,
    };
    // The busted draw on the river is worth no more than the same air.
    expect(callingThreshold(turn)).toBeGreaterThan(callingThreshold(river));
  });

  it("keeps the premium bounded below what actually making the hand is worth", () => {
    const madeFlush = {
      hole: flushDraw.hole,
      board: [...flushDraw.board.slice(0, 2), card("7", "hearts")],
    };
    expect(callingThreshold(madeFlush)).toBeGreaterThan(callingThreshold(flushDraw));
  });
});

describe("Texas bot bet sizing", () => {
  it("does not map raise size one-to-one onto hand strength", () => {
    const trips = {
      hole: [card("A", "spades"), card("A", "hearts")],
      board: [card("A", "diamonds"), card("K", "clubs"), card("2", "spades")],
    };
    const sizes = new Set<number>();
    for (let revision = 0; revision < 40; revision += 1) {
      const action = chooseTexasBotAction(observation({ ...trips, check: true, revision }));
      if (action.type === "raise") sizes.add(action.to);
    }
    // One holding, one strength, more than one size: the size no longer leaks it.
    expect(sizes.size).toBeGreaterThan(1);
  });
});

describe("Texas bot position", () => {
  it("continues more often on the button than out of position", () => {
    const marginal = {
      hole: [card("Q", "spades"), card("J", "diamonds")],
      board: [card("Q", "hearts"), card("8", "clubs"), card("3", "spades")],
    };
    function continues(dealerIndex: number): number {
      let count = 0;
      for (let revision = 0; revision < 60; revision += 1) {
        const action = chooseTexasBotAction(observation({
          ...marginal,
          dealerIndex,
          revision,
          pot: 100,
          callAmount: 90,
        }));
        if (action.type !== "fold") count += 1;
      }
      return count;
    }
    expect(continues(1)).toBeGreaterThan(continues(0));
  });
});

describe("Texas bot determinism", () => {
  it("returns the same action for the same observation", () => {
    const options = {
      hole: [card("A", "hearts"), card("9", "hearts")],
      board: [card("K", "hearts"), card("5", "hearts"), card("2", "spades")],
      pot: 120,
      callAmount: 40,
    };
    const first = chooseTexasBotAction(observation(options));
    const second = chooseTexasBotAction(observation(options));
    expect(first).toEqual(second);
  });
});
