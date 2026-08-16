import { expect, test, type Locator, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "compact portrait", width: 320, height: 568 },
  { name: "mobile portrait", width: 390, height: 844 },
  { name: "mobile landscape", width: 844, height: 390 },
  { name: "laptop", width: 1366, height: 768 },
] as const;

const SHORT_VIEWPORTS = VIEWPORTS.filter(({ height }) => height <= 568);

async function installUnreadableGuandanSave(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem("cardforge.save.guandan", JSON.stringify({
      schemaVersion: 1,
      savedAt: Date.now(),
      snapshot: {
        gameId: "guandan",
        revision: 1,
        data: { future: true },
      },
    }));
  });
}

async function box(locator: Locator, label: string) {
  await expect(locator, label).toBeVisible();
  const measured = await locator.boundingBox();
  expect(measured, `${label}应有可测量边界`).not.toBeNull();
  return measured!;
}

async function expectInsideViewport(page: Page, locator: Locator, label: string) {
  const measured = await box(locator, label);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(measured.x, `${label}左侧不应越界`).toBeGreaterThanOrEqual(-1);
  expect(measured.y, `${label}顶部不应越界`).toBeGreaterThanOrEqual(-1);
  expect(measured.x + measured.width, `${label}右侧不应越界`).toBeLessThanOrEqual(viewport!.width + 1);
  expect(measured.y + measured.height, `${label}底部不应越界`).toBeLessThanOrEqual(viewport!.height + 1);
}

async function expectNoOverlap(first: Locator, second: Locator, label: string) {
  const [firstBox, secondBox] = await Promise.all([box(first, label), box(second, label)]);
  const horizontal = Math.max(
    0,
    Math.min(firstBox.x + firstBox.width, secondBox.x + secondBox.width) - Math.max(firstBox.x, secondBox.x),
  );
  const vertical = Math.max(
    0,
    Math.min(firstBox.y + firstBox.height, secondBox.y + secondBox.height) - Math.max(firstBox.y, secondBox.y),
  );
  expect(Math.min(horizontal, vertical), label).toBeLessThanOrEqual(1);
}

async function expectInsideContainer(element: Locator, container: Locator, label: string) {
  const [elementBox, containerBox] = await Promise.all([box(element, label), box(container, `${label}容器`)]);
  expect(elementBox.x, `${label}左侧不应裁切`).toBeGreaterThanOrEqual(containerBox.x - 1);
  expect(elementBox.y, `${label}顶部不应裁切`).toBeGreaterThanOrEqual(containerBox.y - 1);
  expect(elementBox.x + elementBox.width, `${label}右侧不应裁切`).toBeLessThanOrEqual(
    containerBox.x + containerBox.width + 1,
  );
  expect(elementBox.y + elementBox.height, `${label}底部不应裁切`).toBeLessThanOrEqual(
    containerBox.y + containerBox.height + 1,
  );
}

async function expectHitArea(locator: Locator, label: string) {
  const measured = await box(locator, label);
  expect(measured.width, `${label}宽度至少 44px`).toBeGreaterThanOrEqual(43.5);
  expect(measured.height, `${label}高度至少 44px`).toBeGreaterThanOrEqual(43.5);
}

