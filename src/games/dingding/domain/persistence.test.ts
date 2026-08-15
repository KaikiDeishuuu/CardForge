import { describe, expect, it } from "vitest";
import { buildDeck } from "./data";
import { createInitialState, playCard } from "./engine";
import { HERO_IDS } from "./heroes";
import {
  DING_SAVE_SCHEMA_VERSION,
  restoreDingRootState,
  restoreDingState,
  serializeDingRootState,
  serializeDingState,
} from "./persistence";
import { createDefaultDingRootState, startDingMatch } from "./session";
import type { DingPlayer, DingState } from "./types";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableDingState = Mutable<DingState>;

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
      hand: [], equipment: {}, heroId: HERO_IDS[0], skillFlags: {},
    },
    {
      id: "east", displayName: "东座", controller: "ai", seat: 1,
      identity: "rebel", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[1], skillFlags: {},
    },
    {
      id: "north", displayName: "北座", controller: "ai", seat: 2,
      identity: "loyalist", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[2], skillFlags: {},
    },
    {
      id: "west", displayName: "西座", controller: "ai", seat: 3,
      identity: "renegade", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[3], skillFlags: {},
    },
  ];
  return {
    revision: 3,
    status: "playing",
    phase: "play",
    difficulty: "standard",
    turnNumber: 1,
    activePlayerId: "south",
    players,
    deck: deck.filter((card) => card.id !== focus.id && card.id !== nullify.id),
    discard: [focus, nullify],
    delayedTricks: { south: [], east: [], north: [], west: [] },
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

/** 手工构造一个合法的「青囊主动技决策帧」状态。 */
function craftedSkillState(): DingState {
  const deck = buildDeck();
  const cost = deck.find((card) => card.type === "strike")!;
  const players: DingPlayer[] = [
    {
      id: "south", displayName: "你", controller: "human", seat: 0,
      identity: "lord", revealed: true, hp: 4, maxHp: 5, alive: true,
      hand: [cost], equipment: {}, heroId: "springtide",
      skillFlags: { "active:qingnang": true },
    },
    {
      id: "east", displayName: "东座", controller: "ai", seat: 1,
      identity: "rebel", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[1], skillFlags: {},
    },
    {
      id: "north", displayName: "北座", controller: "ai", seat: 2,
      identity: "loyalist", revealed: false, hp: 3, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[4], skillFlags: {},
    },
    {
      id: "west", displayName: "西座", controller: "ai", seat: 3,
      identity: "renegade", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[3], skillFlags: {},
    },
  ];
  return {
    revision: 5,
    status: "playing",
    phase: "play",
    difficulty: "standard",
    turnNumber: 1,
    activePlayerId: "south",
    players,
    deck: deck.filter((card) => card.id !== cost.id),
    discard: [],
    delayedTricks: { south: [], east: [], north: [], west: [] },
    strikeUsed: false,
    stack: [{
      kind: "skill",
      ownerId: "south",
      skillId: "qingnang",
      prompt: "选择一张手牌作为消耗，并选择一名受伤角色回复 1 点体力。",
      targetIds: ["south", "north"],
    }],
    log: [],
    rngSeed: 1,
  };
}

/** 手工构造一个合法的「无消耗自益主动技」状态。 */
function craftedSelfSkillState(): DingState {
  const deck = buildDeck();
  const players: DingPlayer[] = [
    {
      id: "south", displayName: "你", controller: "human", seat: 0,
      identity: "lord", revealed: true, hp: 5, maxHp: 5, alive: true,
      hand: [], equipment: {}, heroId: "lastwill",
      skillFlags: { "active:yujin": true },
    },
    {
      id: "east", displayName: "东座", controller: "ai", seat: 1,
      identity: "rebel", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[1], skillFlags: {},
    },
    {
      id: "north", displayName: "北座", controller: "ai", seat: 2,
      identity: "loyalist", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[2], skillFlags: {},
    },
    {
      id: "west", displayName: "西座", controller: "ai", seat: 3,
      identity: "renegade", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[3], skillFlags: {},
    },
  ];
  return {
    revision: 2,
    status: "playing",
    phase: "play",
    difficulty: "standard",
    turnNumber: 1,
    activePlayerId: "south",
    players,
    deck,
    discard: [],
    delayedTricks: { south: [], east: [], north: [], west: [] },
    strikeUsed: false,
    stack: [{
      kind: "skill",
      ownerId: "south",
      skillId: "yujin",
      prompt: "本回合下一次进入濒死时，额外摸 1 张牌。",
      targetIds: [],
    }],
    log: [],
    rngSeed: 1,
  };
}

/** 手工构造一个合法的「延时锦囊等待判定」状态。 */
function craftedDelayedState(): DingState {
  const deck = buildDeck();
  const delayedCard = deck.find((card) => card.type === "delay-play")!;
  const players: DingPlayer[] = [
    {
      id: "south", displayName: "你", controller: "human", seat: 0,
      identity: "lord", revealed: true, hp: 5, maxHp: 5, alive: true,
      hand: [], equipment: {}, heroId: "redblade", skillFlags: {},
    },
    {
      id: "east", displayName: "东座", controller: "ai", seat: 1,
      identity: "rebel", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[1], skillFlags: {},
    },
    {
      id: "north", displayName: "北座", controller: "ai", seat: 2,
      identity: "loyalist", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[2], skillFlags: {},
    },
    {
      id: "west", displayName: "西座", controller: "ai", seat: 3,
      identity: "renegade", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[3], skillFlags: {},
    },
  ];
  return {
    revision: 6,
    status: "playing",
    phase: "judge",
    difficulty: "standard",
    turnNumber: 2,
    activePlayerId: "east",
    players,
    deck: deck.filter((card) => card.id !== delayedCard.id),
    discard: [],
    delayedTricks: {
      south: [], west: [], north: [],
      east: [{ card: delayedCard, sourceActorId: "south" }],
    },
    strikeUsed: false,
    stack: [{
      kind: "delayed",
      ownerId: "east",
      cardUid: delayedCard.id,
      sourceActorId: "south",
    }],
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
      hand: [], equipment: {}, heroId: HERO_IDS[0], skillFlags: {},
    },
    {
      id: "east", displayName: "东座", controller: "ai", seat: 1,
      identity: "rebel", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[1], skillFlags: {},
    },
    {
      id: "north", displayName: "北座", controller: "ai", seat: 2,
      identity: "loyalist", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[2], skillFlags: {},
    },
    {
      id: "west", displayName: "西座", controller: "ai", seat: 3,
      identity: "renegade", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: HERO_IDS[3], skillFlags: {},
    },
  ];
  return {
    revision: 4,
    status: "playing",
    phase: "play",
    difficulty: "standard",
    turnNumber: 1,
    activePlayerId: "south",
    players,
    deck: deck.filter((card) => card.id !== horde.id),
    discard: [horde],
    delayedTricks: { south: [], east: [], north: [], west: [] },
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
  it("round-trips the v8 root archive and active table", () => {
    const initial = createInitialState(() => 0.37);
    const root = startDingMatch(createDefaultDingRootState(), initial);
    const restored = restoreDingRootState(
      DING_SAVE_SCHEMA_VERSION,
      JSON.parse(JSON.stringify(serializeDingRootState(root))),
    );
    expect(restored).toEqual(root);
    expect(restored?.activeMatch?.state).toEqual(initial);
  });

  it("migrates a v7 single-table save into the v8 archive", () => {
    const initial = createInitialState(() => 0.37);
    const restored = restoreDingRootState(7, JSON.parse(JSON.stringify(serializeDingState(initial))));
    expect(restored?.activeMatch?.state).toEqual(initial);
    expect(restored?.preferences.difficulty).toBe(initial.difficulty);
    expect(restored?.lifetimeProfile.gamesPlayed).toBe(0);
  });

  it("rejects malformed lifetime archives", () => {
    const initial = createInitialState(() => 0.37);
    const root = JSON.parse(JSON.stringify(serializeDingRootState(startDingMatch(createDefaultDingRootState(), initial))));
    root.lifetimeProfile.wins = 99;
    expect(restoreDingRootState(DING_SAVE_SCHEMA_VERSION, root)).toBeUndefined();
  });

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

    const boosted = JSON.parse(JSON.stringify(serializeDingState(pending))) as MutableDingState;
    const strikeFrame = boosted.stack[0] as Extract<DingState["stack"][number], { kind: "strike" }>;
    boosted.stack = [{ ...strikeFrame, damage: 2 }, ...boosted.stack.slice(1)];
    expect(restoreDingState(boosted)).toEqual(boosted);
  });

  it("round-trips a nested trick stack with a suspended frame and a nullify frame", () => {
    const crafted = craftedTrickChain();
    const restored = restoreDingState(JSON.parse(JSON.stringify(serializeDingState(crafted))));
    expect(restored).toEqual(crafted);
    expect(restored?.stack).toHaveLength(2);
  });

  it("round-trips an active-skill decision frame", () => {
    const crafted = craftedSkillState();
    const restored = restoreDingState(JSON.parse(JSON.stringify(serializeDingState(crafted))));
    expect(restored).toEqual(crafted);
    expect(restored?.stack.at(-1)).toMatchObject({ kind: "skill", skillId: "qingnang" });
  });

  it("round-trips a self-target no-cost active skill frame with no target ids", () => {
    const crafted = craftedSelfSkillState();
    const restored = restoreDingState(JSON.parse(JSON.stringify(serializeDingState(crafted))));
    expect(restored).toEqual(crafted);
    expect(restored?.stack.at(-1)).toMatchObject({ kind: "skill", skillId: "yujin", targetIds: [] });
  });

  it("round-trips a delayed-trick judge frame", () => {
    const crafted = craftedDelayedState();
    const restored = restoreDingState(JSON.parse(JSON.stringify(serializeDingState(crafted))));
    expect(restored).toEqual(crafted);
    expect(restored?.stack.at(-1)).toMatchObject({ kind: "delayed", ownerId: "east" });
  });

  it("round-trips an in-flight horde frame", () => {
    const crafted = craftedHordeState();
    const restored = restoreDingState(JSON.parse(JSON.stringify(serializeDingState(crafted))));
    expect(restored).toEqual(crafted);
    expect(restored?.stack.at(-1)).toMatchObject({ kind: "horde", cursor: 1 });
  });

  it("accepts frame cards that were reshuffled from the discard into the draw pile", () => {
    const reshuffled = JSON.parse(JSON.stringify(serializeDingState(craftedHordeState()))) as MutableDingState;
    const frame = reshuffled.stack[0] as Extract<DingState["stack"][number], { kind: "horde" }>;
    const horde = reshuffled.discard.find((card) => card.id === frame.cardUid)!;
    reshuffled.deck = [...reshuffled.deck, horde];
    reshuffled.discard = reshuffled.discard.filter((card) => card.id !== horde.id);
    expect(restoreDingState(reshuffled)).toEqual(reshuffled);
  });

  it("rejects malformed players, phases, stacks and card piles", () => {
    expect(restoreDingState(undefined)).toBeUndefined();
    expect(restoreDingState({ status: "broken" })).toBeUndefined();
    expect(restoreDingState(tamper({ phase: "bidding" }))).toBeUndefined();
    expect(restoreDingState(tamper({ players: [] }))).toBeUndefined();
    expect(restoreDingState(tamper({ deck: [{}] }))).toBeUndefined();
    expect(restoreDingState(tamper({ activePlayerId: "nobody" }))).toBeUndefined();
    expect(restoreDingState(tamper({ rngSeed: -1 }))).toBeUndefined();
    expect(restoreDingState(tamper({ difficulty: "nightmare" }))).toBeUndefined();
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

  it("rejects saves with no human, duplicated identities/heroes, swapped seats, prototype keys and wrong winners", () => {
    const base = JSON.parse(JSON.stringify(serializeDingState(createInitialState(() => 0.37)))) as MutableDingState;

    const noHuman = JSON.parse(JSON.stringify(base)) as MutableDingState;
    noHuman.players = noHuman.players.map((player) => ({ ...player, controller: "ai" as const }));
    expect(restoreDingState(noHuman)).toBeUndefined();

    const duplicateIdentity = JSON.parse(JSON.stringify(base)) as MutableDingState;
    duplicateIdentity.players = duplicateIdentity.players.map((player) =>
      player.identity === "renegade" ? { ...player, identity: "rebel" as const } : player,
    );
    expect(restoreDingState(duplicateIdentity)).toBeUndefined();

    const duplicateHero = JSON.parse(JSON.stringify(base)) as MutableDingState;
    duplicateHero.players = duplicateHero.players.map((player) => ({ ...player, heroId: "redblade" }));
    expect(restoreDingState(duplicateHero)).toBeUndefined();

    const swappedSeats = JSON.parse(JSON.stringify(base)) as MutableDingState;
    const south = swappedSeats.players.find((player) => player.id === "south")!;
    const east = swappedSeats.players.find((player) => player.id === "east")!;
    swappedSeats.players = swappedSeats.players.map((player) => {
      if (player.id === "south") return { ...player, seat: east.seat };
      if (player.id === "east") return { ...player, seat: south.seat };
      return player;
    });
    expect(restoreDingState(swappedSeats)).toBeUndefined();

    const prototypeHero = JSON.parse(JSON.stringify(base)) as MutableDingState;
    prototypeHero.players = prototypeHero.players.map((player) => ({ ...player, heroId: "toString" }));
    expect(restoreDingState(prototypeHero)).toBeUndefined();

    const wrongWinner = JSON.parse(JSON.stringify(base)) as MutableDingState;
    wrongWinner.status = "finished";
    wrongWinner.phase = "finished";
    wrongWinner.winner = "rebel";
    wrongWinner.stack = [];
    expect(restoreDingState(wrongWinner)).toBeUndefined();
  });
});
