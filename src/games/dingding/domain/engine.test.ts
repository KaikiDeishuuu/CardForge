import { describe, expect, it } from "vitest";
import { chooseAiMove, chooseAiDiscards, chooseAiDyingResponse, chooseAiStrikeResponse } from "./ai";
import { buildDeck } from "./data";
import {
  advancePhase,
  createInitialState,
  discardCards,
  distanceBetween,
  endTurn,
  getPlayableCards,
  getTargetOptions,
  playCard,
  respondToDying,
  respondToStrike,
} from "./engine";
import type { DingCard, DingPlayer, DingState, PlayerId } from "./types";

const fixedRandom = () => 0.37;

const CARD_DEFINITIONS: Record<string, Omit<DingCard, "id">> = {
  strike: { name: "刺击", kind: "basic", type: "strike", symbol: "╱", tone: "#000", description: "test" },
  evade: { name: "闪避", kind: "basic", type: "evade", symbol: "◌", tone: "#000", description: "test" },
  salve: { name: "疗元", kind: "basic", type: "salve", symbol: "✦", tone: "#000", description: "test" },
  focus: { name: "聚势", kind: "trick", type: "focus", symbol: "＋", tone: "#000", description: "test" },
  dismantle: { name: "拆解", kind: "trick", type: "dismantle", symbol: "⌁", tone: "#000", description: "test" },
  snatch: { name: "牵袭", kind: "trick", type: "snatch", symbol: "↯", tone: "#000", description: "test" },
  longblade: { name: "长锋", kind: "equipment", type: "weapon", symbol: "⾧", tone: "#000", description: "test", range: 2 },
  repeater: { name: "连机弩", kind: "equipment", type: "weapon", symbol: "串", tone: "#000", description: "test", range: 1, unlimitedStrikes: true },
  swift: { name: "赤影", kind: "equipment", type: "minus-horse", symbol: "驰", tone: "#000", description: "test" },
  bulwark: { name: "磐影", kind: "equipment", type: "plus-horse", symbol: "垒", tone: "#000", description: "test" },
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
    turnNumber: 1,
    activePlayerId: "south",
    players,
    deck: [],
    discard: [],
    strikeUsed: false,
    log: [],
    rngSeed: 1,
    ...overrides,
  };
}

