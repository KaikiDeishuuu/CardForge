import { describe, expect, it } from "vitest";
import {
  chooseAiDyingResponse,
  chooseAiMove,
  chooseAiNullifyResponse,
  chooseAiSkillDecision,
  identityBelief,
} from "./ai";
import type {
  DingCard,
  DingPlayer,
  DingState,
  PendingTrick,
  PlayerId,
  TrickCardType,
} from "./types";

const CARD_DEFINITIONS: Readonly<Record<string, Omit<DingCard, "id">>> = {
  strike: { name: "刺击", kind: "basic", type: "strike", symbol: "╱", tone: "#000", description: "test" },
  salve: { name: "疗元", kind: "basic", type: "salve", symbol: "✦", tone: "#000", description: "test" },
  probe: { name: "刺探", kind: "trick", type: "probe", symbol: "窥", tone: "#000", description: "test" },
  aid: { name: "援护", kind: "trick", type: "aid", symbol: "援", tone: "#000", description: "test" },
  dismantle: { name: "拆解", kind: "trick", type: "dismantle", symbol: "⌁", tone: "#000", description: "test" },
  nullify: { name: "无懈可击", kind: "trick", type: "nullify", symbol: "⊕", tone: "#000", description: "test" },
  horde: { name: "合围", kind: "trick", type: "horde", symbol: "围", tone: "#000", description: "test" },
  volley: { name: "齐射", kind: "trick", type: "volley", symbol: "矢", tone: "#000", description: "test" },
};

function card(type: keyof typeof CARD_DEFINITIONS, id: string): DingCard {
  return { ...CARD_DEFINITIONS[type], id };
}

function player(id: PlayerId, overrides: Partial<DingPlayer> = {}): DingPlayer {
  return {
    id,
    displayName: id,
    controller: id === "south" ? "human" : "ai",
    seat: ["south", "east", "north", "west"].indexOf(id),
    identity: id === "south" ? "lord" : id === "east" ? "rebel" : id === "north" ? "loyalist" : "renegade",
    revealed: id === "south",
    hp: id === "south" ? 5 : 4,
    maxHp: id === "south" ? 5 : 4,
    alive: true,
    hand: [],
    equipment: {},
    heroId: "",
    skillFlags: {},
    ...overrides,
  };
}

function state(overrides: Partial<DingState> = {}, players: DingPlayer[] = [
  player("south"),
  player("east"),
  player("north"),
  player("west"),
]): DingState {
  return {
    revision: 0,
    status: "playing",
    phase: "play",
    difficulty: "standard",
    turnNumber: 1,
    activePlayerId: "south",
    players,
    deck: [],
    discard: [],
    delayedTricks: { south: [], east: [], north: [], west: [] },
    strikeUsed: false,
    stack: [],
    log: [],
    rngSeed: 1,
    ...overrides,
  };
}

function pendingTrick(
  frameId: number,
  actorId: PlayerId,
  cardType: TrickCardType,
  targetId?: PlayerId,
  counterFrameId?: number,
  awaitingResponse = true,
  currentResponder: PlayerId = "south",
): PendingTrick {
  const responders: readonly PlayerId[] = ["south", "east", "north", "west"];
  return {
    kind: "trick",
    frameId,
    actorId,
    cardUid: `${cardType}-${frameId}`,
    cardType,
    ...(targetId ? { targetId } : {}),
    ...(counterFrameId === undefined ? {} : { counterFrameId }),
    responders,
    cursor: responders.indexOf(currentResponder),
    awaitingResponse,
  };
}

function awaitingDying(game: DingState, targetId: PlayerId, responderId: PlayerId): DingState {
  return {
    ...game,
    stack: [{
      kind: "dying",
      targetId,
      required: 1,
      offered: 0,
      responders: [responderId],
      cursor: 0,
    }],
  };
}

