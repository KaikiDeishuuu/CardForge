import { describe, expect, it } from "vitest";
import { buildDeck } from "./data";
import { createInitialState, playCard } from "./engine";
import { restoreDingState, serializeDingState } from "./persistence";
import type { DingPlayer, DingState } from "./types";

function tamper(overrides: Record<string, unknown>): unknown {
  const initial = createInitialState(() => 0.37);
  return { ...JSON.parse(JSON.stringify(serializeDingState(initial))), ...overrides };
}

/** 手工构造一个合法的「聚势被无懈挂起」状态，覆盖 trick 栈的两类帧。 */
function craftedTrickChain(): DingState {
  const deck = buildDeck();
  const focus = deck.find((card) => card.type === "focus")!;
  const nullify = deck.find((card) => card.type === "nullify")!;
  const players: DingPlayer[] = [
    {
      id: "south", displayName: "你", controller: "human", seat: 0,
      identity: "lord", revealed: true, hp: 5, maxHp: 5, alive: true,
      hand: [], equipment: {}, heroId: "cloudstep", skillFlags: {},
    },
    {
      id: "east", displayName: "东座", controller: "ai", seat: 1,
      identity: "rebel", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: "cloudstep", skillFlags: {},
    },
    {
      id: "north", displayName: "北座", controller: "ai", seat: 2,
      identity: "loyalist", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: "cloudstep", skillFlags: {},
    },
    {
      id: "west", displayName: "西座", controller: "ai", seat: 3,
      identity: "renegade", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: "cloudstep", skillFlags: {},
    },
  ];
  return {
    revision: 3,
    status: "playing",
    phase: "play",
    turnNumber: 1,
    activePlayerId: "south",
    players,
    deck: deck.filter((card) => card.id !== focus.id && card.id !== nullify.id),
    discard: [focus, nullify],
    strikeUsed: false,
    stack: [
      {
        kind: "trick",
        frameId: 1,
        actorId: "south",
        cardUid: focus.id,
        cardType: "focus",
        responders: ["south", "east", "north", "west"],
        cursor: 1,
        awaitingResponse: false,
      },
      {
        kind: "trick",
        frameId: 2,
        actorId: "east",
        cardUid: nullify.id,
        cardType: "nullify",
        counterFrameId: 1,
        responders: ["east", "north", "west", "south"],
        cursor: 0,
        awaitingResponse: true,
      },
    ],
    log: [],
    rngSeed: 1,
  };
}

/** 手工构造一个合法的「合围进行到第二席」状态。 */
function craftedHordeState(): DingState {
  const deck = buildDeck();
  const horde = deck.find((card) => card.type === "horde")!;
  const players: DingPlayer[] = [
    {
      id: "south", displayName: "你", controller: "human", seat: 0,
      identity: "lord", revealed: true, hp: 5, maxHp: 5, alive: true,
      hand: [], equipment: {}, heroId: "cloudstep", skillFlags: {},
    },
    {
      id: "east", displayName: "东座", controller: "ai", seat: 1,
      identity: "rebel", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: "cloudstep", skillFlags: {},
    },
    {
      id: "north", displayName: "北座", controller: "ai", seat: 2,
      identity: "loyalist", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: "cloudstep", skillFlags: {},
    },
    {
      id: "west", displayName: "西座", controller: "ai", seat: 3,
      identity: "renegade", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: "cloudstep", skillFlags: {},
    },
  ];
  return {
    revision: 4,
    status: "playing",
    phase: "play",
    turnNumber: 1,
    activePlayerId: "south",
    players,
    deck: deck.filter((card) => card.id !== horde.id),
    discard: [horde],
    strikeUsed: false,
    stack: [
      {
        kind: "horde",
        actorId: "south",
        cardUid: horde.id,
        responders: ["east", "north", "west"],
        cursor: 1,
      },
    ],
    log: [],
    rngSeed: 1,
  };
}

