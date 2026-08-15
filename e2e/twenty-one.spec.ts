import { expect, test, type Page } from "@playwright/test";
import {
  TWENTY_ONE_SAVE_KEY,
  installChallengeBettingSave,
  installClassicBettingSave,
} from "./twentyOneFixtures";

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "二十一刻不应产生未处理异常").toEqual([]);
}

function desktopOnly(projectName: string) {
  test.skip(projectName !== "desktop", "确定性规则流程只需在一个桌面项目验证");
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return Math.max(root.scrollWidth, body.scrollWidth) - root.clientWidth;
  });
  expect(overflow, "二十一刻不应产生横向滚动").toBeLessThanOrEqual(1);
}

async function savedTableValue(page: Page, field: "handNumber" | "handCount") {
  return page.evaluate(({ key, requestedField }) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return -1;
    const save = JSON.parse(raw) as {
      snapshot?: { data?: { activeSession?: { table?: { handNumber?: number; hands?: unknown[] } } } };
    };
    const table = save.snapshot?.data?.activeSession?.table;
    return requestedField === "handNumber" ? (table?.handNumber ?? -1) : (table?.hands?.length ?? -1);
  }, { key: TWENTY_ONE_SAVE_KEY, requestedField: field });
}

async function savedLifetimeRounds(page: Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return -1;
    const save = JSON.parse(raw) as {
      snapshot?: { data?: { lifetimeStats?: { roundsPlayed?: number } } };
    };
    return save.snapshot?.data?.lifetimeStats?.roundsPlayed ?? -1;
  }, TWENTY_ONE_SAVE_KEY);
}

test("setup 可选择挑战与房规，开桌后房规只读", async ({ page }, testInfo) => {
  desktopOnly(testInfo.project.name);
  const assertNoPageErrors = collectPageErrors(page);
  await page.goto("/?game=twenty-one");

  const setup = page.getByRole("dialog", { name: /选择这一席/ });
  await expect(setup).toBeVisible();
  await expect(setup.getByRole("radio", { name: /经典牌桌/ })).toBeFocused();

  await setup.getByRole("radio", { name: /热身十手/ }).click();
  await expect(setup).toContainText("650");
  await expect(setup).toContainText("10 手上限");
  await expect(setup.getByRole("button", { name: /开始「热身十手」/ })).toBeVisible();

  await setup.getByRole("radio", { name: /经典牌桌/ }).click();
  await setup.getByRole("radio", { name: /单副牌/ }).click();
  await expect(setup.getByLabel("牌靴副数")).toHaveValue("1");
  await expect(setup.getByLabel("庄家软 17")).toHaveValue("hit");
  await expect(setup.getByLabel("允许迟投降")).not.toBeChecked();
  await setup.getByRole("button", { name: "入座经典牌桌" }).click();

  await page.getByRole("button", { name: "打开牌桌册" }).click();
  const ledger = page.getByRole("dialog", { name: "牌桌册" });
  await ledger.getByRole("tab", { name: "房规" }).click();
  const houseRules = ledger.getByRole("tabpanel");
  await expect(houseRules).toContainText("本次会话房规已经锁定");
  await expect(houseRules).toContainText("1 副");
  await expect(houseRules).toContainText("要牌");
  await expect(houseRules).toContainText("3 手");
  await expect(houseRules).toContainText("无投降");
  await expect(houseRules.getByRole("combobox")).toHaveCount(0);
  await expect(houseRules.getByRole("button", { name: "生成离桌总结" })).toBeEnabled();
  assertNoPageErrors();
});

test("完整结算会累计统计并进入保留筹码的下一手", async ({ page }, testInfo) => {
  desktopOnly(testInfo.project.name);
  const assertNoPageErrors = collectPageErrors(page);
  // 玩家 17；庄家 16 后补 5 到 21。
  await installClassicBettingSave(page, ["10", "9", "7", "7", "5"]);
  await page.goto("/?game=twenty-one");

  await page.getByRole("button", { name: "压 25 枚筹码" }).click();
  await page.getByRole("button", { name: /^停牌/ }).click();

  const result = page.getByRole("dialog", { name: "庄家守住牌桌" });
  await expect(result).toBeVisible();
  await expect(result.getByLabel("逐手结算")).toContainText("17 点");
  await expect(result).toContainText("-25");
  await result.getByRole("button", { name: /下一手/ }).click();

  await expect(page.locator(".twenty-one-title small")).toHaveText("CLASSIC · 第 2 手");
  await expect(page.locator(".chip-stack b")).toHaveText("475");
  await expect(page.getByLabel("尚未发牌")).toBeVisible();
  await expect.poll(() => savedLifetimeRounds(page)).toBe(1);
  await expect.poll(() => savedTableValue(page, "handNumber")).toBe(2);

  await page.reload();
  await expect(page.locator(".tw-restore-notice")).toHaveText("已恢复经典牌桌第 2 手");
  await page.getByRole("button", { name: "打开牌桌册" }).click();
  const ledger = page.getByRole("dialog", { name: "牌桌册" });
  await ledger.getByRole("tab", { name: "档案" }).click();
  const archive = ledger.getByRole("tabpanel");
  await expect(archive).toContainText("完成局数1");
  await expect(archive).toContainText("生涯净筹码-25");
  // 恢复已经消费的 settlement 不能把统计再累计一次。
  await expect.poll(() => savedLifetimeRounds(page)).toBe(1);
  assertNoPageErrors();
});