describe("Ding Ding identity-aware AI", () => {
  it("makes the renegade remove the last non-lord before attacking the lord", () => {
    const game = state({ activePlayerId: "east" }, [
      player("south"),
      player("east", { identity: "renegade", hand: [card("strike", "strike-r")] }),
      player("north", { identity: "rebel" }),
      player("west", { identity: "loyalist", alive: false, hp: 0, revealed: true }),
    ]);

    expect(chooseAiMove(game, "east")).toEqual({
      kind: "play",
      cardUid: "strike-r",
      targetId: "north",
    });

    const lordOnlyInRange = state({ activePlayerId: "west" }, [
      player("south"),
      player("east", { identity: "rebel" }),
      player("north", { identity: "loyalist", alive: false, hp: 0, revealed: true }),
      player("west", { identity: "renegade", hand: [card("strike", "strike-w")] }),
    ]);
    expect(chooseAiMove(lordOnlyInRange, "west")).toEqual({ kind: "end" });

    const headsUp = {
      ...game,
      players: game.players.map((entry) => entry.id === "north"
        ? { ...entry, alive: false, hp: 0, revealed: true }
        : entry),
    };
    expect(chooseAiMove(headsUp, "east")).toEqual({
      kind: "play",
      cardUid: "strike-r",
      targetId: "south",
    });
  });

  it("probes the target with the strongest public identity confidence", () => {
    const game = state({
      activePlayerId: "south",
      log: [{ id: 1, text: "north弃置「闪避」护主，为主君抵挡 1 点伤害。" }],
    }, [
      player("south", { hand: [card("probe", "probe-s")] }),
      player("east", { identity: "rebel", revealed: false }),
      player("north", { identity: "loyalist", revealed: false }),
      player("west", { alive: false, hp: 0, revealed: true }),
    ]);

    expect(chooseAiMove(game, "south")).toEqual({
      kind: "play",
      cardUid: "probe-s",
      targetId: "north",
    });

    const samePublicState = {
      ...game,
      players: game.players.map((entry) => entry.id === "north"
        ? { ...entry, identity: "rebel" as const }
        : entry),
    };
    expect(chooseAiMove(samePublicState, "south")).toEqual({
      kind: "play",
      cardUid: "probe-s",
      targetId: "north",
    });
  });

  it("always prioritizes the public lord for a rebel tactical target", () => {
    const game = state({ activePlayerId: "east" }, [
      player("south"),
      player("east", { identity: "rebel", hand: [card("strike", "strike-e")] }),
      player("north", {
        identity: "loyalist",
        hand: Array.from({ length: 8 }, (_, index) => card("salve", `north-${index}`)),
      }),
      player("west", { identity: "renegade" }),
    ]);

    expect(chooseAiMove(game, "east")).toEqual({
      kind: "play",
      cardUid: "strike-e",
      targetId: "south",
    });
  });

  it.each(["horde", "volley"] as const)(
    "keeps a renegade from playing a lord-lethal %s while a third party lives",
    (cardType) => {
      const game = state({ activePlayerId: "west" }, [
        player("south", { hp: 1 }),
        player("east", { identity: "rebel" }),
        player("north", { identity: "loyalist", alive: false, hp: 0, revealed: true }),
        player("west", { identity: "renegade", hand: [card(cardType, `${cardType}-w`)] }),
      ]);

      expect(chooseAiMove(game, "west")).toEqual({ kind: "end" });

      const safeLord = {
        ...game,
        players: game.players.map((entry) => entry.id === "south" ? { ...entry, hp: 2 } : entry),
      };
      expect(chooseAiMove(safeLord, "west")).toEqual({
        kind: "play",
        cardUid: `${cardType}-w`,
        targetId: "west",
      });
    },
  );

  it("does not infer loyalty from a nullify that countered the lord's trick", () => {
    const players = [player("south"), player("east"), player("north"), player("west")];
    const baseline = state({}, players);
    const misleadingLog = state({
      log: [{ id: 1, text: "north的「无懈可击」生效，抵消了south的「聚势」。" }],
    }, players);

    expect(identityBelief(misleadingLog, "south", "north"))
      .toEqual(identityBelief(baseline, "south", "north"));
  });
});