describe("Ding Ding persistence", () => {
  it("round-trips an initial table", () => {
    const initial = createInitialState(() => 0.37);
    const restored = restoreDingState(JSON.parse(JSON.stringify(serializeDingState(initial))));
    expect(restored).toEqual(initial);
  });

  it("round-trips a pending strike", () => {
    const base = createInitialState(() => 0.37);
    const strike = base.deck.find((card) => card.type === "strike")!;
    const actorId = base.activePlayerId;
    const actor = base.players.find((player) => player.id === actorId)!;
    const initial: DingState = {
      ...base,
      phase: "play",
      players: base.players.map((player) =>
        player.id === actorId ? { ...player, hand: [...player.hand, strike] } : player,
      ),
      deck: base.deck.filter((card) => card.id !== strike.id),
    };
    const target = initial.players.find((candidate) => {
      if (candidate.id === actorId || !candidate.alive) return false;
      const seats = [actor.seat, candidate.seat].sort((left, right) => left - right);
      return seats[1] - seats[0] === 1 || seats[1] - seats[0] === 3;
    })!;
    const pending = playCard(initial, actorId, strike.id, target.id);
    expect(pending.stack.at(-1)?.kind).toBe("strike");
    const restored = restoreDingState(JSON.parse(JSON.stringify(serializeDingState(pending))));
    expect(restored).toEqual(pending);
  });

  it("round-trips a nested trick stack with a suspended frame and a nullify frame", () => {
    const crafted = craftedTrickChain();
    const restored = restoreDingState(JSON.parse(JSON.stringify(serializeDingState(crafted))));
    expect(restored).toEqual(crafted);
    expect(restored?.stack).toHaveLength(2);
  });

  it("round-trips an in-flight horde frame", () => {
    const crafted = craftedHordeState();
    const restored = restoreDingState(JSON.parse(JSON.stringify(serializeDingState(crafted))));
    expect(restored).toEqual(crafted);
    expect(restored?.stack.at(-1)).toMatchObject({ kind: "horde", cursor: 1 });
  });

  it("rejects malformed players, phases, stacks and card piles", () => {
    expect(restoreDingState(undefined)).toBeUndefined();
    expect(restoreDingState({ status: "broken" })).toBeUndefined();
    expect(restoreDingState(tamper({ phase: "bidding" }))).toBeUndefined();
    expect(restoreDingState(tamper({ players: [] }))).toBeUndefined();
    expect(restoreDingState(tamper({ deck: [{}] }))).toBeUndefined();
    expect(restoreDingState(tamper({ activePlayerId: "nobody" }))).toBeUndefined();
    expect(restoreDingState(tamper({ rngSeed: -1 }))).toBeUndefined();
    expect(restoreDingState(tamper({ stack: [{ kind: "mystery" }] }))).toBeUndefined();
  });

  it("rejects tampered identity metadata, winner state and stack invariants", () => {
    const withHiddenLord = tamper({});
    const players = (withHiddenLord as { players: Array<{ identity: string; revealed: boolean }> }).players;
    const lord = players.find((player) => player.identity === "lord")!;
    lord.revealed = false;
    expect(restoreDingState(withHiddenLord)).toBeUndefined();

    const badWinner = tamper({ status: "playing", winner: "rebel" });
    expect(restoreDingState(badWinner)).toBeUndefined();

    const danglingCounter = JSON.parse(JSON.stringify(serializeDingState(craftedTrickChain()))) as DingState;
    const nullifyFrame = danglingCounter.stack[1];
    if (nullifyFrame.kind === "trick") {
      (danglingCounter.stack as unknown as Array<{ counterFrameId?: number }>)[1].counterFrameId = 999;
    }
    expect(restoreDingState(danglingCounter)).toBeUndefined();

    const awaitingNegated = JSON.parse(JSON.stringify(serializeDingState(craftedTrickChain()))) as DingState;
    const suspended = awaitingNegated.stack[0];
    if (suspended.kind === "trick") {
      const frames = awaitingNegated.stack as unknown as Array<{ negated?: boolean; awaitingResponse?: boolean }>;
      frames[0].negated = true;
      frames[0].awaitingResponse = true;
    }
    expect(restoreDingState(awaitingNegated)).toBeUndefined();

    const badHorde = JSON.parse(JSON.stringify(serializeDingState(craftedHordeState()))) as DingState;
    (badHorde.stack as unknown as Array<{ cursor?: number }>)[0].cursor = 5;
    expect(restoreDingState(badHorde)).toBeUndefined();

    const badHero = JSON.parse(JSON.stringify(serializeDingState(createInitialState(() => 0.37))));
    ((badHero as { players: Array<{ heroId?: string }> }).players)[0].heroId = "mystery";
    expect(restoreDingState(badHero)).toBeUndefined();
  });
});
