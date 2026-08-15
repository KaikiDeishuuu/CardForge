/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GamePersistenceHandle } from "../../core/games/types";
import { SoundProvider } from "../../shared/audio/SoundProvider";
import { buildDeck } from "./domain/data";
import { DING_SAVE_SCHEMA_VERSION } from "./domain/persistence";
import { createDefaultDingRootState, startDingMatch, startDingMatchWithHeroDraft, type DingRootState } from "./domain/session";
import { createInitialState } from "./domain/engine";
import { DingDingGame } from "./DingDingGame";
import type { DingPlayer, DingState } from "./domain/types";

function skillTable(pending: boolean): DingState {
  const deck = buildDeck();
  const cost = deck.find((card) => card.type === "strike")!;
  const heroIds = ["springtide", "redblade", "ironward", "cloudstep"] as const;
  const players: DingPlayer[] = [
    {
      id: "south", displayName: "你", controller: "human", seat: 0,
      identity: "lord", revealed: true, hp: 4, maxHp: 5, alive: true,
      hand: [cost], equipment: {}, heroId: heroIds[0], skillFlags: pending ? { "active:qingnang": true } : {},
    },
    {
      id: "east", displayName: "东座", controller: "ai", seat: 1,
      identity: "rebel", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: heroIds[1], skillFlags: {},
    },
    {
      id: "north", displayName: "北座", controller: "ai", seat: 2,
      identity: "loyalist", revealed: false, hp: 3, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: heroIds[2], skillFlags: {},
    },
    {
      id: "west", displayName: "西座", controller: "ai", seat: 3,
      identity: "renegade", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: heroIds[3], skillFlags: {},
    },
  ];
  return {
    revision: pending ? 1 : 0,
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
    stack: pending ? [{
      kind: "skill",
      ownerId: "south",
      skillId: "qingnang",
      prompt: "选择一张手牌作为消耗，并选择一名受伤角色回复 1 点体力。",
      targetIds: ["south", "north"],
    }] : [],
    log: [],
    rngSeed: 1,
  };
}

function protectTable(): DingState {
  const deck = buildDeck();
  const strike = deck.find((card) => card.type === "strike")!;
  const cost = deck.find((card) => card.type === "focus")!;
  const heroIds = ["redblade", "ironward", "springtide", "cloudstep"] as const;
  const players: DingPlayer[] = [
    {
      id: "south", displayName: "你", controller: "human", seat: 0,
      identity: "loyalist", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [cost], equipment: {}, heroId: heroIds[0], skillFlags: {},
    },
    {
      id: "east", displayName: "东座", controller: "ai", seat: 1,
      identity: "rebel", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: heroIds[1], skillFlags: {},
    },
    {
      id: "north", displayName: "北座", controller: "ai", seat: 2,
      identity: "lord", revealed: true, hp: 5, maxHp: 5, alive: true,
      hand: [], equipment: {}, heroId: heroIds[2], skillFlags: {},
    },
    {
      id: "west", displayName: "西座", controller: "ai", seat: 3,
      identity: "renegade", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: heroIds[3], skillFlags: {},
    },
  ];
  return {
    revision: 3,
    status: "playing",
    phase: "play",
    difficulty: "standard",
    turnNumber: 1,
    activePlayerId: "east",
    players,
    deck: deck.filter((card) => card.id !== strike.id && card.id !== cost.id),
    discard: [strike],
    delayedTricks: { south: [], east: [], north: [], west: [] },
    strikeUsed: true,
    stack: [{
      kind: "protect",
      actorId: "east",
      targetId: "north",
      protectorId: "south",
      cardUid: strike.id,
      damage: 1,
    }],
    log: [],
    rngSeed: 1,
  };
}