describe("Ding Ding dying rescue AI", () => {
  it("always uses a salve to save itself", () => {
    const game = state({}, [
      player("south"),
      player("east", { hp: 0, identity: "rebel", hand: [card("salve", "self-salve")] }),
      player("north"),
      player("west"),
    ]);
    expect(chooseAiDyingResponse(awaitingDying(game, "east", "east"), "east")).toBe("self-salve");
  });

  it("lets loyalists save the lord and the lord save a publicly trusted loyalist", () => {
    const loyalistGame = state({}, [
      player("south", { hp: 0 }),
      player("east"),
      player("north", { identity: "loyalist", hand: [card("salve", "loyal-salve")] }),
      player("west"),
    ]);
    expect(chooseAiDyingResponse(awaitingDying(loyalistGame, "south", "north"), "north")).toBe("loyal-salve");

    const lordGame = state({
      log: [{ id: 1, text: "north弃置「闪避」护主，为主君抵挡 1 点伤害。" }],
    }, [
      player("south", { hand: [card("salve", "lord-salve")] }),
      player("east"),
      player("north", { hp: 0, identity: "loyalist", revealed: false }),
      player("west"),
    ]);
    expect(chooseAiDyingResponse(awaitingDying(lordGame, "north", "south"), "south")).toBe("lord-salve");

    const samePublicState = {
      ...lordGame,
      players: lordGame.players.map((entry) => entry.id === "north"
        ? { ...entry, identity: "rebel" as const }
        : entry),
    };
    expect(chooseAiDyingResponse(awaitingDying(samePublicState, "north", "south"), "south")).toBe("lord-salve");
  });

  it("does not let a rebel rescue the publicly known lord side", () => {
    const game = state({}, [
      player("south", { hp: 0 }),
      player("east", { identity: "rebel", hand: [card("salve", "rebel-salve")] }),
      player("north", { hp: 0, identity: "loyalist", revealed: true }),
      player("west"),
    ]);
    expect(chooseAiDyingResponse(awaitingDying(game, "south", "east"), "east")).toBeUndefined();
    expect(chooseAiDyingResponse(awaitingDying(game, "north", "east"), "east")).toBeUndefined();
  });

  it("keeps the lord alive before the renegade duel but not during it", () => {
    const game = state({}, [
      player("south", { hp: 0 }),
      player("east", { identity: "rebel" }),
      player("north", { alive: false, hp: 0, revealed: true }),
      player("west", { identity: "renegade", hand: [card("salve", "renegade-salve")] }),
    ]);
    expect(chooseAiDyingResponse(awaitingDying(game, "south", "west"), "west")).toBe("renegade-salve");

    const headsUp = {
      ...game,
      players: game.players.map((entry) => entry.id === "east"
        ? { ...entry, alive: false, hp: 0, revealed: true }
        : entry),
    };
    expect(chooseAiDyingResponse(awaitingDying(headsUp, "south", "west"), "west")).toBeUndefined();
  });
});

