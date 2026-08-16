import { expect, test, type Locator, type Page } from "@playwright/test";
import { installTexasHoldemSave, TEXAS_HOLDEM_SAVE_KEY } from "./texasHoldemFixtures";

const VIEWPORTS = [
  { name: "compact portrait", width: 320, height: 568 },
  { name: "mobile portrait", width: 390, height: 844 },
  { name: "mobile landscape", width: 844, height: 390 },
  { name: "laptop", width: 1366, height: 768 },
] as const;

function desktopOnly(projectName: string) {
  test.skip(projectName !== "desktop", "确定性流程与多视口矩阵只在一个浏览器项目执行");
}

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "德州扑克不应产生未处理异常").toEqual([]);
}

async function measuredBox(locator: Locator, label: string) {
  await expect(locator, label).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label}应有可测量边界`).not.toBeNull();
  return box!;
}

async function expectInsideViewport(page: Page, locator: Locator, label: string) {
  const box = await measuredBox(locator, label);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box.x, `${label}左侧不应越界`).toBeGreaterThanOrEqual(-1);
  expect(box.y, `${label}顶部不应越界`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${label}右侧不应越界`).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box.y + box.height, `${label}底部不应越界`).toBeLessThanOrEqual(viewport!.height + 1);
}

async function expectNoOverlap(first: Locator, second: Locator, label: string) {
  const [a, b] = await Promise.all([measuredBox(first, label), measuredBox(second, label)]);
  const horizontal = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const vertical = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  expect(Math.min(horizontal, vertical), label).toBeLessThanOrEqual(1);
}

async function expectHitArea(locator: Locator, label: string) {
  const box = await measuredBox(locator, label);
  expect(box.width, `${label}宽度至少 44px`).toBeGreaterThanOrEqual(43.5);
  expect(box.height, `${label}高度至少 44px`).toBeGreaterThanOrEqual(43.5);
}

