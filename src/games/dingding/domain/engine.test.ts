import { describe, expect, it } from "vitest";
import {
  chooseAiDiscards,
  chooseAiDyingResponse,
  chooseAiMove,
  chooseAiNullifyResponse,
  chooseAiStrikeResponse,
} from "./ai";
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
  respondToTrick,
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
  nullify: { name: "无懈可击", kind: "trick", type: "nullify", symbol: "⊕", tone: "#000", description: "test" },
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
    stack: [],
    log: [],
    rngSeed: 1,
    ...overrides,
  };
}

/** 从栈顶开始，让所有锦囊响应者依次放弃，直到没有待响应的锦囊帧。 */
function passAllTrickResponses(game: DingState): DingState {
  let next = game;
  for (let guard = 0; guard < 24; guard += 1) {
    const top = next.stack.at(-1);
    if (!top || top.kind !== "trick" || !top.awaitingResponse) break;
    next = respondToTrick(next, top.responders[top.cursor]);
  }
  return next;
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
    expect(initial.stack).toEqual([]);
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
    expect(pending.stack.at(-1)).toMatchObject({ kind: "strike", actorId: "south", targetId: "east" });
    const resolved = respondToStrike(pending, "east", "evade-0");
    expect(resolved.stack).toHaveLength(0);
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
    expect(hurt.stack.at(-1)).toMatchObject({ kind: "dying", targetId: "east", required: 1 });
    const dying = hurt.stack.at(-1);
    const responder = dying?.kind === "dying" ? dying.responders[dying.cursor] : undefined;
    const saved = respondToDying(hurt, responder!, "salve-0");
    expect(saved.stack).toHaveLength(0);
    expect(saved.players.find((entry) => entry.id === "east")?.hp).toBe(1);
  });

  it("reveals identity and pays rebel rewards on death", () => {
    const game = state({ deck: [card("evade", "d1"), card("evade", "d2"), card("evade", "d3")], rngSeed: 7 }, [
      player("south", { hand: [card("strike", "strike-0")] }),
      player("east", { hp: 1, identity: "rebel", hand: [card("strike", "corpse-0")] }),
      player("north"),
      player("west"),
    ]);
    const dead = respondToStrike(playCard(game, "south", "strike-0", "east"), "east");
    // 濒死且无人援救：依次拒绝。
    let next = dead;
    while (next.stack.at(-1)?.kind === "dying") {
      const dying = next.stack.at(-1);
      if (dying?.kind !== "dying") break;
      next = respondToDying(next, dying.responders[dying.cursor]);
    }
    const east = next.players.find((entry) => entry.id === "east")!;
    expect(east.alive).toBe(false);
    expect(east.revealed).toBe(true);
    expect(east.hand).toEqual([]);
    expect(next.status).toBe("playing");
    // 退场者的手牌进入弃牌堆；击退叛锋再摸三张：南座从 0 张变为 3 张。
    expect(next.discard.map((entry) => entry.id)).toContain("corpse-0");
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
    while (next.stack.at(-1)?.kind === "dying") {
      const dying = next.stack.at(-1);
      if (dying?.kind !== "dying") break;
      next = respondToDying(next, dying.responders[dying.cursor]);
    }
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("renegade");
  });

  it("draws two, plays focus through the stack and discards down to current hp", () => {
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
    const afterFocus = passAllTrickResponses(playCard(focusGame, "south", "focus-0", "south"));
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
    expect(getPlayableCards({ ...played, stack: [] }, "south").some((entry) => entry.type === "strike")).toBe(false);

    // 装备长锋后射程 2，东、北、西座都进入可选范围。
    const withWeapon = playCard(game, "south", "longblade-0", "south");
    expect(getTargetOptions(withWeapon, "south", strike2)).toEqual(["east", "north", "west"]);
  });

  it("settles a trick frame after every responder passes", () => {
    const game = state({ deck: [card("evade", "d1"), card("evade", "d2")], rngSeed: 7 }, [
      player("south", { hand: [card("focus", "focus-0")] }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const played = playCard(game, "south", "focus-0", "south");
    expect(played.stack).toHaveLength(1);
    expect(played.stack[0]).toMatchObject({ kind: "trick", cardType: "focus", actorId: "south", awaitingResponse: true });

    const settled = passAllTrickResponses(played);
    expect(settled.stack).toHaveLength(0);
    expect(settled.players[0].hand.map((entry) => entry.id)).toEqual(expect.arrayContaining(["d1", "d2"]));
    expect(settled.players[0].hand).toHaveLength(2);
    expect(settled.discard.some((entry) => entry.id === "focus-0")).toBe(true);
  });

  it("lets nullify negate a dismantle and keeps the target hand intact", () => {
    const game = state({}, [
      player("south", { hand: [card("dismantle", "dismantle-0")] }),
      player("east", { hand: [card("strike", "keep-0"), card("nullify", "nullify-0")] }),
      player("north"),
      player("west"),
    ]);
    let next = playCard(game, "south", "dismantle-0", "east");
    next = respondToTrick(next, "south"); // 南座自己放弃
    expect(next.stack.at(-1)?.kind).toBe("trick");
    next = respondToTrick(next, "east", "nullify-0"); // 东座打出无懈

    expect(next.stack).toHaveLength(2);
    expect(next.stack[0]).toMatchObject({ kind: "trick", cardType: "dismantle", awaitingResponse: false });
    expect(next.stack[1]).toMatchObject({ kind: "trick", cardType: "nullify", counterFrameId: next.stack[0].kind === "trick" ? next.stack[0].frameId : -1 });

    const settled = passAllTrickResponses(next);
    expect(settled.stack).toHaveLength(0);
    expect(settled.players[1].hand.map((entry) => entry.id)).toEqual(["keep-0"]);
    expect(settled.discard.map((entry) => entry.id)).toEqual(expect.arrayContaining(["dismantle-0", "nullify-0"]));
    expect(settled.log.some((entry) => entry.text.includes("抵消"))).toBe(true);
  });

  it("resolves a nested nullify chain and lets the original focus still draw", () => {
    const game = state({ deck: [card("evade", "d1"), card("evade", "d2")], rngSeed: 7 }, [
      player("south", { hand: [card("focus", "focus-0"), card("nullify", "nullify-s")] }),
      player("east", { hand: [card("nullify", "nullify-e")] }),
      player("north"),
      player("west"),
    ]);
    let next = playCard(game, "south", "focus-0", "south");
    next = respondToTrick(next, "south"); // 南座放弃响应自己的聚势
    next = respondToTrick(next, "east", "nullify-e"); // 东座无懈聚势

    // 东座的无懈按东→北→西→南顺序询问：南座最后反制。
    next = respondToTrick(next, "east");
    next = respondToTrick(next, "north");
    next = respondToTrick(next, "west");
    next = respondToTrick(next, "south", "nullify-s");

    expect(next.stack).toHaveLength(3);
    expect(next.stack[0]).toMatchObject({ kind: "trick", cardType: "focus", awaitingResponse: false });
    expect(next.stack[1]).toMatchObject({ kind: "trick", cardType: "nullify", awaitingResponse: false });
    expect(next.stack[2]).toMatchObject({ kind: "trick", cardType: "nullify", awaitingResponse: true });

    const settled = passAllTrickResponses(next);
    expect(settled.stack).toHaveLength(0);
    expect(settled.players[0].hand.map((entry) => entry.id)).toEqual(expect.arrayContaining(["d1", "d2"]));
    expect(settled.players[0].hand).toHaveLength(2);
    expect(settled.discard.map((entry) => entry.id)).toEqual(expect.arrayContaining(["focus-0", "nullify-e", "nullify-s"]));
    const logText = settled.log.map((entry) => entry.text).join("\n");
    expect(logText).toContain("无懈可击」生效");
    expect(logText).toContain("被无懈可击抵消");
  });

  it("rejects out-of-turn or wrong-card nullify responses", () => {
    const game = state({}, [
      player("south", { hand: [card("focus", "focus-0")] }),
      player("east", { hand: [card("strike", "not-nullify-0")] }),
      player("north"),
      player("west"),
    ]);
    const played = playCard(game, "south", "focus-0", "south");
    expect(respondToTrick(played, "east", "not-nullify-0")).toBe(played); // 不是无懈
    expect(respondToTrick(played, "north")).toBe(played); // 还没轮到北座
  });

  it("AI protects its own tricks and nullifies tricks aimed at itself", () => {
    const dismantleGame = state({}, [
      player("south", { hand: [card("dismantle", "dismantle-0")] }),
      player("east", { hand: [card("nullify", "nullify-0"), card("strike", "s-0")] }),
      player("north"),
      player("west"),
    ]);
    let next = playCard(dismantleGame, "south", "dismantle-0", "east");
    next = respondToTrick(next, "south"); // 轮到东座
    expect(chooseAiNullifyResponse(next, "east")).toBe("nullify-0");

    const focusGame = state({ activePlayerId: "east", deck: [], rngSeed: 3 }, [
      player("south", { hand: [card("nullify", "nullify-s")] }),
      player("east", { hand: [card("focus", "focus-0"), card("nullify", "nullify-e")] }),
      player("north"),
      player("west"),
    ]);
    let chain = playCard(focusGame, "east", "focus-0", "east");
    chain = respondToTrick(chain, "east");
    chain = respondToTrick(chain, "north");
    chain = respondToTrick(chain, "west");
    chain = respondToTrick(chain, "south", "nullify-s");
    chain = respondToTrick(chain, "south"); // 轮到东座反制，保护自己的聚势
    expect(chooseAiNullifyResponse(chain, "east")).toBe("nullify-e");
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
    const responseGame = state({ revision: 3, stack: [{ kind: "strike", actorId: "south", targetId: "east", cardUid: "s1", damage: 1 }] }, [
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
      while (game.status === "playing" && guard < 12_000) {
        guard += 1;
        const before = game;
        const top = game.stack.at(-1);
        if (top?.kind === "strike") {
          const evadeUid = chooseAiStrikeResponse(game, top.targetId);
          game = respondToStrike(game, top.targetId, evadeUid);
        } else if (top?.kind === "dying") {
          const responder = top.responders[top.cursor];
          const salveUid = chooseAiDyingResponse(game, responder);
          game = respondToDying(game, responder, salveUid);
        } else if (top?.kind === "trick") {
          const responder = top.responders[top.cursor];
          const nullifyUid = chooseAiNullifyResponse(game, responder);
          game = respondToTrick(game, responder, nullifyUid);
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
      expect(guard, `seed ${seed} should finish`).toBeLessThan(12_000);
      expect(game.status).toBe("finished");
      expect(game.winner).toBeDefined();
    }
  });
});
