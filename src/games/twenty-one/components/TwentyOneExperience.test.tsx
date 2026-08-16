/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GamePersistenceHandle } from "../../../core/games/types";
import { SoundProvider } from "../../../shared/audio/SoundProvider";
import {
  SINGLE_DECK_RULES,
  STANDARD_SIX_RULES,
  createDefaultRootState,
  rememberBet,
  startClassicSession,
  updatePreferences,
  type TwentyOneRootState,
} from "../domain/session";
import { TWENTY_ONE_SAVE_SCHEMA_VERSION } from "../domain/persistence";
import type { PlayerHandState, PlayingCard, TwentyOneState } from "../domain/types";
import { PlayerHands } from "./PlayerHands";
import { SetupLedger, TableLedger } from "./TablePanels";
import { TwentyOneExperience } from "./TwentyOneExperience";

function card(rank: PlayingCard["rank"], id: string, suit: PlayingCard["suit"] = "spades"): PlayingCard {
  return { id: `test-${id}`, name: `测试牌 ${rank} ${id}`, rank, suit };
}

function hand(
  id: string,
  cards: readonly PlayingCard[],
  status: PlayerHandState["status"] = "playing",
): PlayerHandState {
  return {
    id,
    cards,
    wager: 25,
    status,
    fromSplit: id !== "hand-1",
    splitAces: false,
    doubled: false,
  };
}

function activeTable(overrides: Partial<TwentyOneState> = {}): TwentyOneState {
  return {
    revision: 4,
    phase: "player-turn",
    rules: STANDARD_SIX_RULES,
    deck: [card("2", "deck-2", "clubs"), card("3", "deck-3", "diamonds")],
    dealerHand: [card("10", "dealer-up"), card("6", "dealer-hole", "hearts")],
    dealerRevealed: false,
    hands: [hand("hand-1", [card("10", "player-10"), card("6", "player-6", "hearts")])],
    activeHandIndex: 0,
    baseBet: 25,
    insurance: { status: "not-offered", wager: 0 },
    chips: 475,
    handNumber: 1,
    log: [{ id: 4, actor: "player", type: "bet", text: "你压下 25 枚筹码。" }],
    lastEvent: { id: 4, actor: "player", type: "bet", text: "你压下 25 枚筹码。" },
    ...overrides,
  };
}

function bettingTable(overrides: Partial<TwentyOneState> = {}): TwentyOneState {
  return activeTable({
    revision: 0,
    phase: "betting",
    deck: [card("2", "bet-deck-2"), card("3", "bet-deck-3")],
    dealerHand: [],
    dealerRevealed: false,
    hands: [],
    activeHandIndex: null,
    baseBet: 0,
    insurance: { status: "not-offered", wager: 0 },
    chips: 500,
    log: [],
    lastEvent: undefined,
    ...overrides,
  });
}

function classicRoot(table: TwentyOneState, assistEnabled = false): TwentyOneRootState {
  const configured = updatePreferences(createDefaultRootState(), {
    rules: table.rules,
    assistEnabled,
  });
  return startClassicSession(configured, table);
}

function ledger(root: TwentyOneRootState, onFinishClassic = vi.fn()) {
  return (
    <TableLedger
      root={root}
      tab="house"
      onTabChange={vi.fn()}
      onClose={vi.fn()}
      onAssistChange={vi.fn()}
      onFinishClassic={onFinishClassic}
      onAbandonChallenge={vi.fn()}
    />
  );
}