async function expectAccessibleSizing(page: Page, viewportName: string) {
  const visibleControls = page.locator(
    ".texas-holdem-screen button:visible, .texas-holdem-screen input[type='range']:visible",
  );
  for (let index = 0; index < await visibleControls.count(); index += 1) {
    await expectHitArea(visibleControls.nth(index), `${viewportName} 可见控件 ${index + 1}`);
  }

  const undersizedText = await page.locator(".texas-holdem-screen").evaluate((root) => (
    [...root.querySelectorAll<HTMLElement>("*")]
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const hasDirectText = [...element.childNodes].some((node) => (
          node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
        ));
        return hasDirectText
          && style.display !== "none"
          && style.visibility !== "hidden"
          && element.getClientRects().length > 0
          && Number.parseFloat(style.fontSize) < 11.9;
      })
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}:${getComputedStyle(element).fontSize}`)
  ));
  expect(undersizedText, `${viewportName} 可见文字不小于 12px`).toEqual([]);
}

async function settleLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

test("暗牌不泄漏且 AI 保留思考时间，工具面板会暂停计时", async ({ page }, testInfo) => {
  desktopOnly(testInfo.project.name);
  const assertNoPageErrors = collectPageErrors(page);
  await installTexasHoldemSave(page);
  await page.goto("/?game=texas-holdem");

  await expect(page.locator(".holdem-seat--human .poker-card--face")).toHaveCount(2);
  const concealed = page.locator(".holdem-seat--opponent .poker-card--back");
  await expect(concealed).toHaveCount(2);
  await expect(concealed.first()).not.toHaveAttribute("data-card-id");
  const leakedOpponentCards = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return ["missing deterministic save"];
    const record = JSON.parse(raw) as {
      snapshot: { data: { players: Array<{ id: string; hole: Array<{ id: string; name: string }> }> } };
    };
    const opponent = record.snapshot.data.players.find((player) => player.id === "east");
    const renderedMarkup = document.querySelector(".cf-game-shell")?.innerHTML ?? "";
    return opponent?.hole
      .flatMap((card) => [card.id, card.name])
      .filter((secret) => renderedMarkup.includes(secret)) ?? ["missing opponent"];
  }, TEXAS_HOLDEM_SAVE_KEY);
  expect(leakedOpponentCards, "对手底牌 ID 与名称都不应进入渲染 DOM").toEqual([]);
  await expect(page.locator(".holdem-pot strong")).toHaveText("15");

  await page.getByRole("button", { name: "跟注 · 5" }).click();
  const table = page.getByRole("region", { name: "双人德州扑克牌桌" });
  await expect(table).toHaveAttribute("aria-busy", "true");
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "更多牌桌选项" }).click();
  await expect(page.locator(".cf-game-shell__surface")).toHaveAttribute("inert", "");
  await page.waitForTimeout(1_550);
  await expect(page.locator(".holdem-board .poker-card--face")).toHaveCount(0);

  await page.getByRole("button", { name: "关闭更多选项" }).click();
  await page.waitForTimeout(700);
  await expect(page.locator(".holdem-board .poker-card--face")).toHaveCount(0);
  await expect(page.locator(".holdem-board .poker-card--face")).toHaveCount(3, { timeout: 1_500 });
  assertNoPageErrors();
});

test("结算状态会跨刷新恢复", async ({ page }, testInfo) => {
  desktopOnly(testInfo.project.name);
  const assertNoPageErrors = collectPageErrors(page);
  await installTexasHoldemSave(page);
  await page.goto("/?game=texas-holdem");
  await page.getByRole("button", { name: "弃牌", exact: true }).click();
  await expect(page.getByRole("button", { name: "下一手" })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw).snapshot.data.status : undefined;
  }, TEXAS_HOLDEM_SAVE_KEY)).toBe("settled");

  await page.reload();
  await expect(page.getByRole("button", { name: "下一手" })).toBeVisible();
  await expect(page.getByText("对手收下 15 筹码底池。", { exact: true }).first()).toBeVisible();
  assertNoPageErrors();
});

test("德州扑克四个关键视口无覆盖且加注操作完整 @holdem-layout", async ({ page }, testInfo) => {
  desktopOnly(testInfo.project.name);
  const assertNoPageErrors = collectPageErrors(page);
  await installTexasHoldemSave(page);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await page.evaluate((key) => window.localStorage.removeItem(key), TEXAS_HOLDEM_SAVE_KEY);
    await page.goto("/?game=texas-holdem");
    await settleLayout(page);

    const topbar = page.locator(".holdem-topbar");
    const status = page.locator(".cf-game-shell__status");
    const table = page.getByRole("region", { name: "双人德州扑克牌桌" });
    const opponent = page.locator(".holdem-seat--opponent");
    const board = page.locator(".holdem-board-zone");
    const human = page.locator(".holdem-seat--human");
    const dock = page.locator(".holdem-action-dock");

    for (const [locator, label] of [
      [topbar, `${viewport.name} 顶栏`],
      [status, `${viewport.name} 状态栏`],
      [table, `${viewport.name} 牌桌`],
      [opponent, `${viewport.name} 对手席`],
      [board, `${viewport.name} 公共牌区`],
      [human, `${viewport.name} 玩家席`],
      [dock, `${viewport.name} 操作坞`],
    ] as const) await expectInsideViewport(page, locator, label);

    await expectNoOverlap(topbar, status, `${viewport.name} 顶栏与状态栏不重叠`);
    await expectNoOverlap(status, table, `${viewport.name} 状态栏与牌桌不重叠`);
    await expectNoOverlap(table, dock, `${viewport.name} 牌桌与操作坞不重叠`);
    await expectNoOverlap(opponent, board, `${viewport.name} 对手席与公共牌区不重叠`);
    await expectNoOverlap(board, human, `${viewport.name} 公共牌区与玩家席不重叠`);

    for (const [locator, label] of [
      [page.getByRole("button", { name: "返回游戏大厅" }), `${viewport.name} 返回按钮`],
      [page.getByRole("button", { name: "更多牌桌选项" }), `${viewport.name} 更多按钮`],
      [page.getByRole("button", { name: "弃牌", exact: true }), `${viewport.name} 弃牌按钮`],
      [page.getByRole("button", { name: "跟注 · 5" }), `${viewport.name} 跟注按钮`],
      [page.getByRole("button", { name: "加注", exact: true }), `${viewport.name} 加注按钮`],
    ] as const) await expectHitArea(locator, label);
    await expectAccessibleSizing(page, viewport.name);

    await page.getByRole("button", { name: "加注", exact: true }).click();
    await settleLayout(page);
    await expectInsideViewport(page, dock, `${viewport.name} 展开后的加注操作坞`);
    await expectNoOverlap(table, dock, `${viewport.name} 展开加注后牌桌与操作坞不重叠`);
    for (const button of await page.locator(".holdem-raise-presets button:enabled").all()) {
      await expectHitArea(button, `${viewport.name} 快捷加注按钮`);
    }
    await expectAccessibleSizing(page, `${viewport.name} 展开加注`);

    const overflow = await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    expect(overflow.horizontal, `${viewport.name} 页面无横向溢出`).toBeLessThanOrEqual(1);
    expect(overflow.vertical, `${viewport.name} 页面无纵向溢出`).toBeLessThanOrEqual(1);
  }
  assertNoPageErrors();
});
