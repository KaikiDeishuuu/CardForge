/* @vitest-environment jsdom */

import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GamePersistenceHandle } from "../../core/games/types";
import { SoundProvider } from "../../shared/audio/SoundProvider";
import { EmberPactGame } from "./EmberPactGame";
import { EndTurnConfirm, ResponsePanel } from "./components/BattlePanels";
import { TacticalBrief } from "./components/TacticalBrief";
import { createInitialState } from "./domain/engine";
import type { Difficulty } from "./domain/types";

const fixedRandom = () => 0.42;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("Ember Pact response accessibility", () => {
  it("focuses the first deflect once and announces the response without stealing focus on rerender", () => {
    const state = createInitialState(fixedRandom);
    const attacker = state.combatants[0];
    const responder = state.combatants[1];
    const cards = [{ uid: "test-deflect", definitionId: "deflect" }];
    const props = {
      attacker,
      responder,
      attackName: "锋击",
      incomingDamage: 2,
      cards,
      onRespond: vi.fn(),
      onDecline: vi.fn(),
    };
    const view = render(<ResponsePanel {...props} />);

    const deflect = screen.getByRole("button", { name: /卸力.*化解 4 点/ });
    const decline = screen.getByRole("button", { name: "保留手牌 · 承受攻击" });
    expect(document.activeElement).toBe(deflect);
    expect(screen.getByRole("status").textContent).toContain("需要响应：初焰的「锋击」正攻向弦月");
    expect(screen.getByText(/不响应预计损失 2 点生命/)).toBeTruthy();

    decline.focus();
    view.rerender(<ResponsePanel {...props} cards={[...cards]} />);
    expect(document.activeElement).toBe(decline);
  });

  it("warns when a response may be lethal", () => {
    const state = createInitialState(fixedRandom);
    const view = render(
      <ResponsePanel
        attacker={state.combatants[0]}
        responder={state.combatants[1]}
        attackName="锋击"
        incomingDamage={state.combatants[1].hp}
        cards={[{ uid: "test-deflect", definitionId: "deflect" }]}
        onRespond={vi.fn()}
        onDecline={vi.fn()}
      />,
    );

    expect(view.getByText(/不响应预计损失 \d+ 点生命，可能直接退场/)).toBeTruthy();
  });
});

describe("Ember Pact end turn confirmation", () => {
  it("asks before discarding remaining actions and confirms the intent", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<EndTurnConfirm actionsRemaining={2} playableCards={3} onConfirm={onConfirm} onCancel={onCancel} />);

    const dialog = screen.getByRole("alertdialog", { name: "行动力还没用完" });
    expect(dialog.textContent).toContain("还有 2 点行动力与 3 张可出的牌");
    const confirm = screen.getByRole("button", { name: "确认结束回合" });
    expect(document.activeElement).toBe(confirm);

    fireEvent.click(screen.getByRole("button", { name: "继续行动" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "确认结束回合" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("Ember Pact tactical brief keyboard controls", () => {
  it("keeps save recovery inside the modal and supports roving radio navigation", () => {
    const combatants = createInitialState(fixedRandom).combatants;
    const onResetSave = vi.fn();

    function InteractiveBrief() {
      const [selectedId, setSelectedId] = useState(combatants[0].id);
      const [difficulty, setDifficulty] = useState<Difficulty>("standard");
      return (
        <TacticalBrief
          combatants={combatants}
          selectedId={selectedId}
          selectionLocked={false}
          difficulty={difficulty}
          guideEnabled
          saveWarning="现有存档无法安全读取，本次不会覆盖它。"
          onResetSave={onResetSave}
          onSelect={setSelectedId}
          onDifficultyChange={setDifficulty}
          onGuideChange={vi.fn()}
          onCommit={vi.fn()}
          onClose={vi.fn()}
        />
      );
    }

    render(<InteractiveBrief />);
    const dialog = screen.getByRole("dialog", { name: "选择执火者与规则" });
    const alert = within(dialog).getByRole("alert");
    const reset = within(alert).getByRole("button", { name: "重置旧存档并启用保存" });
    expect(dialog.contains(reset)).toBe(true);
    fireEvent.click(reset);
    expect(onResetSave).toHaveBeenCalledTimes(1);

    const characterGroup = within(dialog).getByRole("radiogroup", { name: "选择出战角色" });
    const characterRadios = within(characterGroup).getAllByRole("radio");
    expect(characterRadios[0].tabIndex).toBe(0);
    expect(characterRadios[1].tabIndex).toBe(-1);
    characterRadios[0].focus();
    fireEvent.keyDown(characterRadios[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(characterRadios[1]);
    expect(characterRadios[0].tabIndex).toBe(-1);
    expect(characterRadios[1].tabIndex).toBe(0);
    expect(characterRadios[1].getAttribute("aria-checked")).toBe("true");

    const difficultyGroup = within(dialog).getByRole("radiogroup", { name: "对手难度" });
    const difficultyRadios = within(difficultyGroup).getAllByRole("radio");
    difficultyRadios[1].focus();
    fireEvent.keyDown(difficultyRadios[1], { key: "End" });
    expect(document.activeElement).toBe(difficultyRadios[2]);
    expect(difficultyRadios[2].tabIndex).toBe(0);
    expect(difficultyRadios[2].getAttribute("aria-checked")).toBe("true");

    expect(within(dialog).getByText(/首席以 4 张先行；此后每席行动开始抽 2 张/)).toBeTruthy();
  });
});

describe("Ember Pact save recovery placement", () => {
  it("renders an unreadable-save recovery action only inside the open setup modal", () => {
    const clear = vi.fn();
    const persistence: GamePersistenceHandle = {
      restored: { schemaVersion: 999, data: { future: true } },
      save: vi.fn(() => true),
      clear,
    };

    const { container } = render(
      <SoundProvider>
        <EmberPactGame onExit={vi.fn()} persistence={persistence} />
      </SoundProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "选择执火者与规则" });
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(dialog.contains(alerts[0])).toBe(true);
    expect(container.querySelector(".pact-save-warning:not(.pact-save-warning--inline)")).toBeNull();

    fireEvent.click(within(alerts[0]).getByRole("button", { name: "重置旧存档并启用保存" }));
    expect(clear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
