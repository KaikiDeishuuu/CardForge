/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Dialog, GameShell, GameTopBar, ToolMenu, type GameToolAction } from "./GameShell";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ actions = [] }: { actions?: readonly GameToolAction[] }) {
  const [open, setOpen] = useState(false);
  return (
    <GameShell
      topBar={(
        <GameTopBar
          title="测试牌桌"
          subtitle="第 3 回合"
          onBack={vi.fn()}
          actions={actions}
          onMore={() => setOpen(true)}
          moreOpen={open}
        />
      )}
      status="轮到你行动"
      actionDock={<button type="button">确认行动</button>}
      overlayActive={open}
      overlay={(
        <ToolMenu
          open={open}
          title="牌桌工具"
          actions={actions}
          onClose={() => setOpen(false)}
        />
      )}
    >
      <button type="button">选择一张牌</button>
    </GameShell>
  );
}

function DialogHandoffHarness() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const actions: readonly GameToolAction[] = [{
    id: "rules",
    label: "查看规则",
    onSelect: () => setDialogOpen(true),
  }];
  return (
    <GameShell
      topBar={(
        <GameTopBar
          title="测试牌桌"
          onBack={vi.fn()}
          onMore={() => setMenuOpen(true)}
          moreOpen={menuOpen}
        />
      )}
      overlayActive={menuOpen || dialogOpen}
      overlay={(
        <>
          <ToolMenu open={menuOpen} actions={actions} onClose={() => setMenuOpen(false)} />
          <Dialog
            open={dialogOpen}
            title="规则"
            onClose={() => setDialogOpen(false)}
            restoreFocus=".cf-game-topbar__more"
          >
            <button type="button">规则内容</button>
          </Dialog>
        </>
      )}
    >
      牌桌
    </GameShell>
  );
}

describe("GameShell", () => {
  it("separates the viewport content, status, and action dock", () => {
    const { container } = render(<Harness />);

    expect(screen.getByRole("heading", { name: "测试牌桌" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("轮到你行动");
    expect(screen.getByRole("region", { name: "牌局操作" })).toBeTruthy();
    expect(container.querySelector(".cf-game-shell__surface")?.hasAttribute("inert")).toBe(false);
  });

  it("makes the game surface inert while the More dialog is open", () => {
    const { container } = render(<Harness />);
    const trigger = screen.getByRole("button", { name: "更多选项" });

    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "牌桌工具" })).toBeTruthy();
    expect(container.querySelector(".cf-game-shell__surface")?.hasAttribute("inert")).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("ToolMenu", () => {
  it("traps focus, closes with Escape, and restores focus to the trigger", () => {
    render(<Harness actions={[{ id: "rules", label: "规则", onSelect: vi.fn() }]} />);
    const trigger = screen.getByRole("button", { name: "更多选项" });
    trigger.focus();
    fireEvent.click(trigger);

    const action = screen.getAllByRole("button", { name: "规则" }).at(-1)!;
    expect(document.activeElement).toBe(action);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("invokes an action and dismisses the menu", () => {
    const onSelect = vi.fn();
    render(<Harness actions={[{ id: "log", label: "对局记录", description: "查看最近行动", onSelect }]} />);
    fireEvent.click(screen.getByRole("button", { name: "更多选项" }));

    fireEvent.click(screen.getAllByRole("button", { name: /对局记录/ }).at(-1)!);

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Dialog", () => {
  it("restores the stable trigger after replacing a tool menu", () => {
    render(<DialogHandoffHarness />);
    const trigger = screen.getByRole("button", { name: "更多选项" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "查看规则" }));

    fireEvent.click(screen.getByRole("button", { name: "关闭对话框" }));

    expect(document.activeElement).toBe(trigger);
  });

  it("supports custom classes and does not dismiss a blocking dialog", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog
        open
        title="确认结束"
        className="table-result"
        backdropClassName="table-result-backdrop"
        onClose={onClose}
        dismissOnBackdrop={false}
      >
        <button type="button" data-cf-dialog-initial>继续</button>
      </Dialog>,
    );

    expect(screen.getByRole("dialog", { name: "确认结束" }).classList.contains("table-result")).toBe(true);
    fireEvent.mouseDown(container.querySelector(".table-result-backdrop")!);
    expect(onClose).not.toHaveBeenCalled();
  });
});