function renderExperience(root: TwentyOneRootState) {
  const save = vi.fn<GamePersistenceHandle["save"]>();
  const persistence: GamePersistenceHandle = {
    restored: { schemaVersion: 2, data: root },
    save,
    clear: vi.fn(),
  };
  const result = render(
    <SoundProvider>
      <TwentyOneExperience onExit={vi.fn()} persistence={persistence} />
    </SoundProvider>,
  );
  return { ...result, save };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("Twenty One setup and table controls", () => {
  it("lets the initial setup choose both a challenge and a classic table", () => {
    const onStartClassic = vi.fn();
    const onStartChallenge = vi.fn();
    render(
      <SetupLedger
        root={createDefaultRootState()}
        onExit={vi.fn()}
        soundEnabled={false}
        onToggleSound={vi.fn()}
        onStartClassic={onStartClassic}
        onStartChallenge={onStartChallenge}
        onResetArchive={vi.fn()}
      />,
    );

    const classic = screen.getByRole("radio", { name: /经典牌桌/ });
    const warmup = screen.getByRole("radio", { name: /热身十手/ });
    expect(classic.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(warmup);
    expect(warmup.getAttribute("aria-checked")).toBe("true");
    expect(classic.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /开始「热身十手」/ }));
    expect(onStartChallenge).toHaveBeenCalledWith("warmup", false);

    fireEvent.click(classic);
    fireEvent.click(screen.getByText("调整房规"));
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: /入座经典牌桌/ }));
    expect(onStartClassic).toHaveBeenCalledWith(STANDARD_SIX_RULES, false);
  });

  it("moves focus to the table tools after leaving setup", () => {
    render(
      <SoundProvider>
        <TwentyOneExperience onExit={vi.fn()} />
      </SoundProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "入座经典牌桌" }));

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "更多牌桌选项" }));
  });

  it("blocks writes and offers an explicit reset for an unreadable restored save", async () => {
    const save = vi.fn<GamePersistenceHandle["save"]>();
    const clear = vi.fn();
    const persistence: GamePersistenceHandle = {
      restored: { schemaVersion: 99, data: { future: true } },
      save,
      clear,
    };
    render(
      <SoundProvider>
        <TwentyOneExperience onExit={vi.fn()} persistence={persistence} />
      </SoundProvider>,
    );

    const warning = screen.getByRole("alert");
    expect(warning.textContent).toContain("现有存档无法安全读取，本次不会覆盖它");
    expect(save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "重置旧存档并启用保存" }));
    expect(clear).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        TWENTY_ONE_SAVE_SCHEMA_VERSION,
        0,
        expect.objectContaining({ revision: 0 }),
      );
    });
  });

  it("shows an active session's locked rules as read-only values", () => {
    const root = classicRoot(activeTable({ rules: SINGLE_DECK_RULES }));
    render(ledger(root));

    expect(screen.getByText(/本次会话房规已经锁定/)).toBeTruthy();
    expect(screen.getByText("1 副")).toBeTruthy();
    expect(screen.getByText("要牌")).toBeTruthy();
    expect(screen.getByText("3 手")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "房规预设" })).toBeNull();
  });

  it("disables leave-summary generation mid-hand and enables it while betting", () => {
    const onFinishClassic = vi.fn();
    const { rerender } = render(ledger(classicRoot(activeTable()), onFinishClassic));

    const midHandButton = screen.getByRole("button", { name: "生成离桌总结" });
    expect((midHandButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/完成当前手牌后/)).toBeTruthy();

    rerender(ledger(classicRoot(bettingTable()), onFinishClassic));
    const betweenHandsButton = screen.getByRole("button", { name: "生成离桌总结" });
    expect((betweenHandsButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(betweenHandsButton);
    expect(onFinishClassic).toHaveBeenCalledTimes(1);
  });

  it("renders the hand history tab in reverse order", () => {
    const root = classicRoot(activeTable({
      log: [
        { id: 1, actor: "table", type: "deal", text: "牌靴已洗好。" },
        { id: 2, actor: "player", type: "bet", text: "你压下 25 枚筹码。" },
      ],
    }));
    render(
      <TableLedger
        root={root}
        tab="history"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        onAssistChange={vi.fn()}
        onFinishClassic={vi.fn()}
        onAbandonChallenge={vi.fn()}
      />,
    );

    const panel = screen.getByRole("tabpanel");
    const entries = within(panel).getAllByRole("listitem");
    expect(entries[0].textContent).toContain("你压下 25 枚筹码。");
    expect(entries[1].textContent).toContain("牌靴已洗好。");
  });
});

