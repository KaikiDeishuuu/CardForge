import { describe, expect, it } from "vitest";
import {
  chooseAiDiscards,
  chooseAiDuelResponse,
  chooseAiDyingResponse,
  chooseAiHordeResponse,
  chooseAiMove,
  chooseAiNullifyResponse,
  chooseAiProbeGuess,
  chooseAiProtectResponse,
  chooseAiSkillDecision,
  chooseAiStrikeResponse,
  chooseAiVolleyResponse,
  identityBelief,
} from "./ai";
import { buildDeck } from "./data";
import { HERO_CATALOG } from "./heroes";
import {
  activateSkill,
  advancePhase,
  attackRange,
  changeDifficulty,
  chooseHero,
  createInitialState,
  discardCards,
  distanceBetween,
  endTurn,
  getActiveSkillUse,
  getPlayableCards,
  getTargetOptions,
  playCard,
  respondToDelayed,
  respondToDuel,
  respondToDying,
  respondToHorde,
  respondToProbe,
  respondToProtect,
  respondToSkill,
  respondToStrike,
  respondToTrick,
  respondToVolley,
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
  duel: { name: "约斗", kind: "trick", type: "duel", symbol: "斗", tone: "#000", description: "test" },
  horde: { name: "合围", kind: "trick", type: "horde", symbol: "围", tone: "#000", description: "test" },
  volley: { name: "齐射", kind: "trick", type: "volley", symbol: "矢", tone: "#000", description: "test" },
  grove: { name: "同袍", kind: "trick", type: "grove", symbol: "和", tone: "#000", description: "test" },
  aid: { name: "援护", kind: "trick", type: "aid", symbol: "援", tone: "#000", description: "test" },
  probe: { name: "刺探", kind: "trick", type: "probe", symbol: "窥", tone: "#000", description: "test" },
  armor: { name: "犀甲", kind: "equipment", type: "armor", symbol: "甲", tone: "#000", description: "test" },
  "delay-play": { name: "断锋", kind: "trick", type: "delay-play", symbol: "封", tone: "#000", description: "test" },
  "delay-draw": { name: "困阵", kind: "trick", type: "delay-draw", symbol: "困", tone: "#000", description: "test" },
  "delay-burn": { name: "焚营", kind: "trick", type: "delay-burn", symbol: "焚", tone: "#000", description: "test" },
  longblade: { name: "长锋", kind: "equipment", type: "weapon", symbol: "⾧", tone: "#000", description: "test", range: 2 },
  longshot: { name: "穿云", kind: "equipment", type: "weapon", symbol: "穿", tone: "#000", description: "test", range: 3 },
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

  it("deals a unique hero to every player", () => {
    const initial = createInitialState(fixedRandom);
    const heroIds = initial.players.map((entry) => entry.heroId);
    expect(new Set(heroIds).size).toBe(4);
    expect(heroIds.every((id) => id in HERO_CATALOG)).toBe(true);
    expect(initial.players.every((entry) => Object.keys(entry.skillFlags).length === 0)).toBe(true);
  });

  it("uses hero max hp for the initial table and swaps only the human hero during the draft", () => {
    const lineup = ["redblade", "springtide", "nightowl", "ironward"] as const;
    const initial = createInitialState(fixedRandom, "standard", lineup);
    for (const player of initial.players) {
      const heroMaxHp = HERO_CATALOG[player.heroId as keyof typeof HERO_CATALOG].maxHp;
      expect(player.maxHp).toBe(player.identity === "lord" ? heroMaxHp + 1 : heroMaxHp);
      expect(player.hp).toBe(player.maxHp);
    }

    const chosen = chooseHero(initial, "south", "scrollkeeper");
    expect(chosen.players[0].heroId).toBe("scrollkeeper");
    expect(chosen.players.filter((player) => player.heroId === "scrollkeeper")).toHaveLength(1);
    expect(chosen.revision).toBe(1);

    const duplicate = chooseHero(initial, "south", "springtide");
    expect(duplicate).toBe(initial);
  });

  it("applies hero distance passives", () => {
    const players = [
      player("south", { heroId: "whitesteed" }),
      player("east", { heroId: "cloudstep" }),
      player("north"),
      player("west"),
    ];
    // 白骑 -1：对角距离 2 变成 1；云隐 +1 与白骑抵消后仍是最小 1。
    expect(distanceBetween(players, "south", "north")).toBe(1);
    expect(distanceBetween(players, "south", "east")).toBe(1);
    // 云隐 +1：北座到东座由相邻 1 变成 2。
    expect(distanceBetween(players, "north", "east")).toBe(2);
    expect(distanceBetween(players, "north", "south")).toBe(2);
  });

  it("activates 青囊, discards a card and heals the chosen wounded target", () => {
    const cost = card("strike", "skill-cost-0");
    const game = state({}, [
      player("south", { hp: 4, maxHp: 5, heroId: "springtide", hand: [cost] }),
      player("east", { hp: 3, heroId: "redblade" }),
      player("north"),
      player("west"),
    ]);

    expect(getActiveSkillUse(game, "south")?.skill.id).toBe("qingnang");
    expect(getActiveSkillUse(game, "south")?.targetIds).toEqual(["south", "east"]);

    const pending = activateSkill(game, "south", "qingnang");
    expect(pending.stack.at(-1)).toMatchObject({ kind: "skill", ownerId: "south", skillId: "qingnang" });
    expect(pending.players[0].skillFlags["active:qingnang"]).toBe(true);

    expect(respondToSkill(pending, "south", { cardUid: "missing", targetId: "east" })).toBe(pending);
    expect(respondToSkill(pending, "south", { cardUid: "skill-cost-0", targetId: "north" })).toBe(pending);

    const resolved = respondToSkill(pending, "south", { cardUid: "skill-cost-0", targetId: "east" });
    expect(resolved.stack).toHaveLength(0);
    expect(resolved.players[0].hand).toHaveLength(0);
    expect(resolved.discard.map((entry) => entry.id)).toContain("skill-cost-0");
    expect(resolved.players[1].hp).toBe(4);
    expect(resolved.players[0].skillFlags["active:qingnang"]).toBe(true);
    expect(getActiveSkillUse(resolved, "south")).toBeUndefined();
  });

  it("lets the human decline an active skill after it enters the stack", () => {
    const cost = card("strike", "skill-decline-0");
    const game = state({}, [
      player("south", { hp: 4, maxHp: 5, heroId: "springtide", hand: [cost] }),
      player("east", { hp: 3 }),
      player("north"),
      player("west"),
    ]);
    const pending = activateSkill(game, "south", "qingnang");
    const declined = respondToSkill(pending, "south");

    expect(declined.stack).toHaveLength(0);
    expect(declined.players[0].hand.map((entry) => entry.id)).toEqual(["skill-decline-0"]);
    expect(declined.players[1].hp).toBe(3);
    expect(declined.players[0].skillFlags["active:qingnang"]).toBe(true);
    expect(getActiveSkillUse(declined, "south")).toBeUndefined();
  });

  it("lets AI use 青囊 on itself first and selects the lowest-value cost card", () => {
    const worst = card("strike", "ai-cost-strike");
    const keep = card("salve", "ai-cost-salve");
    const game = state({}, [
      player("south", { hp: 3, maxHp: 5, heroId: "springtide", hand: [keep, worst] }),
      player("east", { hp: 2 }),
      player("north"),
      player("west"),
    ]);

    expect(chooseAiMove(game, "south")).toEqual({ kind: "skill", skillId: "qingnang" });
    const pending = activateSkill(game, "south", "qingnang");
    expect(chooseAiSkillDecision(pending, "south")).toEqual({ cardUid: "ai-cost-strike", targetId: "south" });
  });

  it("uses 破军 to make the next strike deal two damage", () => {
    const cost = card("strike", "pojun-cost");
    const attack = card("strike", "pojun-attack");
    const game = state({}, [
      player("south", { heroId: "redblade", hand: [cost, attack] }),
      player("east", { hp: 4 }),
      player("north"),
      player("west"),
    ]);
    const pending = activateSkill(game, "south", "pojun");
    const buffed = respondToSkill(pending, "south", { cardUid: "pojun-cost" });
    expect(buffed.players[0].skillFlags["buff:next-strike-damage"]).toBe(true);

    const strike = playCard(buffed, "south", "pojun-attack", "east");
    expect(strike.stack.at(-1)).toMatchObject({ kind: "strike", damage: 2 });
    expect(strike.players[0].skillFlags["buff:next-strike-damage"]).toBe(false);
  });

  it("uses 坚壁 to reduce the next incoming damage by one", () => {
    const cost = card("evade", "jianbi-cost");
    const strike = card("strike", "jianbi-strike");
    const game = state({}, [
      player("south", { hp: 4, maxHp: 5, heroId: "ironward", hand: [cost] }),
      player("east", { hand: [strike] }),
      player("north", { alive: false, hp: 0, revealed: true }),
      player("west"),
    ]);
    const pending = activateSkill(game, "south", "jianbi");
    const buffed = respondToSkill(pending, "south", { cardUid: "jianbi-cost" });

    const attack = playCard({ ...buffed, activePlayerId: "east" }, "east", "jianbi-strike", "south");
    const damaged = respondToStrike(attack, "south");
    expect(damaged.players[0].hp).toBe(4);
    expect(damaged.players[0].skillFlags["buff:next-damage-reduction"]).toBe(false);
    expect(damaged.log.some((entry) => entry.text.includes("抵挡"))).toBe(true);
  });

  it("keeps 坚壁 across other players' turns until the owner's next turn starts", () => {
    const game = state({ phase: "play" }, [
      player("south", { skillFlags: { "buff:next-damage-reduction": true } }),
      player("east"),
      player("north"),
      player("west"),
    ]);

    const ended = endTurn(game, "south");
    expect(ended.players[0].skillFlags["buff:next-damage-reduction"]).toBe(true);

    const backToSouth = state({ phase: "prepare", activePlayerId: "south", turnNumber: 5 }, [
      player("south", { skillFlags: { "buff:next-damage-reduction": true } }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const expired = advancePhase(backToSouth);
    expect(expired.players[0].skillFlags["buff:next-damage-reduction"]).toBeUndefined();
    expect(expired.phase).toBe("judge");
  });

  it("uses 潜行 to further increase the distance others calculate to the owner", () => {
    const cost = card("strike", "qianxing-cost");
    const game = state({}, [
      player("south", { hp: 4, maxHp: 5, heroId: "cloudstep", hand: [cost] }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    expect(distanceBetween(game.players, "east", "south")).toBe(2);
    const pending = activateSkill(game, "south", "qianxing");
    const buffed = respondToSkill(pending, "south", { cardUid: "qianxing-cost" });
    expect(distanceBetween(buffed.players, "east", "south")).toBe(3);
  });

  it("uses 突袭 to increase attack range for the turn", () => {
    const cost = card("strike", "tuxi-cost");
    const game = state({}, [
      player("south", { hp: 4, maxHp: 5, heroId: "whitesteed", hand: [cost] }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const pending = activateSkill(game, "south", "tuxi");
    const buffed = respondToSkill(pending, "south", { cardUid: "tuxi-cost" });
    expect(attackRange(buffed.players[0])).toBe(2);
  });

  it("uses the no-cost 余烬 to draw an extra card on the next dying entry", () => {
    const game = state({ deck: [card("salve", "yujin-1"), card("salve", "yujin-2"), card("salve", "yujin-3")], rngSeed: 7 }, [
      player("south", { hp: 1, heroId: "lastwill" }),
      player("east", { hand: [card("strike", "yujin-strike")] }),
      player("north", { alive: false, hp: 0, revealed: true }),
      player("west"),
    ]);
    const pending = activateSkill(game, "south", "yujin");
    const buffed = respondToSkill(pending, "south", {});
    expect(buffed.players[0].skillFlags["buff:dying-draw"]).toBe(true);

    const attack = playCard({ ...buffed, activePlayerId: "east" }, "east", "yujin-strike", "south");
    const dying = respondToStrike(attack, "south");
    expect(dying.stack.at(-1)).toMatchObject({ kind: "dying", targetId: "south" });
    // 遗烈自动技摸 2，余烬增益再摸 1。
    expect(dying.players[0].hand).toHaveLength(3);
    expect(dying.players[0].skillFlags["buff:dying-draw"]).toBe(false);
    expect(dying.log.some((entry) => entry.text.includes("余烬"))).toBe(true);
  });

  it("uses 洞彻 and 秉笔 to discard a filtered card and draw", () => {
    const focus = card("focus", "dongche-cost");
    const dongcheGame = state({ deck: [card("strike", "dongche-d1"), card("evade", "dongche-d2")], rngSeed: 7 }, [
      player("south", { heroId: "cleareye", hand: [focus] }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const dongchePending = activateSkill(dongcheGame, "south", "dongche");
    const dongche = respondToSkill(dongchePending, "south", { cardUid: "dongche-cost" });
    expect(dongche.players[0].hand.map((entry) => entry.id).sort()).toEqual(["dongche-d1", "dongche-d2"]);
    expect(dongche.discard.map((entry) => entry.id)).toContain("dongche-cost");

    const strike = card("strike", "bingbi-cost");
    const bingbiGame = state({ deck: [card("evade", "bingbi-d1")], rngSeed: 7 }, [
      player("south", { heroId: "scrollkeeper", hand: [strike] }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const bingbiPending = activateSkill(bingbiGame, "south", "bingbi");
    const bingbi = respondToSkill(bingbiPending, "south", { cardUid: "bingbi-cost" });
    expect(bingbi.players[0].hand.map((entry) => entry.id)).toEqual(["bingbi-d1"]);
  });

  it("computes identity beliefs without reading hidden identities", () => {
    const game = state({}, [
      player("south", { identity: "lord", revealed: true }),
      player("east", { identity: "rebel", revealed: false }),
      player("north", { identity: "loyalist", revealed: false }),
      player("west", { identity: "renegade", revealed: false }),
    ]);

    const lordView = identityBelief(game, "south", "east");
    expect(lordView.lord).toBe(0);
    expect(lordView.rebel + lordView.renegade).toBeGreaterThan(lordView.loyalist);

    const rebelView = identityBelief(game, "east", "north");
    expect(rebelView.loyalist + rebelView.renegade).toBeGreaterThan(rebelView.rebel);

    expect(identityBelief(game, "south", "south")).toEqual({
      lord: 1, loyalist: 0, rebel: 0, renegade: 0,
    });
    expect(identityBelief(game, "south", "east")).toEqual(identityBelief(game, "south", "east"));
  });

  it("changes AI difficulty as part of the persisted table state", () => {
    const game = state({});
    expect(game.difficulty).toBe("standard");
    const changed = changeDifficulty(game, "tactician");
    expect(changed.difficulty).toBe("tactician");
    expect(changed.revision).toBe(game.revision + 1);
    expect(changeDifficulty(changed, "tactician")).toBe(changed);
  });

  it("heals a wounded target with the nullifyable 援护 trick", () => {
    const aid = card("aid", "aid-0");
    const game = state({}, [
      player("south", { hand: [aid] }),
      player("east", { hp: 2 }),
      player("north"),
      player("west"),
    ]);
    expect(getTargetOptions(game, "south", aid)).toEqual(["east"]);
    const resolved = passAllTrickResponses(playCard(game, "south", "aid-0", "east"));
    expect(resolved.players[1].hp).toBe(3);
    expect(resolved.discard.some((entry) => entry.id === "aid-0")).toBe(true);
  });

  it("lets 穿云 reach every other seat", () => {
    const longshot = card("longshot", "longshot-0");
    const strike = card("strike", "longshot-strike");
    const game = state({}, [
      player("south", { hand: [longshot, strike] }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const equipped = playCard(game, "south", "longshot-0", "south");
    expect(getTargetOptions(equipped, "south", strike)).toEqual(["east", "north", "west"]);
  });

  it("resolves 演策 draw-discard while keeping high-value response cards", () => {
    const game = state({ deck: [card("evade", "keep-evade"), card("salve", "keep-salve")], rngSeed: 7 }, [
      player("south", { heroId: "xuanji", hand: [card("strike", "yance-cost")] }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const pending = activateSkill(game, "south", "yance");
    const resolved = respondToSkill(pending, "south", { cardUid: "yance-cost" });
    expect(resolved.stack).toHaveLength(0);
    expect(resolved.players[0].hand.map((entry) => entry.id)).toEqual(["keep-salve"]);
    expect(resolved.discard.map((entry) => entry.id)).toEqual(expect.arrayContaining(["yance-cost", "keep-evade"]));
  });

  it("draws two cards for 金枝 when another character dies", () => {
    const game = state({ activePlayerId: "east", deck: [card("evade", "p1"), card("focus", "p2")], rngSeed: 7 }, [
      player("south", { identity: "lord", heroId: "jinyu" }),
      player("east", { identity: "rebel", hand: [card("strike", "strike-0")] }),
      player("north", { identity: "renegade", hp: 1 }),
      player("west", { identity: "loyalist" }),
    ]);
    let next = respondToStrike(playCard(game, "east", "strike-0", "north"), "north");
    while (next.stack.at(-1)?.kind === "dying") {
      const dying = next.stack.at(-1);
      if (dying?.kind !== "dying") break;
      next = respondToDying(next, dying.responders[dying.cursor]);
    }
    expect(next.players.find((player) => player.id === "north")?.alive).toBe(false);
    expect(next.players[0].hand).toHaveLength(2);
    expect(next.log.some((entry) => entry.text.includes("金枝"))).toBe(true);
  });

  it("silences the killer when 乐姬 dies", () => {
    const game = state({ activePlayerId: "east" }, [
      player("south", { identity: "lord" }),
      player("east", {
        identity: "rebel",
        heroId: "redblade",
        hand: [card("strike", "strike-0"), card("strike", "strike-1")],
      }),
      player("north", { identity: "loyalist", heroId: "yueji", hp: 1 }),
      player("west", { identity: "renegade" }),
    ]);
    let next = respondToStrike(playCard(game, "east", "strike-0", "north"), "north");
    while (next.stack.at(-1)?.kind === "dying") {
      const dying = next.stack.at(-1);
      if (dying?.kind !== "dying") break;
      next = respondToDying(next, dying.responders[dying.cursor]);
    }
    expect(next.players.find((player) => player.id === "north")?.alive).toBe(false);
    expect(next.players[1].skillFlags.silenced).toBe(true);
    expect(next.log.some((entry) => entry.text.includes("绝弦"))).toBe(true);
    expect(getActiveSkillUse(next, "east")).toBeUndefined();
  });

  it("makes the next strike unavoidable with 破坚", () => {
    const game = state({}, [
      player("south", { heroId: "liexiao", hand: [card("strike", "pojian-cost"), card("strike", "pojian-hit")] }),
      player("east", { hand: [card("evade", "evade-e")] }),
      player("north"),
      player("west"),
    ]);
    const pending = activateSkill(game, "south", "pojian");
    const buffed = respondToSkill(pending, "south", { cardUid: "pojian-cost" });
    const strike = playCard(buffed, "south", "pojian-hit", "east");
    expect(strike.stack.at(-1)).toMatchObject({ kind: "strike", unavoidable: true });
    expect(respondToStrike(strike, "east", "evade-e")).toBe(strike);
    const hit = respondToStrike(strike, "east");
    expect(hit.players[1].hp).toBe(3);
  });

  it("resets strike usage with 再战", () => {
    const game = state({}, [
      player("south", { heroId: "wufeng", hand: [card("strike", "s1"), card("strike", "zaizhan-cost"), card("strike", "s2")] }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const used = respondToStrike(playCard(game, "south", "s1", "east"), "east");
    expect(used.strikeUsed).toBe(true);
    const pending = activateSkill(used, "south", "zaizhan");
    const reset = respondToSkill(pending, "south", { cardUid: "zaizhan-cost" });
    expect(reset.strikeUsed).toBe(false);
    const second = playCard(reset, "south", "s2", "east");
    expect(second.stack.at(-1)).toMatchObject({ kind: "strike" });
  });

  it("uses the expanded active skill target effects", () => {
    const damageGame = state({}, [
      player("south", { heroId: "chongzhen", hand: [card("strike", "xianzhen-cost")] }),
      player("east", { hp: 4 }),
      player("north"),
      player("west"),
    ]);
    const damagePending = activateSkill(damageGame, "south", "xianzhen");
    const damaged = respondToSkill(damagePending, "south", { cardUid: "xianzhen-cost", targetId: "east" });
    expect(damaged.players[1].hp).toBe(3);

    const discardGame = state({}, [
      player("south", { heroId: "youjiao", hand: [card("focus", "jiaoxie-cost")] }),
      player("east", { hand: [card("evade", "victim-evade")] }),
      player("north"),
      player("west"),
    ]);
    const discardPending = activateSkill(discardGame, "south", "jiaoxie");
    const discarded = respondToSkill(discardPending, "south", { cardUid: "jiaoxie-cost", targetId: "east" });
    expect(discarded.players[1].hand).toEqual([]);
    expect(discarded.discard.some((entry) => entry.id === "victim-evade")).toBe(true);

    const delayGame = state({}, [
      player("south", { heroId: "junshi", hand: [card("focus", "kunju-cost")] }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const delayPending = activateSkill(delayGame, "south", "kunju");
    const delayed = respondToSkill(delayPending, "south", { cardUid: "kunju-cost", targetId: "east" });
    expect(delayed.players[1].skillFlags["delay:skip-play"]).toBe(true);

    const healGame = state({}, [
      player("south", { heroId: "panwei", hp: 3, maxHp: 5 }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const healPending = activateSkill(healGame, "south", "zhengbei");
    const healed = respondToSkill(healPending, "south", {});
    expect(healed.players[0].hp).toBe(4);

    const supportGame = state({ deck: [card("evade", "support-1")], rngSeed: 7 }, [
      player("south", { heroId: "fubi" }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const supportPending = activateSkill(supportGame, "south", "jujian");
    const supported = respondToSkill(supportPending, "south", { targetId: "east" });
    expect(supported.players[1].hand.map((entry) => entry.id)).toEqual(["support-1"]);

    const burstGame = state({ deck: [card("evade", "b1"), card("evade", "b2"), card("evade", "b3")], rngSeed: 7 }, [
      player("south", { heroId: "haoke", hand: [card("focus", "haozhi-cost")] }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const burstPending = activateSkill(burstGame, "south", "haozhi");
    const burst = respondToSkill(burstPending, "south", { cardUid: "haozhi-cost" });
    expect(burst.players[0].hand).toHaveLength(3);
  });

  it("draws at turn start with 夜枭巡夜", () => {
    const game = state({ phase: "prepare", deck: [card("evade", "nightowl-draw")], rngSeed: 7 }, [
      player("south", { heroId: "nightowl" }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const next = advancePhase(game);
    expect(next.phase).toBe("judge");
    expect(next.players[0].hand.map((entry) => entry.id)).toEqual(["nightowl-draw"]);
    expect(next.log.some((entry) => entry.text.includes("巡夜"))).toBe(true);
  });

  it("heals the active player at turn start with 回春", () => {
    const game = state({ phase: "prepare" }, [
      player("south", { hp: 2, heroId: "springtide" }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const next = advancePhase(game);
    expect(next.phase).toBe("judge");
    expect(next.players[0].hp).toBe(3);
    expect(next.log.some((entry) => entry.text.includes("回春"))).toBe(true);
  });

  it("draws at turn end with 筹谋 and resets once-per-turn flags", () => {
    const game = state({ deck: [card("strike", "drawn-0")], rngSeed: 7 }, [
      player("south", { heroId: "scrollkeeper", skillFlags: { damageDealt: true } }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const next = endTurn(game, "south");
    expect(next.players[0].hand.map((entry) => entry.id)).toEqual(["drawn-0"]);
    expect(next.players[0].skillFlags).toEqual({});
    expect(next.activePlayerId).toBe("east");
    expect(next.log.some((entry) => entry.text.includes("筹谋"))).toBe(true);
  });

  it("triggers 厉兵 and 承创 once per turn on damage", () => {
    const game = state({ deck: [card("salve", "p1"), card("salve", "p2")], rngSeed: 7 }, [
      player("south", { hand: [card("strike", "s1"), card("strike", "s2")], heroId: "redblade" }),
      player("east", { hp: 3, heroId: "ironward" }),
      player("north"),
      player("west"),
    ]);
    let next = respondToStrike(playCard(game, "south", "s1", "east"), "east");
    expect(next.players[0].hand).toHaveLength(2); // s2 + 厉兵摸的疗元
    expect(next.players[1].hand).toHaveLength(1); // 承创摸的疗元
    expect(next.players[1].hp).toBe(2);

    next = respondToStrike(playCard({ ...next, strikeUsed: false }, "south", "s2", "east"), "east");
    expect(next.players[1].hp).toBe(1);
    // 本回合第二次伤害不再触发一次性技能。
    expect(next.players[0].hand).toHaveLength(1);
    expect(next.players[1].hand).toHaveLength(1);
    expect(next.players[0].skillFlags.damageDealt).toBe(true);
    expect(next.players[1].skillFlags.damageReceived).toBe(true);
  });

  it("draws two cards when 遗烈 enters dying", () => {
    const game = state({ deck: [card("salve", "p1"), card("salve", "p2")], rngSeed: 7 }, [
      player("south", { hand: [card("strike", "s1")] }),
      player("east", { hp: 1, heroId: "lastwill" }),
      player("north"),
      player("west"),
    ]);
    let next = respondToStrike(playCard(game, "south", "s1", "east"), "east");
    expect(next.stack.at(-1)).toMatchObject({ kind: "dying", targetId: "east" });
    expect(next.players[1].hand).toHaveLength(2);
    expect(next.log.some((entry) => entry.text.includes("死志"))).toBe(true);

    const dying = next.stack.at(-1);
    if (dying?.kind === "dying") next = respondToDying(next, dying.responders[dying.cursor], "p1");
    expect(next.stack).toHaveLength(0);
    expect(next.players[1].hp).toBe(1);
  });

  it("draws an extra card after 明鉴 resolves a trick", () => {
    const game = state({ deck: [card("strike", "d1"), card("evade", "d2"), card("salve", "d3")], rngSeed: 7 }, [
      player("south", { hand: [card("focus", "focus-0")], heroId: "cleareye" }),
      player("east"),
      player("north"),
      player("west"),
    ]);
    const next = passAllTrickResponses(playCard(game, "south", "focus-0", "south"));
    expect(next.players[0].hand).toHaveLength(3); // 聚势摸 2 + 洞彻摸 1
    expect(next.log.some((entry) => entry.text.includes("洞彻"))).toBe(true);
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

  it("does not reward a renegade for killing a rebel", () => {
    const game = state({ activePlayerId: "east" }, [
      player("south", { hp: 1, identity: "rebel", hand: [card("strike", "corpse-rebel")] }),
      player("east", { identity: "renegade", hand: [card("strike", "strike-0")] }),
      player("north", { identity: "lord", revealed: true, hp: 5 }),
      player("west", { identity: "loyalist" }),
    ]);
    const dead = respondToStrike(playCard(game, "east", "strike-0", "south"), "south");
    let next = dead;
    while (next.stack.at(-1)?.kind === "dying") {
      const dying = next.stack.at(-1);
      if (dying?.kind !== "dying") break;
      next = respondToDying(next, dying.responders[dying.cursor]);
    }
    expect(next.players[1].hand).toHaveLength(0);
    expect(next.players[1].hp).toBe(4);
    expect(next.log.some((entry) => entry.text.includes("击退叛锋"))).toBe(false);
  });

  it("ends the match when a rebel takes down the lord without awarding decorative cards", () => {
    const game = state({ activePlayerId: "east", deck: [card("evade", "d1"), card("evade", "d2"), card("evade", "d3")], rngSeed: 7 }, [
      player("south", { hp: 1, identity: "lord", revealed: true, hand: [card("strike", "lord-card")] }),
      player("east", { identity: "rebel", hand: [card("strike", "strike-0")] }),
      player("north", { identity: "loyalist", alive: false, hp: 0, revealed: true }),
      player("west", { identity: "renegade" }),
    ]);
    const dead = respondToStrike(playCard(game, "east", "strike-0", "south"), "south");
    let next = dead;
    while (next.stack.at(-1)?.kind === "dying") {
      const dying = next.stack.at(-1);
      if (dying?.kind !== "dying") break;
      next = respondToDying(next, dying.responders[dying.cursor]);
    }
    expect(next.status).toBe("finished");
    expect(next.winner).toBe("rebel");
    expect(next.players[1].hand).toHaveLength(0);
    expect(next.deck).toHaveLength(3);
    expect(next.log.some((entry) => entry.text.includes("击退主君，摸 3 张牌"))).toBe(false);
  });

  it("asks the living loyalist to choose whether to protect the lord", () => {
    const game = state({ activePlayerId: "east" }, [
      player("south", { hp: 3, identity: "lord", revealed: true }),
      player("east", { identity: "rebel", hand: [card("strike", "strike-0")] }),
      player("north", { identity: "loyalist", hand: [card("evade", "protect-cost")] }),
      player("west", { identity: "renegade" }),
    ]);

    const pendingProtect = respondToStrike(playCard(game, "east", "strike-0", "south"), "south");
    expect(pendingProtect.stack.at(-1)).toMatchObject({
      kind: "protect",
      actorId: "east",
      targetId: "south",
      protectorId: "north",
      damage: 1,
    });
    expect(pendingProtect.players[0].hp).toBe(3);

    const protectedHit = respondToProtect(pendingProtect, "north", "protect-cost");
    expect(protectedHit.stack).toHaveLength(0);
    expect(protectedHit.players[0].hp).toBe(3);
    expect(protectedHit.players[2].revealed).toBe(true);
    expect(protectedHit.discard.map((entry) => entry.id)).toContain("protect-cost");
    expect(protectedHit.log.some((entry) => entry.text.includes("north弃置「闪避」护主"))).toBe(true);
  });

  it("lets the loyalist decline protection without being named in the log", () => {
    const game = state({ activePlayerId: "east" }, [
      player("south", { hp: 3, identity: "lord", revealed: true }),
      player("east", { identity: "rebel", hand: [card("strike", "strike-0")] }),
      player("north", { identity: "loyalist", hand: [card("evade", "protect-cost")] }),
      player("west", { identity: "renegade" }),
    ]);

    const pendingProtect = respondToStrike(playCard(game, "east", "strike-0", "south"), "south");
    const hit = respondToProtect(pendingProtect, "north");
    expect(hit.stack).toHaveLength(0);
    expect(hit.players[0].hp).toBe(2);
    expect(hit.log.some((entry) => entry.text.includes("north"))).toBe(false);
    expect(hit.log.some((entry) => entry.text.includes("无人护主"))).toBe(true);
  });

  it("does not offer protection when the loyalist is the attacker", () => {
    const game = state({ activePlayerId: "east" }, [
      player("south", { hp: 5, identity: "lord", revealed: true }),
      player("east", { identity: "loyalist", hand: [card("strike", "strike-0")] }),
      player("north", { identity: "rebel" }),
      player("west", { identity: "renegade" }),
    ]);

    const hit = respondToStrike(playCard(game, "east", "strike-0", "south"), "south");
    expect(hit.stack.at(-1)?.kind).not.toBe("protect");
    expect(hit.players[0].hp).toBe(4);
  });

  it("deals damage directly when no living loyalist can pay the protection cost", () => {
    const game = state({ activePlayerId: "east" }, [
      player("south", { hp: 3, identity: "lord", revealed: true }),
      player("east", { identity: "rebel", hand: [card("strike", "strike-1")] }),
      player("north", { identity: "loyalist", hand: [] }),
      player("west", { identity: "renegade" }),
    ]);

    const hit = respondToStrike(playCard(game, "east", "strike-1", "south"), "south");
    expect(hit.stack.at(-1)?.kind).not.toBe("protect");
    expect(hit.players[0].hp).toBe(2);
  });

  it("lets 拆解 strip equipment or delayed tricks when the target has no hand", () => {
    const equipmentGame = state({}, [
      player("south", { hand: [card("dismantle", "dismantle-0")] }),
      player("east", { hand: [], equipment: { weapon: card("longblade", "longblade-0") } }),
      player("north"),
      player("west"),
    ]);
    const strippedEquipment = passAllTrickResponses(playCard(equipmentGame, "south", "dismantle-0", "east"));
    expect(strippedEquipment.players[1].equipment.weapon).toBeUndefined();
    expect(strippedEquipment.discard.some((entry) => entry.id === "longblade-0")).toBe(true);

    const delayed = card("delay-burn", "delay-burn-0");
    const delayedGame = state({
      delayedTricks: {
        south: [], north: [], west: [],
        east: [{ card: delayed, sourceActorId: "south" }],
      },
    }, [
      player("south", { hand: [card("dismantle", "dismantle-1")] }),
      player("east", { hand: [] }),
      player("north"),
      player("west"),
    ]);
    const strippedDelayed = passAllTrickResponses(playCard(delayedGame, "south", "dismantle-1", "east"));
    expect(strippedDelayed.delayedTricks.east).toEqual([]);
    expect(strippedDelayed.discard.some((entry) => entry.id === "delay-burn-0")).toBe(true);
  });

  it("lets 牵袭 take equipment or delayed tricks from an adjacent player", () => {
    const equipmentGame = state({}, [
      player("south", { hand: [card("snatch", "snatch-0")] }),
      player("east", { hand: [], equipment: { weapon: card("longblade", "longblade-0") } }),
      player("north"),
      player("west"),
    ]);
    const snatchedEquipment = passAllTrickResponses(playCard(equipmentGame, "south", "snatch-0", "east"));
    expect(snatchedEquipment.players[1].equipment.weapon).toBeUndefined();
    expect(snatchedEquipment.players[0].hand.some((entry) => entry.id === "longblade-0")).toBe(true);

    const delayed = card("delay-draw", "delay-draw-0");
    const delayedGame = state({
      delayedTricks: {
        south: [], north: [], west: [],
        east: [{ card: delayed, sourceActorId: "south" }],
      },
    }, [
      player("south", { hand: [card("snatch", "snatch-1")] }),
      player("east", { hand: [] }),
      player("north"),
      player("west"),
    ]);
    const snatchedDelayed = passAllTrickResponses(playCard(delayedGame, "south", "snatch-1", "east"));
    expect(snatchedDelayed.delayedTricks.east).toEqual([]);
    expect(snatchedDelayed.players[0].hand.some((entry) => entry.id === "delay-draw-0")).toBe(true);
  });

  it("uses 犀甲 to reduce the first damage each turn", () => {
    const armored = state({ activePlayerId: "east" }, [
      player("south", { hp: 4, maxHp: 5, equipment: { armor: card("armor", "armor-0") } }),
      player("east", { hand: [card("strike", "strike-0"), card("strike", "strike-1")] }),
      player("north", { alive: false, hp: 0, revealed: true }),
      player("west", { identity: "loyalist", alive: false, hp: 0, revealed: true }),
    ]);
    let next = respondToStrike(playCard(armored, "east", "strike-0", "south"), "south");
    expect(next.players[0].hp).toBe(4);
    expect(next.players[0].skillFlags["armor:reduced"]).toBe(true);
    expect(next.log.some((entry) => entry.text.includes("犀甲"))).toBe(true);

    next = respondToStrike(playCard({ ...next, strikeUsed: false }, "east", "strike-1", "south"), "south");
    expect(next.players[0].hp).toBe(3);
  });

  it("resolves 刺探 with a correct or wrong identity guess", () => {
    const probeGame = state({ deck: [card("evade", "d1"), card("evade", "d2")], rngSeed: 7 }, [
      player("south", { hand: [card("probe", "probe-0")] }),
      player("east", { identity: "rebel" }),
      player("north", { identity: "loyalist" }),
      player("west", { identity: "renegade" }),
    ]);
    const pending = passAllTrickResponses(playCard(probeGame, "south", "probe-0", "east"));
    expect(pending.stack.at(-1)).toMatchObject({ kind: "probe", actorId: "south", targetId: "east" });

    const guessed = respondToProbe(pending, "south", "rebel");
    expect(guessed.stack).toHaveLength(0);
    expect(guessed.players[1].revealed).toBe(true);
    expect(guessed.players[0].hand.map((entry) => entry.id)).toEqual(["d2", "d1"]);
    expect(guessed.log.some((entry) => entry.text.includes("是「叛锋」"))).toBe(true);

    const wrongGame = state({}, [
      player("south", { hand: [card("probe", "probe-1"), card("strike", "probe-cost")] }),
      player("east", { identity: "rebel" }),
      player("north", { identity: "loyalist" }),
      player("west", { identity: "renegade" }),
    ]);
    const wrongPending = passAllTrickResponses(playCard(wrongGame, "south", "probe-1", "east"));
    const missed = respondToProbe(wrongPending, "south", "loyalist");
    expect(missed.players[1].revealed).toBe(false);
    expect(missed.players[0].hand).toEqual([]);
    expect(missed.discard.some((entry) => entry.id === "probe-cost")).toBe(true);
    expect(missed.log.some((entry) => entry.text.includes("是「叛锋」"))).toBe(false);
  });

  it("remembers public loyalist signals when forming identity beliefs", () => {
    const game = state({ log: [{ id: 1, text: "north弃置「闪避」护主，为主君抵挡 1 点伤害。" }] }, [
      player("south"),
      player("east"),
      player("north", { identity: "loyalist" }),
      player("west"),
    ]);
    const belief = identityBelief(game, "east", "north");
    expect(belief.loyalist).toBeGreaterThan(belief.rebel);
    expect(belief.loyalist).toBeGreaterThan(belief.renegade);
  });

  it("applies non-lethal global overheat after the configured round", () => {
    const game = state({ turnNumber: 96, phase: "play" }, [
      player("south", { hp: 5, maxHp: 5 }),
      player("east", { hp: 4 }),
      player("north", { hp: 4 }),
      player("west", { hp: 1 }),
    ]);
    const next = endTurn(game, "south");
    expect(next.turnNumber).toBe(97);
    expect(next.players.map((entry) => entry.hp)).toEqual([3, 2, 2, 1]);
    expect(next.log.some((entry) => entry.text.includes("过载"))).toBe(true);
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
    expect(game.phase).toBe("judge");
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

  it("resolves a duel with alternating strikes until someone cannot play", () => {
    const game = state({}, [
      player("south", { hand: [card("duel", "duel-0"), card("strike", "strike-s")] }),
      player("east", { hand: [card("strike", "strike-e")] }),
      player("north"),
      player("west"),
    ]);
    let next = passAllTrickResponses(playCard(game, "south", "duel-0", "east"));
    expect(next.stack.at(-1)).toMatchObject({ kind: "duel", turnId: "east" });

    next = respondToDuel(next, "east", "strike-e");
    expect(next.stack.at(-1)).toMatchObject({ kind: "duel", turnId: "south" });
    next = respondToDuel(next, "south", "strike-s");
    expect(next.stack.at(-1)).toMatchObject({ kind: "duel", turnId: "east" });
    next = respondToDuel(next, "east");

    expect(next.stack).toHaveLength(0);
    expect(next.players[1].hp).toBe(3);
    expect(next.discard.map((entry) => entry.id)).toEqual(expect.arrayContaining(["duel-0", "strike-e", "strike-s"]));
  });

  it("lets nullify stop a duel before it starts", () => {
    const game = state({}, [
      player("south", { hand: [card("duel", "duel-0")] }),
      player("east", { hand: [card("nullify", "nullify-0")] }),
      player("north"),
      player("west"),
    ]);
    let next = playCard(game, "south", "duel-0", "east");
    next = respondToTrick(next, "south");
    next = respondToTrick(next, "east", "nullify-0");
    next = passAllTrickResponses(next);

    expect(next.stack).toHaveLength(0);
    expect(next.players[1].hp).toBe(4);
    expect(next.log.some((entry) => entry.text.includes("约斗") && entry.text.includes("抵消"))).toBe(true);
  });

  it("defaults horde, volley and grove to the actor when targetId is omitted", () => {
    for (const type of ["horde", "volley", "grove"] as const) {
      const game = state({}, [
        player("south", { hand: [card(type, `${type}-0`)] }),
        player("east"),
        player("north"),
        player("west"),
      ]);
      const played = playCard(game, "south", `${type}-0`);
      expect(played).not.toBe(game);
      expect(played.stack.at(-1)).toMatchObject({ kind: "trick", cardType: type });
    }
  });

  it("cycles horde responses and damages players who do not strike", () => {
    const game = state({}, [
      player("south", { hand: [card("horde", "horde-0")] }),
      player("east", { hand: [card("strike", "strike-e")] }),
      player("north"),
      player("west", { hand: [card("strike", "strike-w")] }),
    ]);
    let next = passAllTrickResponses(playCard(game, "south", "horde-0", "south"));
    expect(next.stack.at(-1)).toMatchObject({ kind: "horde", cursor: 0 });

    next = respondToHorde(next, "east", "strike-e");
    expect(next.stack.at(-1)).toMatchObject({ kind: "horde", cursor: 1 });
    next = respondToHorde(next, "north");
    expect(next.players[2].hp).toBe(3);
    expect(next.stack.at(-1)).toMatchObject({ kind: "horde", cursor: 2 });
    next = respondToHorde(next, "west", "strike-w");

    expect(next.stack).toHaveLength(0);
    expect(next.players[1].hp).toBe(4);
    expect(next.players[3].hp).toBe(4);
    expect(next.discard.map((entry) => entry.id)).toEqual(expect.arrayContaining(["horde-0", "strike-e", "strike-w"]));
  });

  it("cycles volley responses and damages players who do not evade", () => {
    const game = state({}, [
      player("south", { hand: [card("volley", "volley-0")] }),
      player("east", { hand: [card("evade", "evade-e")] }),
      player("north"),
      player("west", { hand: [card("evade", "evade-w")] }),
    ]);
    let next = passAllTrickResponses(playCard(game, "south", "volley-0", "south"));
    next = respondToVolley(next, "east", "evade-e");
    next = respondToVolley(next, "north");
    expect(next.players[2].hp).toBe(3);
    next = respondToVolley(next, "west", "evade-w");

    expect(next.stack).toHaveLength(0);
    expect(next.players[1].hp).toBe(4);
    expect(next.players[3].hp).toBe(4);
  });

  it("suspends a horde while a defender is dying and resumes afterwards", () => {
    const game = state({}, [
      player("south", { hand: [card("horde", "horde-0")] }),
      player("east", { hp: 1 }),
      player("north", { hand: [card("strike", "strike-n"), card("salve", "salve-n")] }),
      player("west"),
    ]);
    let next = passAllTrickResponses(playCard(game, "south", "horde-0", "south"));
    next = respondToHorde(next, "east");
    // 东座倒下：濒死帧压在合围帧之上，合围的游标已经前进到北座。
    expect(next.stack.at(-1)).toMatchObject({ kind: "dying", targetId: "east" });
    expect(next.stack.at(-2)).toMatchObject({ kind: "horde", cursor: 1 });

    next = respondToDying(next, "east");
    next = respondToDying(next, "north", "salve-n");
    expect(next.players[1].hp).toBe(1);
    expect(next.stack.at(-1)).toMatchObject({ kind: "horde", cursor: 1 });

    next = respondToHorde(next, "north", "strike-n");
    expect(next.stack.at(-1)).toMatchObject({ kind: "horde", cursor: 2 });
    next = respondToHorde(next, "west");
    expect(next.stack).toHaveLength(0);
    expect(next.players[3].hp).toBe(3);
  });

  it("heals every wounded player with grove", () => {
    const game = state({}, [
      player("south", { hp: 2, hand: [card("grove", "grove-0")] }),
      player("east", { hp: 3 }),
      player("north", { hp: 4 }),
      player("west", { hp: 1 }),
    ]);
    const next = passAllTrickResponses(playCard(game, "south", "grove-0", "south"));
    expect(next.stack).toHaveLength(0);
    expect(next.players.map((entry) => entry.hp)).toEqual([3, 4, 4, 2]);
  });

  it("AI plays and responds to the expanded trick pool", () => {
    expect(chooseAiDuelResponse(state({}), "east")).toBeUndefined();
    const duelGame = state({}, [
      player("south"),
      player("east", { hand: [card("strike", "strike-e")] }),
      player("north"),
      player("west"),
    ]);
    expect(chooseAiDuelResponse(duelGame, "east")).toBe("strike-e");

    const hordeGame = state({ revision: 0 }, [
      player("south"),
      player("east", { hp: 1, hand: [card("strike", "strike-e")] }),
      player("north"),
      player("west"),
    ]);
    expect(chooseAiHordeResponse(hordeGame, "east")).toBe("strike-e");
    const volleyGame = state({ revision: 0 }, [
      player("south"),
      player("east", { hp: 1, hand: [card("evade", "evade-e")] }),
      player("north"),
      player("west"),
    ]);
    expect(chooseAiVolleyResponse(volleyGame, "east")).toBe("evade-e");

    const moveGame = state({ activePlayerId: "east" }, [
      player("south"),
      player("east", { hand: [card("horde", "horde-e")] }),
      player("north"),
      player("west"),
    ]);
    expect(chooseAiMove(moveGame, "east")).toMatchObject({ kind: "play", cardUid: "horde-e" });
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

  it("plays a delayed trick into the target judge area instead of the discard", () => {
    const delayed = card("delay-play", "delay-play-0");
    const game = state({}, [
      player("south", { hand: [delayed] }),
      player("east"),
      player("north"),
      player("west"),
    ]);

    expect(getTargetOptions(game, "south", delayed)).toEqual(["east", "west"]);
    const played = playCard(game, "south", "delay-play-0", "east");
    expect(played.delayedTricks.east.map((entry) => entry.card.id)).toEqual(["delay-play-0"]);
    expect(played.discard.map((entry) => entry.id)).not.toContain("delay-play-0");
    expect(getTargetOptions({ ...played, stack: [] }, "south", card("delay-draw", "delay-draw-1"))).not.toContain("east");
  });

  it("judges 断锋 and skips the play phase when the judged card is not a strike", () => {
    const delayed = card("delay-play", "delay-play-0");
    const game = state({
      phase: "judge",
      activePlayerId: "east",
      deck: [card("strike", "draw-1"), card("evade", "draw-2"), card("salve", "judge-0")],
      rngSeed: 7,
      delayedTricks: {
        south: [], west: [], north: [],
        east: [{ card: delayed, sourceActorId: "south" }],
      },
    }, [
      player("south"),
      player("east", { hp: 3 }),
      player("north"),
      player("west"),
    ]);

    const pending = advancePhase(game);
    expect(pending.stack.at(-1)).toMatchObject({ kind: "delayed", ownerId: "east" });
    const judged = respondToDelayed(pending, "east");
    expect(judged.delayedTricks.east).toEqual([]);
    expect(judged.players[1].skillFlags["delay:skip-play"]).toBe(true);

    let next = advancePhase(judged);
    expect(next.phase).toBe("draw");
    next = advancePhase(next);
    expect(next.phase).toBe("discard");
    expect(next.players[1].hand).toHaveLength(2);
    expect(next.players[1].skillFlags["delay:skip-play"]).toBe(false);
  });

  it("judges 困阵 and skips the draw phase when the judged card is not a trick", () => {
    const delayed = card("delay-draw", "delay-draw-0");
    const game = state({
      phase: "judge",
      activePlayerId: "east",
      deck: [card("strike", "judge-0"), card("strike", "draw-1"), card("evade", "draw-2")],
      rngSeed: 7,
      delayedTricks: {
        south: [], west: [], north: [],
        east: [{ card: delayed, sourceActorId: "south" }],
      },
    }, [
      player("south"),
      player("east"),
      player("north"),
      player("west"),
    ]);

    let next = respondToDelayed(advancePhase(game), "east");
    expect(next.players[1].skillFlags["delay:skip-draw"]).toBe(true);
    next = advancePhase(next);
    expect(next.phase).toBe("draw");
    next = advancePhase(next);
    expect(next.phase).toBe("play");
    expect(next.players[1].hand).toHaveLength(0);
    expect(next.players[1].skillFlags["delay:skip-draw"]).toBe(false);
  });

  it("judges 焚营 and damages the owner when the judged card is a trick", () => {
    const delayed = card("delay-burn", "delay-burn-0");
    const game = state({
      phase: "judge",
      activePlayerId: "east",
      deck: [card("strike", "draw-1"), card("evade", "draw-2"), card("focus", "judge-focus")],
      rngSeed: 7,
      delayedTricks: {
        south: [], west: [], north: [],
        east: [{ card: delayed, sourceActorId: "south" }],
      },
    }, [
      player("south"),
      player("east", { hp: 3 }),
      player("north"),
      player("west"),
    ]);

    const judged = respondToDelayed(advancePhase(game), "east");
    expect(judged.delayedTricks.east).toEqual([]);
    expect(judged.players[1].hp).toBe(2);
    expect(judged.discard.some((entry) => entry.id === "delay-burn-0")).toBe(true);
  });

  it("ends the turn immediately when 焚营 kills the judge instead of giving the corpse a draw and play phase", () => {
    const delayed = card("delay-burn", "delay-burn-0");
    const game = state({
      phase: "judge",
      activePlayerId: "east",
      deck: [card("focus", "judge-focus")],
      rngSeed: 7,
      delayedTricks: {
        south: [], west: [], north: [],
        east: [{ card: delayed, sourceActorId: "south" }],
      },
    }, [
      player("south"),
      player("east", { hp: 1 }),
      player("north"),
      player("west"),
    ]);

    let next = respondToDelayed(advancePhase(game), "east");
    while (next.stack.at(-1)?.kind === "dying") {
      const dying = next.stack.at(-1);
      if (dying?.kind !== "dying") break;
      next = respondToDying(next, dying.responders[dying.cursor]);
    }

    const east = next.players.find((player) => player.id === "east")!;
    expect(east.alive).toBe(false);
    expect(east.hand).toEqual([]);
    expect(next.stack).toHaveLength(0);
    expect(next.phase).toBe("judge");
    expect(next.activePlayerId).toBe("east");

    const handedOff = advancePhase(next);
    expect(handedOff.phase).toBe("prepare");
    expect(handedOff.activePlayerId).toBe("north");
    expect(handedOff.turnNumber).toBe(2);
    expect(handedOff.deck).toHaveLength(0);
    expect(handedOff.log.some((entry) => entry.text.includes("east的回合结束"))).toBe(true);
  });

  it("does not let a dead active player draw, play or discard cards", () => {
    const corpseStrike = card("strike", "corpse-strike");
    const corpse = player("east", {
      alive: false,
      hp: 0,
      revealed: true,
      hand: [corpseStrike, card("evade", "corpse-evade")],
    });
    const game = state({ phase: "play", activePlayerId: "east" }, [
      player("south"),
      corpse,
      player("north"),
      player("west"),
    ]);

    expect(getPlayableCards(game, "east")).toEqual([]);
    expect(getTargetOptions(game, "east", corpseStrike)).toEqual([]);
    expect(playCard(game, "east", "corpse-strike", "south")).toBe(game);

    const handedOff = endTurn(game, "east");
    expect(handedOff.phase).toBe("prepare");
    expect(handedOff.activePlayerId).toBe("north");
  });

  it("completes deterministic all-bot games without stalling", () => {
    let completed = 0;
    for (let seed = 1; seed <= 8; seed += 1) {
      const random = (() => {
        let value = seed;
        return () => {
          value = (value * 16_807) % 2_147_483_647;
          return value / 2_147_483_647;
        };
      })();
      let game = createInitialState(random);
      let guard = 0;
      while (game.status === "playing" && guard < 3_000) {
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
        } else if (top?.kind === "skill") {
          game = respondToSkill(game, top.ownerId, chooseAiSkillDecision(game, top.ownerId));
        } else if (top?.kind === "protect") {
          game = respondToProtect(game, top.protectorId, chooseAiProtectResponse(game, top.protectorId));
        } else if (top?.kind === "probe") {
          game = respondToProbe(game, top.actorId, chooseAiProbeGuess(game, top.actorId));
        } else if (top?.kind === "delayed") {
          game = respondToDelayed(game, top.ownerId);
        } else if (top?.kind === "trick") {
          const responder = top.responders[top.cursor];
          const nullifyUid = chooseAiNullifyResponse(game, responder);
          game = respondToTrick(game, responder, nullifyUid);
        } else if (top?.kind === "duel") {
          const strikeUid = chooseAiDuelResponse(game, top.turnId);
          game = respondToDuel(game, top.turnId, strikeUid);
        } else if (top?.kind === "horde") {
          const responder = top.responders[top.cursor];
          const strikeUid = chooseAiHordeResponse(game, responder);
          game = respondToHorde(game, responder, strikeUid);
        } else if (top?.kind === "volley") {
          const responder = top.responders[top.cursor];
          const evadeUid = chooseAiVolleyResponse(game, responder);
          game = respondToVolley(game, responder, evadeUid);
        } else if (game.phase === "discard") {
          const toDiscard = chooseAiDiscards(game, game.activePlayerId);
          game = toDiscard.length > 0 ? discardCards(game, game.activePlayerId, toDiscard) : advancePhase(game);
        } else if (game.phase === "play") {
          const move = chooseAiMove(game, game.activePlayerId);
          if (move.kind === "skill") {
            game = activateSkill(game, game.activePlayerId, move.skillId);
          } else if (move.kind === "play") {
            game = playCard(game, game.activePlayerId, move.cardUid, move.targetId);
          } else {
            game = endTurn(game, game.activePlayerId);
          }
        } else {
          game = advancePhase(game);
        }
        expect(game).not.toBe(before);
      }
      if (game.status === "finished") completed += 1;
    }
    // 主动技与延时牌加入后，部分 AI 对局会进入非常长的拉锯；3000 步内
    // 无进展才是引擎软锁，因此只要求一部分固定种子在上限内完成。
    expect(completed).toBeGreaterThanOrEqual(4);
  }, 15_000);
});