test("分牌创建两手并能从存档恢复当前行动", async ({ page }, testInfo) => {
  desktopOnly(testInfo.project.name);
  const assertNoPageErrors = collectPageErrors(page);
  // 玩家 8/8；分牌后依次补 3 与 2。
  await installClassicBettingSave(page, ["8", "6", "8", "10", "3", "2"]);
  await page.goto("/?game=twenty-one");

  await page.getByRole("button", { name: "压 25 枚筹码" }).click();
  const split = page.getByRole("button", { name: "分牌", exact: true });
  await expect(split).toBeEnabled();
  await split.click();

  await expect(page.locator(".hand-rail > li")).toHaveCount(2);
  await expect(page.getByRole("region", { name: /手牌 1，11 点，行动中/ })).toBeVisible();
  await expect(page.getByRole("region", { name: /手牌 2，10 点，行动中/ })).toBeVisible();
  await expect(page.locator(".chip-stack b")).toHaveText("450");
  await expect(page.locator(".chip-stack em")).toHaveText("押 50");
  await expect.poll(() => savedTableValue(page, "handCount")).toBe(2);

  await page.reload();
  await expect(page.locator(".tw-restore-notice")).toHaveText("已恢复经典牌桌第 1 手");
  await expect(page.locator(".hand-rail > li")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^停牌/ })).toBeEnabled();
  assertNoPageErrors();
});

test("保险按 2:1 赔付并进入长期统计", async ({ page }, testInfo) => {
  desktopOnly(testInfo.project.name);
  const assertNoPageErrors = collectPageErrors(page);
  // 庄家 A/K Blackjack；玩家主注落败，保险恰好抵消主注。
  await installClassicBettingSave(page, ["9", "A", "7", "K"]);
  await page.goto("/?game=twenty-one");

  await page.getByRole("button", { name: "压 25 枚筹码" }).click();
  await expect(page.locator(".table-status small")).toHaveText("INSURANCE OFFER");
  await page.getByRole("button", { name: /买保险 12.5/ }).click();

  const result = page.getByRole("dialog", { name: "本局和牌" });
  await expect(result).toContainText("保险赔付抵消了主注损失");
  await expect(result.getByLabel("逐手结算")).toContainText("保险+25");
  await expect(page.locator(".chip-stack b")).toHaveText("500");
  await result.getByRole("button", { name: /下一手/ }).click();

  await page.getByRole("button", { name: "打开牌桌册" }).click();
  const ledger = page.getByRole("dialog", { name: "牌桌册" });
  await ledger.getByRole("tab", { name: "档案" }).click();
  const archive = ledger.getByRole("tabpanel");
  await archive.getByText("保险与挑战记录").click();
  await expect(archive).toContainText("保险 1 次 · 净值 +25");
  assertNoPageErrors();
});

test("迟投降退回一半主注并立即结算", async ({ page }, testInfo) => {
  desktopOnly(testInfo.project.name);
  const assertNoPageErrors = collectPageErrors(page);
  await installClassicBettingSave(page, ["10", "6", "6", "10"]);
  await page.goto("/?game=twenty-one");

  await page.getByRole("button", { name: "压 25 枚筹码" }).click();
  const surrender = page.getByRole("button", { name: "投降", exact: true });
  await expect(surrender).toBeEnabled();
  await surrender.click();

  const result = page.getByRole("dialog", { name: "庄家守住牌桌" });
  await expect(result).toContainText("迟投降，退回一半主注");
  await expect(result.getByLabel("逐手结算")).toContainText("投降-12.5");
  await expect(page.locator(".chip-stack b")).toHaveText("487.5");
  assertNoPageErrors();
});

test("挑战达到目标后直接生成挑战总结", async ({ page }, testInfo) => {
  desktopOnly(testInfo.project.name);
  const assertNoPageErrors = collectPageErrors(page);
  // 625 起始余额下注 25；玩家 Blackjack 净赚 37.5，越过热身目标 650。
  await installChallengeBettingSave(page, ["A", "9", "K", "7"]);
  await page.goto("/?game=twenty-one");

  await page.getByRole("button", { name: "压 25 枚筹码" }).click();
  const summary = page.getByRole("dialog", { name: "挑战达成" });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("你完成了「热身十手」的目标");
  await expect(summary).toContainText("终局筹码662.5");
  await expect(summary).toContainText("完成局数1");
  await expect(summary).toContainText(/无辅助记录\s*最佳 662\.5/);
  await expect(summary.getByRole("button", { name: /再挑战一次/ })).toBeVisible();
  await expect(summary.getByRole("button", { name: "返回模式选择" })).toBeVisible();
  assertNoPageErrors();
});

test("多手牌桌在手机、笔记本与桌面均无横向溢出", async ({ page }) => {
  const assertNoPageErrors = collectPageErrors(page);
  await installClassicBettingSave(page, ["8", "6", "8", "10", "3", "2"]);
  await page.goto("/?game=twenty-one");
  await page.getByRole("button", { name: "压 25 枚筹码" }).click();
  await page.getByRole("button", { name: "分牌", exact: true }).click();

  await expect(page.getByRole("region", { name: "二十一刻牌桌" })).toBeVisible();
  await expect(page.locator(".hand-rail > li")).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
  assertNoPageErrors();
});