test("掼蛋关键视口无覆盖且手牌保持完整命中区 @guandan-layout", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "多视口矩阵只需在一个浏览器项目执行");

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await page.evaluate(() => window.localStorage.removeItem("cardforge.save.guandan"));
    await page.goto("/?game=guandan");
    await page.getByRole("button", { name: /入席开牌/ }).click();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });

    const shell = page.locator(".guandan-screen");
    const topbar = page.locator(".guandan-topbar");
    const status = page.locator(".cf-game-shell__status");
    const level = page.locator(".gd-level-rail");
    const arena = page.getByRole("region", { name: "四人掼蛋牌桌" });
    const trick = page.getByRole("group", { name: "当前牌墩" });
    const hand = page.getByRole("region", { name: "你的手牌" });
    const handRows = hand.locator(".gd-hand-rows");
    const actions = hand.locator(".gd-actions");

    for (const [locator, label] of [
      [shell, `${viewport.name} 游戏壳`],
      [topbar, `${viewport.name} 顶栏`],
      [status, `${viewport.name} 状态栏`],
      [level, `${viewport.name} 级别栏`],
      [arena, `${viewport.name} 牌桌`],
      [trick, `${viewport.name} 牌墩`],
      [hand, `${viewport.name} 手牌操作区`],
      [actions, `${viewport.name} 操作按钮区`],
    ] as const) {
      await expectInsideViewport(page, locator, label);
    }

    await expectNoOverlap(topbar, status, `${viewport.name} 顶栏与状态栏不重叠`);
    await expectNoOverlap(level, hand, `${viewport.name} 级别栏与手牌区不重叠`);
    await expectNoOverlap(handRows, actions, `${viewport.name} 手牌与操作按钮不重叠`);
    const seats = await page.locator(".gd-seat").all();
    for (const seat of seats) {
      await expectNoOverlap(seat, trick, `${viewport.name} 玩家席位与牌墩不重叠`);
    }
    for (let firstIndex = 0; firstIndex < seats.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < seats.length; secondIndex += 1) {
        await expectNoOverlap(seats[firstIndex], seats[secondIndex], `${viewport.name} 玩家席位互不覆盖`);
      }
    }
    await expectInsideContainer(trick.locator("header"), trick, `${viewport.name} 牌墩标题`);
    await expectInsideContainer(trick.locator(".gd-trick__cards"), trick, `${viewport.name} 牌墩牌面`);
    if (await trick.locator(":scope > p").isVisible()) {
      await expectInsideContainer(trick.locator(":scope > p"), trick, `${viewport.name} 牌墩行动说明`);
    }
    for (const action of await actions.getByRole("button").all()) {
      await expectInsideContainer(action, actions, `${viewport.name} 操作按钮`);
    }

    const cards = hand.locator("button.gd-card");
    const firstCard = cards.first();
    const secondCard = cards.nth(1);
    await firstCard.click();
    const [firstBox, secondBox, firstRowBox] = await Promise.all([
      box(firstCard, `${viewport.name} 第一张手牌`),
      box(secondCard, `${viewport.name} 第二张手牌`),
      box(hand.locator(".gd-hand-row").first(), `${viewport.name} 第一排手牌`),
    ]);
    expect(secondBox.x, `${viewport.name} 相邻手牌不应覆盖`).toBeGreaterThanOrEqual(firstBox.x + firstBox.width - 1);
    expect(firstBox.y, `${viewport.name} 选中牌顶部不应裁切`).toBeGreaterThanOrEqual(firstRowBox.y - 1);

    for (const [locator, label] of [
      [page.getByRole("button", { name: "返回游戏大厅" }), `${viewport.name} 返回按钮`],
      [page.getByRole("button", { name: "更多选项" }), `${viewport.name} 更多按钮`],
      [hand.getByRole("button", { name: "托管" }), `${viewport.name} 托管按钮`],
      [hand.getByRole("button", { name: "提示" }), `${viewport.name} 提示按钮`],
      [firstCard, `${viewport.name} 手牌`],
    ] as const) {
      await expectHitArea(locator, label);
    }

    const overflow = await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    expect(overflow.horizontal, `${viewport.name} 页面无横向溢出`).toBeLessThanOrEqual(1);
    expect(overflow.vertical, `${viewport.name} 页面无纵向溢出`).toBeLessThanOrEqual(1);
  }
});

test("掼蛋存档警告不会挤压短屏牌桌 @guandan-layout", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "短屏矩阵只需在一个浏览器项目执行");

  for (const viewport of SHORT_VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await installUnreadableGuandanSave(page);
    await page.goto("/?game=guandan");

    const rules = page.getByRole("dialog", { name: /掼蛋 · 升级赛/ });
    await expect(rules.getByRole("alert")).toContainText("现有存档无法安全读取");
    await rules.getByRole("button", { name: "入席开牌" }).click();

    await expect(page.getByRole("status")).toContainText("旧存档未读取");
    await expect(page.locator(".gd-table-content .gd-save-warning")).toHaveCount(0);

    const trick = page.getByRole("group", { name: "当前牌墩" });
    const turn = page.locator(".gd-turn-flag");
    for (const seat of await page.locator(".gd-seat").all()) {
      await expectNoOverlap(seat, trick, `${viewport.name} 存档警告下席位与牌墩不重叠`);
    }
    await expectNoOverlap(trick, turn, `${viewport.name} 存档警告下牌墩与回合标识不重叠`);
    await expectInsideViewport(page, page.getByRole("region", { name: "四人掼蛋牌桌" }), `${viewport.name} 存档警告下牌桌`);

    await page.getByRole("button", { name: "更多选项" }).click();
    const warning = page.getByRole("dialog", { name: "牌桌选项" }).getByRole("alert");
    await expect(warning).toContainText("现有存档无法安全读取");
    await warning.getByRole("button", { name: "重置旧存档并启用保存" }).click();
    await expect(warning).toHaveCount(0);
  }
});
