import { describe, expect, it } from "vitest";
import { chooseTexasBotAction } from "./ai";
import { compareEvaluatedHands } from "./evaluator";
import {
  applyTexasAction,
  createTexasState,
  getTexasLegalActions,
  getTexasPotSize,
  startNextTexasHand,
} from "./engine";
import { buildTexasObservation } from "./observation";
import type { TexasState } from "./types";

const fixedRandom = () => 0.42;

function totalChips(state: TexasState): number {
  return state.players.reduce((sum, player) => sum + player.stack + player.totalCommitted, 0);
}

function checkThrough(state: TexasState): TexasState {
  let next = state;
  let guard = 0;
  while (next.status === "playing" && guard < 20) {
    guard += 1;
    const actorId = next.activePlayerId!;
    const legal = getTexasLegalActions(next, actorId);
    next = applyTexasAction(next, actorId, legal.check ? { type: "check" } : { type: "call" });
  }
  return next;
}

describe("Texas Hold'em engine", () => {
  it("deals heads-up cards, posts blinds, and gives the button first preflop action", () => {
    const state = createTexasState(fixedRandom);
    const human = state.players.find((player) => player.id === "human")!;
    const opponent = state.players.find((player) => player.id === "east")!;

    expect(state.street).toBe("preflop");
    expect(state.dealerIndex).toBe(0);
    expect(state.activePlayerId).toBe("human");
    expect(human.hole).toHaveLength(2);
    expect(opponent.hole).toHaveLength(2);
    expect(human.streetCommitted).toBe(5);
    expect(opponent.streetCommitted).toBe(10);
    expect(getTexasPotSize(state)).toBe(15);
    expect(state.tableChipTotal).toBe(1_000);
    expect(totalChips(state)).toBe(1_000);
  });

  it("closes betting rounds in heads-up order and can check down to showdown", () => {
    let state = createTexasState(fixedRandom);
    state = applyTexasAction(state, "human", { type: "call" });
    expect(state.activePlayerId).toBe("east");
    state = applyTexasAction(state, "east", { type: "check" });

    expect(state.street).toBe("flop");
    expect(state.board).toHaveLength(3);
    expect(state.activePlayerId).toBe("east");
    expect(state.players.every((player) => player.streetCommitted === 0)).toBe(true);

    state = checkThrough(state);
    expect(state.status).toBe("settled");
    expect(state.street).toBe("showdown");
    expect(state.board).toHaveLength(5);
    expect(state.burned).toHaveLength(3);
    const accountedCards = [
      ...state.deck,
      ...state.burned,
      ...state.board,
      ...state.players.flatMap((player) => player.hole),
    ];
    expect(accountedCards).toHaveLength(52);
    expect(new Set(accountedCards.map((card) => card.id)).size).toBe(52);
    expect(state.result?.reason).toBe("showdown");
    expect(state.players.reduce((sum, player) => sum + player.stack, 0)).toBe(1_000);
  });

  it("awards an uncontested pot immediately after a fold", () => {
    const initial = createTexasState(fixedRandom);
    const settled = applyTexasAction(initial, "human", { type: "fold" });

    expect(settled.status).toBe("settled");
    expect(settled.result?.reason).toBe("fold");
    expect(settled.result?.winnerIds).toEqual(["east"]);
    expect(settled.players.find((player) => player.id === "human")?.stack).toBe(495);
    expect(settled.players.find((player) => player.id === "east")?.stack).toBe(505);
  });

  it("enforces raise-to minimums and preserves chips through an all-in runout", () => {
    let state = createTexasState(fixedRandom);
    const initialLegal = getTexasLegalActions(state, "human");
    expect(initialLegal.minRaiseTo).toBe(20);
    expect(applyTexasAction(state, "human", { type: "raise", to: 15 })).toBe(state);

    state = applyTexasAction(state, "human", { type: "raise", to: initialLegal.maxRaiseTo });
    expect(state.activePlayerId).toBe("east");
    const opponentLegal = getTexasLegalActions(state, "east");
    expect(opponentLegal.callAmount).toBe(490);
    state = applyTexasAction(state, "east", { type: "call" });

    expect(state.status).toBe("settled");
    expect(state.board).toHaveLength(5);
    expect(state.players.reduce((sum, player) => sum + player.stack, 0)).toBe(1_000);
  });

  it("allows a short all-in without reopening a completed raise", () => {
    let state = createTexasState(fixedRandom);
    state = {
      ...state,
      tableChipTotal: 525,
      players: state.players.map((player) => player.id === "east"
        ? { ...player, stack: 15 }
        : player),
    };

    state = applyTexasAction(state, "human", { type: "raise", to: 20 });
    const shortStackLegal = getTexasLegalActions(state, "east");
    expect(shortStackLegal.minRaiseTo).toBeUndefined();
    expect(shortStackLegal.raisePresets).toEqual([25]);

    state = applyTexasAction(state, "east", { type: "raise", to: 25 });
    const response = getTexasLegalActions(state, "human");
    expect(response.callAmount).toBe(5);
    expect(response.minRaiseTo).toBeUndefined();
    expect(response.raisePresets).toEqual([]);

    state = applyTexasAction(state, "human", { type: "call" });
    expect(state.status).toBe("settled");
    expect(state.board).toHaveLength(5);
  });

  it("does not report an unmatched all-in refund as a showdown win", () => {
    let foundLosingDeepStack = false;
    for (let seed = 1; seed <= 80 && !foundLosingDeepStack; seed += 1) {
      let value = seed;
      const random = () => {
        value = (value * 16_807) % 2_147_483_647;
        return (value - 1) / 2_147_483_646;
      };
      let state = createTexasState(random);
      state = {
        ...state,
        tableChipTotal: 800,
        players: state.players.map((player) => player.id === "east"
          ? { ...player, stack: 290 }
          : player),
      };
      state = applyTexasAction(state, "human", { type: "raise", to: 500 });
      state = applyTexasAction(state, "east", { type: "call" });
      const humanHand = state.result?.hands.human;
      const opponentHand = state.result?.hands.east;
      if (!humanHand || !opponentHand || compareEvaluatedHands(humanHand, opponentHand) >= 0) continue;

      foundLosingDeepStack = true;
      expect(state.result?.pots.some((pot) => pot.eligiblePlayerIds.length === 1)).toBe(true);
      expect(state.result?.winnerIds).toEqual(["east"]);
      expect(state.result?.summary).not.toContain("你以");
      expect(state.players.reduce((sum, player) => sum + player.stack, 0)).toBe(800);
    }
    expect(foundLosingDeepStack).toBe(true);
  });

  it("rotates the button and the heads-up blind action on the next hand", () => {
    const settled = applyTexasAction(createTexasState(fixedRandom), "human", { type: "fold" });
    const next = startNextTexasHand(settled, fixedRandom);

    expect(next.handNumber).toBe(2);
    expect(next.dealerIndex).toBe(1);
    expect(next.activePlayerId).toBe("east");
    expect(next.players.find((player) => player.id === "east")?.streetCommitted).toBe(5);
    expect(next.players.find((player) => player.id === "human")?.streetCommitted).toBe(10);
  });

  it("automatically reloads a stack that cannot cover the next big blind", () => {
    const folded = applyTexasAction(createTexasState(fixedRandom), "human", { type: "fold" });
    const short = {
      ...folded,
      players: folded.players.map((player) => player.id === "human"
        ? { ...player, stack: 3 }
        : { ...player, stack: 997 }),
    };
    const next = startNextTexasHand(short, fixedRandom);

    expect(next.players.find((player) => player.id === "human")?.stack).toBe(490);
    expect(next.players.find((player) => player.id === "human")?.streetCommitted).toBe(10);
    expect(next.tableChipTotal).toBe(1_497);
    expect(totalChips(next)).toBe(next.tableChipTotal);
    expect(next.currentBet).toBe(10);
    expect(next.lastAction?.text).toContain("你自动补充至 500 筹码");
  });

  it("builds a hidden-information observation and the bot always chooses a legal action", () => {
    let state = createTexasState(fixedRandom);
    state = applyTexasAction(state, "human", { type: "call" });
    const observation = buildTexasObservation(state, "east");
    const humanHoleIds = state.players.find((player) => player.id === "human")!.hole.map((card) => card.id);
    const serialized = JSON.stringify(observation);

    expect(observation).not.toHaveProperty("deck");
    expect(observation).not.toHaveProperty("burned");
    for (const cardId of humanHoleIds) expect(serialized).not.toContain(cardId);

    const action = chooseTexasBotAction(observation);
    const next = applyTexasAction(state, "east", action);
    expect(next.revision).toBeGreaterThan(state.revision);
  });

  it("settles varied legal betting sequences without losing cards or chips", () => {
    for (let seed = 1; seed <= 48; seed += 1) {
      let value = seed;
      const random = () => {
        value = (value * 16_807) % 2_147_483_647;
        return (value - 1) / 2_147_483_646;
      };
      let state = createTexasState(random);
      let actions = 0;

      while (state.status === "playing" && actions < 40) {
        actions += 1;
        const actorId = state.activePlayerId!;
        const legal = getTexasLegalActions(state, actorId);
        const choice = random();
        const previousRevision = state.revision;
        if (legal.raisePresets.length > 0 && choice > 0.72) {
          const preset = legal.raisePresets[Math.floor(random() * legal.raisePresets.length)];
          state = applyTexasAction(state, actorId, { type: "raise", to: preset });
        } else if (legal.check) {
          state = applyTexasAction(state, actorId, { type: "check" });
        } else if (choice < 0.08) {
          state = applyTexasAction(state, actorId, { type: "fold" });
        } else {
          state = applyTexasAction(state, actorId, { type: "call" });
        }
        expect(state.revision).toBeGreaterThan(previousRevision);
      }

      expect(state.status, `seed ${seed} should settle`).toBe("settled");
      expect(state.players.reduce((sum, player) => sum + player.stack, 0)).toBe(1_000);
      const cards = [
        ...state.deck,
        ...state.burned,
        ...state.board,
        ...state.players.flatMap((player) => player.hole),
      ];
      expect(cards).toHaveLength(52);
      expect(new Set(cards.map((card) => card.id)).size).toBe(52);
    }
  });
});