describe("Twenty One player presentation and assistance", () => {
  it("renders a progress rail and the full desktop multi-hand container", () => {
    const hands = [
      hand("hand-1", [card("8", "multi-1a"), card("3", "multi-1b")]),
      hand("hand-2", [card("8", "multi-2a"), card("2", "multi-2b")]),
      hand("hand-3", [card("10", "multi-3a"), card("K", "multi-3b"), card("2", "multi-3c")], "busted"),
    ];
    const { container, rerender } = render(<PlayerHands hands={hands} activeHandIndex={0} />);

    const rail = screen.getByRole("list", { name: "玩家手牌进度" });
    expect(within(rail).getAllByRole("listitem")).toHaveLength(3);
    expect(container.querySelector(".player-hands-grid--3")).not.toBeNull();
    expect(screen.getByLabelText(/手牌 1，11 点，行动中/).classList.contains("is-active")).toBe(true);
    expect(screen.getByLabelText(/手牌 2，10 点，等待行动/)).toBeTruthy();
    expect(screen.getByLabelText(/手牌 3，22 点，爆牌/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /查看第 2 手牌，10 点，等待行动/ }));
    expect(screen.getByLabelText(/手牌 2，10 点，等待行动/).classList.contains("is-current")).toBe(true);

    const updatedHands = [
      { ...hands[0], cards: [...hands[0].cards, card("2", "multi-1-hit")] },
      hands[1],
      hands[2],
    ];
    rerender(<PlayerHands hands={updatedHands} activeHandIndex={0} latestCardId="test-multi-1-hit" />);

    expect(screen.getByLabelText(/手牌 1，13 点，行动中/).classList.contains("is-current")).toBe(true);
    expect(screen.getByRole("button", { name: /查看第 1 手牌，13 点，行动中/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /查看第 2 手牌，10 点，等待行动/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps assistance absent when disabled, then only highlights a move when requested", async () => {
    const disabledRoot = classicRoot(activeTable(), false);
    const disabledView = renderExperience(disabledRoot);
    expect(screen.queryByRole("button", { name: "提示" })).toBeNull();
    disabledView.unmount();

    const table = activeTable();
    const { save } = renderExperience(classicRoot(table, true));
    const surrender = screen.getByRole("button", { name: "投降" });
    const playerHand = screen.getByLabelText(/手牌 1，16 点，行动中/);
    expect(surrender.classList.contains("is-recommended")).toBe(false);
    expect(within(playerHand).getAllByRole("img")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "提示" }));

    expect(surrender.classList.contains("is-recommended")).toBe(true);
    expect(document.querySelector(".table-status")?.textContent).toContain("投降");
    expect(screen.getByLabelText(/手牌 1，16 点，行动中/)).toBeTruthy();
    expect(within(screen.getByLabelText(/手牌 1，16 点，行动中/)).getAllByRole("img")).toHaveLength(2);
    await waitFor(() => expect(save.mock.calls.at(-1)?.[2]).toBeDefined());
    const persisted = save.mock.calls.at(-1)?.[2] as TwentyOneRootState;
    expect(persisted.activeSession?.table.revision).toBe(table.revision);
    expect(persisted.activeSession?.table.chips).toBe(table.chips);
    expect(persisted.activeSession?.assisted).toBe(true);
  });

  it("only offers a non-duplicated repeat-bet shortcut after a bet has been remembered", async () => {
    const deck = Array.from({ length: 320 }, (_, index) => card("2", `repeat-deck-${index}`, "clubs"));
    const defaultView = renderExperience(classicRoot(bettingTable({ deck })));
    expect(screen.queryByRole("button", { name: /重复上一注/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /压 \d+ 枚筹码/ })).toHaveLength(4);
    defaultView.unmount();

    const { save } = renderExperience(rememberBet(classicRoot(bettingTable({ deck })), 50));
    expect(screen.queryByRole("button", { name: "压 50 枚筹码" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重复上一注 50" }));

    await waitFor(() => {
      const persisted = save.mock.calls.at(-1)?.[2] as TwentyOneRootState;
      expect(persisted.preferences.lastBet).toBe(50);
      expect(persisted.activeSession?.table.phase).toBe("player-turn");
    });
  });

  it("keeps the settled cards visible briefly before presenting the result", async () => {
    renderExperience(classicRoot(activeTable()));

    fireEvent.click(screen.getByRole("button", { name: "投降" }));

    expect(screen.queryByRole("dialog", { name: "庄家守住牌桌" })).toBeNull();
    expect(screen.getByRole("region", { name: "二十一刻牌桌" }).textContent).toContain("庄家");
    const result = await screen.findByRole("dialog", { name: "庄家守住牌桌" }, { timeout: 1_500 });
    fireEvent.click(within(result).getByRole("button", { name: /下一手/ }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "更多牌桌选项" }));
  });

  it("restarts the full settlement delay after an information overlay closes", () => {
    vi.useFakeTimers();
    renderExperience(classicRoot(activeTable()));

    fireEvent.click(screen.getByRole("button", { name: "投降" }));
    fireEvent.click(screen.getByRole("button", { name: "更多牌桌选项" }));
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByRole("dialog", { name: "庄家守住牌桌" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "关闭更多选项" }));
    act(() => vi.advanceTimersByTime(719));
    expect(screen.queryByRole("dialog", { name: "庄家守住牌桌" })).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("dialog", { name: "庄家守住牌桌" })).toBeTruthy();
  });

  it("uses one mobile-friendly tools entry and makes the table inert behind overlays", () => {
    renderExperience(classicRoot(activeTable()));

    fireEvent.click(screen.getByRole("button", { name: "更多牌桌选项" }));
    const tools = screen.getByRole("dialog", { name: "牌桌选项" });
    expect(within(tools).getByRole("button", { name: /牌局速度/ })).toBeTruthy();
    expect(within(tools).getByRole("button", { name: /关闭声音|开启声音/ })).toBeTruthy();
    expect(document.querySelector(".cf-game-shell__surface")?.hasAttribute("inert")).toBe(true);

    const more = screen.getByRole("button", { name: "更多牌桌选项" });
    fireEvent.click(within(tools).getByRole("button", { name: /牌桌册/ }));
    const ledgerDialog = screen.getByRole("dialog", { name: "牌桌册" });
    expect(ledgerDialog).toBeTruthy();
    expect(document.querySelector(".cf-game-shell__surface")?.hasAttribute("inert")).toBe(true);

    fireEvent.click(within(ledgerDialog).getByRole("button", { name: "关闭牌桌册" }));
    expect(document.activeElement).toBe(more);
  });
});