function probeTable(): DingState {
  const deck = buildDeck();
  const probe = deck.find((card) => card.type === "probe")!;
  const heroIds = ["redblade", "ironward", "springtide", "cloudstep"] as const;
  const players: DingPlayer[] = [
    {
      id: "south", displayName: "你", controller: "human", seat: 0,
      identity: "lord", revealed: true, hp: 5, maxHp: 5, alive: true,
      hand: [], equipment: {}, heroId: heroIds[0], skillFlags: {},
    },
    {
      id: "east", displayName: "东座", controller: "ai", seat: 1,
      identity: "rebel", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: heroIds[1], skillFlags: {},
    },
    {
      id: "north", displayName: "北座", controller: "ai", seat: 2,
      identity: "loyalist", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: heroIds[2], skillFlags: {},
    },
    {
      id: "west", displayName: "西座", controller: "ai", seat: 3,
      identity: "renegade", revealed: false, hp: 4, maxHp: 4, alive: true,
      hand: [], equipment: {}, heroId: heroIds[3], skillFlags: {},
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
    deck: deck.filter((card) => card.id !== probe.id),
    discard: [probe],
    delayedTricks: { south: [], east: [], north: [], west: [] },
    strikeUsed: false,
    stack: [{
      kind: "probe",
      actorId: "south",
      targetId: "east",
      cardUid: probe.id,
    }],
    log: [],
    rngSeed: 1,
  };
}

function finishedReviewState(): DingState {
  const state = createInitialState(() => 0.37);
  const human = state.players.find((player) => player.controller === "human")!;
  const winner = human.identity === "lord" || human.identity === "loyalist"
    ? "lord-side"
    : human.identity === "rebel"
      ? "rebel"
      : "renegade";
  const players = state.players.map((player) => {
    const won = winner === "lord-side"
      ? player.identity === "lord" || player.identity === "loyalist"
      : winner === player.identity;
    return won
      ? player
      : { ...player, alive: false, hp: 0, revealed: true };
  });
  return {
    ...state,
    revision: state.revision + 1,
    status: "finished",
    phase: "finished",
    winner,
    players,
    stack: [],
    log: [
      { id: 1, text: "普通行动。" },
      { id: 2, text: "一名角色退场，身份揭示。" },
      { id: 3, text: "主君方达成胜利。" },
    ],
  };
}

function renderWithState(state: DingState) {
  const save = vi.fn<GamePersistenceHandle["save"]>();
  const root = startDingMatch(createDefaultDingRootState(state.difficulty), state);
  return renderWithRoot(root, save);
}

function renderWithRoot(root: DingRootState, save = vi.fn<GamePersistenceHandle["save"]>()) {
  const persistence: GamePersistenceHandle = {
    restored: { schemaVersion: DING_SAVE_SCHEMA_VERSION, data: root },
    save,
    clear: vi.fn(),
  };
  const view = render(
    <SoundProvider>
      <DingDingGame onExit={vi.fn()} persistence={persistence} />
    </SoundProvider>,
  );
  return { ...view, save };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("DingDingGame active skill flow", () => {
  it("offers 青囊 during the human play phase and opens its decision frame", () => {
    renderWithState(skillTable(false));

    const skillButton = screen.getByRole("button", { name: "青囊" });
    expect((skillButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(skillButton);

    expect(screen.getByText("武将主动技")).toBeTruthy();
    expect(screen.getByText("选择一张手牌作为消耗，并选择一名受伤角色回复 1 点体力。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "选择「刺击」作为技能消耗" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "选择你作为技能目标" })).toBeTruthy();
    expect(screen.getByLabelText("结算栈，共 1 层").textContent).toContain("主动技");
  });

  it("shows a post-match review and filters key moments from the full log", () => {
    renderWithState(finishedReviewState());

    expect(screen.getByText("对局复盘")).toBeTruthy();
    expect(screen.getByText("一名角色退场，身份揭示。")).toBeTruthy();
    expect(screen.queryByText("普通行动。")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "完整记录" }));
    expect(screen.getByText("普通行动。")).toBeTruthy();
  });

  it("lets the human loyalist choose a card for the protect decision", () => {
    const { save } = renderWithState(protectTable());

    expect(screen.getByText("辅臣护主")).toBeTruthy();
    expect(screen.getByText("主君受到刺击")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "选择「聚势」护主" }));
    fireEvent.click(screen.getByRole("button", { name: "弃置护主" }));

    expect(screen.queryByText("辅臣护主")).toBeNull();
    expect(save).toHaveBeenCalled();
  });

  it("shows the hero draft and starts the match after choosing a hero", () => {
    const root = startDingMatchWithHeroDraft(createDefaultDingRootState(), "standard", () => 0.37);
    const { save } = renderWithRoot(root);

    expect(screen.getByText("三选一 · 选择武将")).toBeTruthy();
    const heroButtons = screen.getAllByRole("button", { name: /^选择武将/ });
    expect(heroButtons).toHaveLength(3);
    fireEvent.click(heroButtons[1]);

    expect(screen.queryByText("三选一 · 选择武将")).toBeNull();
    expect(save).toHaveBeenCalled();
  });

  it("lets the human guess an identity for 刺探", () => {
    const { save } = renderWithState(probeTable());

    expect(screen.getByText("刺探身份")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "叛锋" }));
    fireEvent.click(screen.getByRole("button", { name: "确认猜测" }));

    expect(screen.queryByText("刺探身份")).toBeNull();
    expect(save).toHaveBeenCalled();
  });

  it("resolves a restored 青囊 decision by choosing a cost card and target", () => {
    const { save } = renderWithState(skillTable(true));

    fireEvent.click(screen.getByRole("button", { name: "选择「刺击」作为技能消耗" }));
    fireEvent.click(screen.getByRole("button", { name: "选择你作为技能目标" }));
    fireEvent.click(screen.getByRole("button", { name: "确认发动" }));

    expect(screen.queryByRole("button", { name: "确认发动" })).toBeNull();
    expect((screen.getByRole("button", { name: "武将技能" }) as HTMLButtonElement).disabled).toBe(true);
    expect(save).toHaveBeenCalled();
  });
});