describe("Ding Ding nullify AI", () => {
  it("does not nullify aid aimed at itself or its lord", () => {
    const players = [
      player("south", { hp: 3 }),
      player("east"),
      player("north", { identity: "loyalist", hp: 2, hand: [card("nullify", "nullify-n")] }),
      player("west"),
    ];
    const selfAid = state({ stack: [pendingTrick(1, "east", "aid", "north", undefined, true, "north")] }, players);
    const lordAid = state({ stack: [pendingTrick(2, "east", "aid", "south", undefined, true, "north")] }, players);

    expect(chooseAiNullifyResponse(selfAid, "north")).toBeUndefined();
    expect(chooseAiNullifyResponse(lordAid, "north")).toBeUndefined();
  });

  it("does not nullify its own beneficial trick but still blocks hostile effects", () => {
    const ownAid = state({ stack: [pendingTrick(1, "east", "aid", "south", undefined, true, "east")] }, [
      player("south", { hp: 3 }),
      player("east", { identity: "rebel", hand: [card("nullify", "nullify-e")] }),
      player("north"),
      player("west"),
    ]);
    expect(chooseAiNullifyResponse(ownAid, "east")).toBeUndefined();

    const dismantle = state({ stack: [pendingTrick(2, "south", "dismantle", "east", undefined, true, "east")] }, [
      player("south"),
      player("east", { identity: "rebel", hand: [card("nullify", "nullify-e")] }),
      player("north"),
      player("west"),
    ]);
    expect(chooseAiNullifyResponse(dismantle, "east")).toBe("nullify-e");
  });

  it("counters an enemy nullify to restore a beneficial trick", () => {
    const original = pendingTrick(1, "south", "aid", "north", undefined, false);
    const enemyNullify = pendingTrick(2, "east", "nullify", undefined, 1, true, "north");
    const game = state({ stack: [original, enemyNullify] }, [
      player("south"),
      player("east"),
      player("north", { identity: "loyalist", hp: 2, hand: [card("nullify", "nullify-n")] }),
      player("west"),
    ]);
    expect(chooseAiNullifyResponse(game, "north")).toBe("nullify-n");
  });

  it.each(["horde", "volley"] as const)(
    "lets a rebel preserve a lord-lethal %s and makes a renegade protect the lord until heads-up",
    (cardType) => {
      const rebelGame = state({
        stack: [pendingTrick(10, "west", cardType, undefined, undefined, true, "east")],
      }, [
        player("south", { hp: 1 }),
        player("east", { identity: "rebel", hand: [card("nullify", "nullify-e")] }),
        player("north", { identity: "loyalist" }),
        player("west", { identity: "renegade" }),
      ]);
      expect(chooseAiNullifyResponse(rebelGame, "east")).toBeUndefined();

      const renegadeGame = state({
        stack: [pendingTrick(11, "west", cardType, undefined, undefined, true, "west")],
      }, [
        player("south", { hp: 1 }),
        player("east", { identity: "rebel" }),
        player("north", { identity: "loyalist", alive: false, hp: 0, revealed: true }),
        player("west", { identity: "renegade", hand: [card("nullify", "nullify-w")] }),
      ]);
      expect(chooseAiNullifyResponse(renegadeGame, "west")).toBe("nullify-w");

      const headsUp = {
        ...renegadeGame,
        players: renegadeGame.players.map((entry) => entry.id === "east"
          ? { ...entry, alive: false, hp: 0, revealed: true }
          : entry),
      };
      expect(chooseAiNullifyResponse(headsUp, "west")).toBeUndefined();
    },
  );

  it("only chooses nullify for the current response cursor", () => {
    const game = state({
      stack: [pendingTrick(20, "south", "dismantle", "east", undefined, true, "south")],
    }, [
      player("south"),
      player("east", { identity: "rebel", hand: [card("nullify", "nullify-e")] }),
      player("north"),
      player("west"),
    ]);

    expect(chooseAiNullifyResponse(game, "east")).toBeUndefined();
    expect(chooseAiNullifyResponse({
      ...game,
      stack: game.stack.map((entry) => entry.kind === "trick" ? { ...entry, cursor: 1 } : entry),
    }, "east")).toBe("nullify-e");
  });
});

describe("Ding Ding beneficial action AI", () => {
  it("retains aid for the ally-less rebel and lets the lord side aid its ally", () => {
    const game = state({ activePlayerId: "east" }, [
      player("south", { hp: 3 }),
      player("east", { identity: "rebel", hand: [card("aid", "aid-e")] }),
      player("north"),
      player("west"),
    ]);
    expect(chooseAiMove(game, "east")).toEqual({ kind: "end" });

    const lordSideGame = state({ activePlayerId: "north" }, [
      player("south", { hp: 3 }),
      player("east", { identity: "rebel" }),
      player("north", { identity: "loyalist", hand: [card("aid", "aid-n")] }),
      player("west", { identity: "renegade" }),
    ]);
    expect(chooseAiMove(lordSideGame, "north")).toEqual({
      kind: "play",
      cardUid: "aid-n",
      targetId: "south",
    });
  });

  it("declines 举荐 without an ally and recommends the lord for a loyalist", () => {
    const rebelGame = state({ activePlayerId: "east" }, [
      player("south"),
      player("east", { identity: "rebel", heroId: "fubi" }),
      player("north"),
      player("west"),
    ]);
    expect(chooseAiMove(rebelGame, "east", "standard")).toEqual({ kind: "end" });
    expect(chooseAiMove(rebelGame, "east", "relaxed")).toEqual({ kind: "end" });

    const loyalistGame = state({
      activePlayerId: "north",
      stack: [{
        kind: "skill",
        ownerId: "north",
        skillId: "jujian",
        prompt: "test",
        targetIds: ["south", "east", "west"],
      }],
    }, [
      player("south"),
      player("east"),
      player("north", { identity: "loyalist", heroId: "fubi" }),
      player("west"),
    ]);
    expect(chooseAiSkillDecision(loyalistGame, "north")).toEqual({ targetId: "south" });

    const rebelPending = {
      ...rebelGame,
      stack: [{
        kind: "skill" as const,
        ownerId: "east" as const,
        skillId: "jujian",
        prompt: "test",
        targetIds: ["south", "north", "west"] as const,
      }],
    };
    expect(chooseAiSkillDecision(rebelPending, "east")).toBeUndefined();
  });
});