describe("Ding Ding engine", () => {
  it("deals four identities with a revealed lord and a conserved deck", () => {
    const initial = createInitialState(fixedRandom);
    expect(initial.players).toHaveLength(4);
    expect(initial.players.every((entry) => entry.hand.length === 4)).toBe(true);
    expect(initial.players.filter((entry) => entry.identity === "lord")).toHaveLength(1);
    expect(initial.players.find((entry) => entry.identity === "lord")?.revealed).toBe(true);
    const cards = initial.players.flatMap((entry) => entry.hand).length + initial.deck.length + initial.discard.length;
    expect(cards).toBe(buildDeck().length);
    expect(initial.activePlayerId).toBe(initial.players.find((entry) => entry.identity === "lord")?.id);
  });

  it("computes seat distance and lets horses modify it", () => {
    const players = [
      player("south", { equipment: { minusHorse: card("swift", "swift-0") } }),
      player("east", { equipment: { plusHorse: card("bulwark", "bulwark-0") } }),
      player("north"),
      player("west"),
    ];
    expect(distanceBetween(players, "south", "east")).toBe(1);
    expect(distanceBetween(players, "east", "south")).toBe(1);
    // 南座 -1 马抵消东座 +1 马，但相邻距离最小为 1。
    expect(distanceBetween(players, "south", "east")).toBe(1);
    expect(distanceBetween(players, "south", "north")).toBe(1);
  });

  it("resolves a strike with an evade and without one", () => {
    const strike = card("strike", "strike-0");
    const evade = card("evade", "evade-0");
    const game = state({}, [
      player("south", { hand: [strike] }),
      player("east", { hand: [evade] }),
      player("north"),
      player("west"),
    ]);

    const pending = playCard(game, "south", "strike-0", "east");
    expect(pending.pending).toMatchObject({ kind: "strike", actorId: "south", targetId: "east" });
    const resolved = respondToStrike(pending, "east", "evade-0");
    expect(resolved.pending).toBeUndefined();
    expect(resolved.players.find((entry) => entry.id === "east")?.hp).toBe(4);
    expect(resolved.discard.map((entry) => entry.id)).toEqual(expect.arrayContaining(["strike-0", "evade-0"]));

    const hit = playCard(state({}, [
      player("south", { hand: [card("strike", "strike-1")] }),
      player("east"),
      player("north"),
      player("west"),
    ]), "south", "strike-1", "east");
    const hurt = respondToStrike(hit, "east");
    expect(hurt.players.find((entry) => entry.id === "east")?.hp).toBe(3);
  });

  it("enters dying state and accepts salves until the target recovers", () => {
    const game = state({}, [
      player("south", { hand: [card("strike", "strike-0")] }),
      player("east", { hp: 1, hand: [card("salve", "salve-0")] }),
      player("north"),
      player("west"),
    ]);
    const hurt = respondToStrike(playCard(game, "south", "strike-0", "east"), "east");
    expect(hurt.pending).toMatchObject({ kind: "dying", targetId: "east", required: 1 });
    const responder = hurt.pending?.kind === "dying" ? hurt.pending.responders[hurt.pending.cursor] : undefined;
    const saved = respondToDying(hurt, responder!, "salve-0");
    expect(saved.pending).toBeUndefined();
    expect(saved.players.find((entry) => entry.id === "east")?.hp).toBe(1);
  });

  it("reveals identity and pays rebel rewards on death", () => {
    const game = state({ deck: [card("evade", "d1"), card("evade", "d2"), card("evade", "d3")], rngSeed: 7 }, [
      player("south", { hand: [card("strike", "strike-0")] }),
      player("east", { hp: 1, identity: "rebel" }),
      player("north"),
      player("west"),
    ]);
    const dead = respondToStrike(playCard(game, "south", "strike-0", "east"), "east");
    // 濒死且无人援救：依次拒绝。
    let next = dead;
    while (next.pending?.kind === "dying") {
      next = respondToDying(next, next.pending.responders[next.pending.cursor]);
    }
    const east = next.players.find((entry) => entry.id === "east")!;
    expect(east.alive).toBe(false);
    expect(east.revealed).toBe(true);
    expect(next.status).toBe("playing");
    // 击退叛锋摸三张：南座从 0 张变为 3 张。
    expect(next.players.find((entry) => entry.id === "south")?.hand).toHaveLength(3);
  });

  it("ends the match when the lord falls and only the renegade remains", () => {
    const players = [
      player("south", { hp: 1, identity: "lord" }),
      player("east", { hp: 4, identity: "renegade", hand: [card("strike", "strike-0")] }),
      player("north", { alive: false, hp: 0, identity: "loyalist", revealed: true }),
      player("west", { alive: false, hp: 0, identity: "rebel", revealed: true }),
    ];
    const game = state({ activePlayerId: "east" }, players);
    const dead = respondToStrike(playCard(game, "east", "strike-0", "south"), "south");
    let next = dead;
    while (next.pending?.kind === "dying") {
      next = respondToDying(next, next.pending.responders[next.pending.cursor]);
    }
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("renegade");
  });

  it("draws two, plays focus and discards down to current hp", () => {
    let game = createInitialState(fixedRandom);
    const actor = game.activePlayerId;
    game = advancePhase(game);
    expect(game.phase).toBe("draw");
    game = advancePhase(game);
    expect(game.phase).toBe("play");
    expect(game.players.find((entry) => entry.id === actor)?.hand).toHaveLength(6);

    const focus = card("focus", "focus-0");
    const focusGame = state({ deck: [card("strike", "strike-x"), card("evade", "evade-x")], rngSeed: 7 }, [
      player("south", { hand: [focus] }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const afterFocus = playCard(focusGame, "south", "focus-0", "south");
    expect(afterFocus.players[0].hand).toHaveLength(2);

    const discardGame = state({ phase: "discard" }, [
      player("south", { hp: 3, hand: [card("strike", "s0"), card("evade", "e0"), card("salve", "p0"), card("focus", "f0")] }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const discarded = discardCards(discardGame, "south", ["s0"]);
    expect(discarded.players[0].hand).toHaveLength(3);
    expect(discarded.phase).toBe("prepare");
    expect(discarded.activePlayerId).toBe("east");
  });

  it("respects strike limits, range and equipment", () => {
    const repeater = card("repeater", "repeater-0");
    const longblade = card("longblade", "longblade-0");
    const strike1 = card("strike", "strike-a");
    const strike2 = card("strike", "strike-b");
    const game = state({}, [
      player("south", { hand: [strike1, strike2, longblade, repeater] }),
      player("east", { hp: 10 }),
      player("north"),
      player("west"),
    ]);

    // 默认范围 1：可以打相邻的东座与西座，不能打北座。
    expect(getTargetOptions(game, "south", strike1)).toEqual(["east", "west"]);
    const played = playCard(game, "south", "strike-a", "east");
    expect(played.strikeUsed).toBe(true);
    expect(getPlayableCards({ ...played, pending: undefined }, "south").some((entry) => entry.type === "strike")).toBe(false);

    // 装备长锋后射程 2，东、北、西座都进入可选范围。
    const withWeapon = playCard(game, "south", "longblade-0", "south");
    expect(getTargetOptions(withWeapon, "south", strike2)).toEqual(["east", "north", "west"]);
  });

  it("AI chooses a move, a strike response and legal discards", () => {
    const game = state({}, [
      player("south", { hand: [card("strike", "s1"), card("evade", "e1"), card("salve", "p1"), card("focus", "f1")] }),
      player("east", { hp: 2 }),
      player("north"),
      player("west"),
    ]);
    const move = chooseAiMove(game, "east");
    // 东座没有手牌，只能结束回合。
    expect(move.kind).toBe("end");
    const responseGame = state({ revision: 3, pending: { kind: "strike", actorId: "south", targetId: "east", cardUid: "s1", damage: 1 } }, [
      player("south", { hand: [card("strike", "s1")] }),
      player("east", { hp: 1, hand: [card("evade", "e1")] }),
      player("north"),
      player("west"),
    ]);
    expect(chooseAiStrikeResponse(responseGame, "east")).toBe("e1");
    const discardGame = state({ phase: "discard" }, [
      player("south", { hp: 2, hand: [card("strike", "d1"), card("evade", "d2"), card("salve", "d3")] }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    expect(chooseAiDiscards(discardGame, "south")).toEqual(["d1"]);
  });

  it("completes deterministic all-bot games without stalling", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const random = (() => {
        let value = seed;
        return () => {
          value = (value * 16_807) % 2_147_483_647;
          return value / 2_147_483_647;
        };
      })();
      let game = createInitialState(random);
      let guard = 0;
      while (game.status === "playing" && guard < 8_000) {
        guard += 1;
        const before = game;
        if (game.pending?.kind === "strike") {
          const evadeUid = chooseAiStrikeResponse(game, game.pending.targetId);
          game = respondToStrike(game, game.pending.targetId, evadeUid);
        } else if (game.pending?.kind === "dying") {
          const responder = game.pending.responders[game.pending.cursor];
          const salveUid = chooseAiDyingResponse(game, responder);
          game = respondToDying(game, responder, salveUid);
        } else if (game.phase === "discard") {
          const toDiscard = chooseAiDiscards(game, game.activePlayerId);
          game = toDiscard.length > 0 ? discardCards(game, game.activePlayerId, toDiscard) : advancePhase(game);
        } else if (game.phase === "play") {
          const move = chooseAiMove(game, game.activePlayerId);
          game = move.kind === "play" && move.cardUid
            ? playCard(game, game.activePlayerId, move.cardUid, move.targetId)
            : endTurn(game, game.activePlayerId);
        } else {
          game = advancePhase(game);
        }
        expect(game).not.toBe(before);
      }
      expect(guard, `seed ${seed} should finish`).toBeLessThan(8_000);
      expect(game.status).toBe("finished");
      expect(game.winner).toBeDefined();
    }
  });
});
