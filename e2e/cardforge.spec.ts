import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  EMBER_PACT_SAVE_KEY,
  FUTURE_EMBER_PACT_DATA,
  FUTURE_EMBER_PACT_SCHEMA_VERSION,
  createFinishedVictoryRoot,
  createHumanResponseRoot,
  createTwoActionRoot,
  installEmberPactSave,
  installFutureEmberPactSave,
} from "./emberPactFixtures";
import { installClassicBettingSave } from "./twentyOneFixtures";

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "页面不应产生未处理异常").toEqual([]);
}

async function expectNoDocumentOverflow(page: Page, checkVertical = false) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      horizontal: Math.max(root.scrollWidth, body.scrollWidth) - root.clientWidth,
      vertical: Math.max(root.scrollHeight, body.scrollHeight) - root.clientHeight,
    };
  });

  expect(overflow.horizontal, "页面不应产生横向滚动").toBeLessThanOrEqual(1);
  if (checkVertical) {
    expect(overflow.vertical, "牌桌应完整约束在当前视口中").toBeLessThanOrEqual(1);
  }
}

async function expectElementWithinViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, "元素应具有可测量边界").not.toBeNull();
  expect(viewport, "测试项目应提供固定视口").not.toBeNull();
  expect(box!.x, "元素左侧不应超出视口").toBeGreaterThanOrEqual(-1);
  expect(box!.y, "元素顶部不应超出视口").toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, "元素右侧不应超出视口").toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height, "元素底部不应超出视口").toBeLessThanOrEqual(viewport!.height + 1);
  const horizontalOverflow = await locator.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(horizontalOverflow, "面板内部不应产生横向滚动").toBeLessThanOrEqual(1);
}

async function enterGame(page: Page, id: "ember-pact" | "twenty-one" | "guandan" | "dingding") {
  await page.goto(`/?game=${id}`);
  const entryLabels = {
    "ember-pact": "开始争焰",
    "twenty-one": "入座经典牌桌",
    guandan: "入席开牌",
    dingding: "入席开局",
  } as const;
  await page.getByRole("button", { name: new RegExp(entryLabels[id]) }).click();
}

test("大厅展示四张独立牌桌且不会横向溢出", async ({ page }) => {
  const assertNoPageErrors = collectPageErrors(page);
  await page.goto("/");

  await expect(page.getByRole("button", { name: /争焰/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /二十一刻/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /掼蛋/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /定鼎/ })).toBeEnabled();
  await expect(page.locator(".featured-game, .planned-game.is-playable")).toHaveCount(4);
  await expectNoDocumentOverflow(page);
  assertNoPageErrors();
});

test("争焰规则弹层、选牌和目标选择可以完成", async ({ page }) => {
  const assertNoPageErrors = collectPageErrors(page);
  await page.goto("/?game=ember-pact");

  const dialog = page.getByRole("dialog", { name: /选择执火者与规则/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /开始争焰/ })).toBeVisible();
  await dialog.getByRole("button", { name: /开始争焰/ }).click();

  const hand = page.getByRole("list", { name: "你的手牌" });
  const chosenCard = hand.getByRole("button").first();
  await chosenCard.click();
  await expect(chosenCard).toHaveAttribute("aria-pressed", "true");

  const targets = page.getByRole("button", { name: /可选为目标/ });
  await expect(targets.first()).toBeVisible();
  await targets.first().click();
  await expect(page.getByText(/还有 1 点行动力|正在判断/).first()).toBeVisible();
  assertNoPageErrors();
});

test("争焰可以改选出战角色并翻转敌我两行", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "选将与视口无关，只在一个桌面项目验证");
  const assertNoPageErrors = collectPageErrors(page);
  await page.goto("/?game=ember-pact");

  const dialog = page.getByRole("dialog", { name: /选择执火者与规则/ });
  await expect(page.locator(".team-label--ally span")).toHaveCount(0);

  const scar = dialog.getByRole("radio", { name: /铸痕/ });
  await scar.click();
  await expect(scar).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: /开始争焰/ }).click();

  // 铸痕属逐光团，所以己方与敌方两行应随玩家阵营翻转。
  await expect(page.locator(".team-label--ally span")).toHaveText("逐光团");
  await expect(page.locator(".team-label--enemy span")).toHaveText("守炉庭");
  assertNoPageErrors();
});

test("争焰开局后角色与规则不会重置对局", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "对局锁定与视口无关，只在一个桌面项目验证");
  const assertNoPageErrors = collectPageErrors(page);
  await page.goto("/?game=ember-pact");
  await page.getByRole("button", { name: /开始争焰/ }).click();

  const hand = page.getByRole("list", { name: "你的手牌" });
  await hand.getByRole("button").first().click();
  await page.getByRole("button", { name: /可选为目标/ }).first().click();
  await expect(hand.getByRole("button")).toHaveCount(3);

  await page.getByRole("button", { name: "打开角色与规则" }).click();
  const dialog = page.getByRole("dialog", { name: /选择执火者与规则/ });
  await expect(dialog.getByRole("radio", { name: /铸痕/ })).toBeDisabled();
  await expect(dialog.getByRole("heading", { name: "选择执火者与规则" })).toBeFocused();
  await dialog.getByRole("button", { name: "返回争焰对局" }).click();

  await expect(hand.getByRole("button")).toHaveCount(3);
  assertNoPageErrors();
});

test("争焰连续行动会在刷新后原位续玩", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "断点续玩与视口无关，只在一个桌面项目验证");
  const assertNoPageErrors = collectPageErrors(page);
  await installEmberPactSave(page, createTwoActionRoot());
  await page.goto("/?game=ember-pact");

  const hand = page.getByRole("list", { name: "你的手牌" });
  await expect(hand.getByRole("button")).toHaveCount(2);
  await hand.getByRole("button", { name: /护阵/ }).click();
  await page.getByRole("button", { name: /初焰.*可选为目标/ }).click();
  await expect(page.locator(".turn-track__actions strong")).toContainText("1/2");
  await expect(hand.getByRole("button")).toHaveCount(1);

  await expect.poll(() => page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw).snapshot.data.activeMatch.state.actionsRemaining;
  }, EMBER_PACT_SAVE_KEY)).toBe(1);
  await page.reload();

  await expect(page.locator(".turn-track__actions strong")).toContainText("1/2");
  await expect(hand.getByRole("button")).toHaveCount(1);
  await hand.getByRole("button", { name: /协战/ }).click();
  await page.getByRole("button", { name: /弦月.*可选为目标/ }).click();
  await page.getByRole("button", { name: "查看战报" }).click();
  await expect(page.locator(".turn-track__order li.is-current")).toContainText("铸痕");
  assertNoPageErrors();
});

test("争焰允许玩家用卸力响应敌方攻击", async ({ page }) => {
  const assertNoPageErrors = collectPageErrors(page);
  await installEmberPactSave(page, createHumanResponseRoot());
  await page.goto("/?game=ember-pact");

  const response = page.locator(".response-panel");
  await expect(response).toContainText("敌方回合 · 你的响应");
  const deflect = response.getByRole("button", { name: /卸力.*化解 4 点/ }).first();
  await expect(deflect).toBeFocused();
  await deflect.click();
  await expect(response).toHaveCount(0);
  await expect(page.getByRole("button", { name: /铸痕.*生命 18\/19/ })).toBeVisible();
  assertNoPageErrors();
});

test("争焰结算与战绩会跨刷新保留并支持原阵容再战", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "结果幂等与视口无关，只在一个桌面项目验证");
  const assertNoPageErrors = collectPageErrors(page);
  await installEmberPactSave(page, createFinishedVictoryRoot());
  await page.goto("/?game=ember-pact");

  const result = page.getByRole("dialog", { name: "联手守住了这一焰" });
  await expect(result).toContainText("造成伤害19");
  await expect(result).toContainText("联携3");
  await page.reload();
  await expect(result).toBeVisible();
  await expect.poll(() => page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw).snapshot.data.lifetimeProfile.gamesPlayed : undefined;
  }, EMBER_PACT_SAVE_KEY)).toBe(1);

  await result.getByRole("button", { name: "原阵容再战" }).click();
  await expect(result).toHaveCount(0);
  await page.getByRole("button", { name: "查看争焰记录" }).click();
  const profile = page.getByRole("dialog", { name: "争焰记录" });
  await expect(profile).toContainText("完成对局1");
  await expect(profile).toContainText("初焰");
  await expect(profile).toContainText("1 胜 / 1 局");
  assertNoPageErrors();
});

test("争焰不会自动覆盖未知存档，明确重置后才写入 v2", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "存档版本行为与视口无关，只在一个桌面项目验证");
  const assertNoPageErrors = collectPageErrors(page);
  await installFutureEmberPactSave(page);
  await page.goto("/?game=ember-pact");

  const warning = page.getByRole("alert");
  await expect(warning).toContainText("现有存档无法安全读取，本次不会覆盖它");
  const setup = page.getByRole("dialog", { name: /选择执火者与规则/ });
  await expect(setup.getByRole("heading", { name: "选择执火者与规则" })).toBeFocused();

  // Force a root revision while saving is blocked. The future envelope must
  // remain byte-for-byte meaningful until the player explicitly resets it.
  await setup.getByRole("radio", { name: /战术/ }).click();
  const untouched = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return { schemaVersion: parsed.schemaVersion, data: parsed.snapshot.data };
  }, EMBER_PACT_SAVE_KEY);
  expect(untouched).toEqual({
    schemaVersion: FUTURE_EMBER_PACT_SCHEMA_VERSION,
    data: FUTURE_EMBER_PACT_DATA,
  });

  await warning.getByRole("button", { name: "重置旧存档并启用保存" }).click();
  await expect(warning).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return {
      schemaVersion: parsed.schemaVersion,
      revision: parsed.snapshot.revision,
      difficulty: parsed.snapshot.data.preferences.difficulty,
    };
  }, EMBER_PACT_SAVE_KEY)).toEqual({ schemaVersion: 2, revision: 1, difficulty: "tactician" });

  await page.reload();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /战术/ })).toHaveAttribute("aria-checked", "true");
  assertNoPageErrors();
});

test("争焰手机端结算与战绩面板保持在视口内并正确管理焦点", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "仅验证手机竖屏布局");
  const assertNoPageErrors = collectPageErrors(page);
  await installEmberPactSave(page, createFinishedVictoryRoot());
  await page.goto("/?game=ember-pact");

  const result = page.getByRole("dialog", { name: "联手守住了这一焰" });
  const replay = result.getByRole("button", { name: "原阵容再战" });
  await expect(replay).toBeFocused();
  await expectElementWithinViewport(page, result.locator(".result-card"));
  await expectNoDocumentOverflow(page);

  await replay.click();
  await page.getByRole("button", { name: "查看争焰记录" }).click();
  const profile = page.getByRole("dialog", { name: "争焰记录" });
  await expect(profile.getByRole("button", { name: "关闭争焰记录" })).toBeFocused();
  await expectElementWithinViewport(page, profile.locator(".profile-sheet"));
  await profile.locator(".profile-roster article").last().scrollIntoViewIfNeeded();
  await expect(profile.locator(".profile-roster article").last()).toBeVisible();
  await expectNoDocumentOverflow(page);
  assertNoPageErrors();
});

test("二十一刻可以下注并要牌", async ({ page }) => {
  const assertNoPageErrors = collectPageErrors(page);
  await installClassicBettingSave(page, ["10", "6", "6", "10", "2"]);
  await page.goto("/?game=twenty-one");

  const chips = page.locator(".chip-stack b");
  await expect(chips).toHaveText("500");

  const hit = page.getByRole("button", { name: /要牌/ });
  const cards = page.locator(".playing-hand--player .tw-card");

  await page.getByRole("button", { name: "压 25 枚筹码" }).click();
  await expect(cards).toHaveCount(2);
  await expect(page.locator(".chip-stack em")).toHaveText("押 25");
  await expect(hit).toBeEnabled();
  const initialCount = await cards.count();
  await hit.click();
  await expect(cards).toHaveCount(initialCount + 1);
  assertNoPageErrors();
});

test("二十一刻的对局会跨刷新续玩", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "断点续玩与视口无关，只在一个桌面项目验证");
  const assertNoPageErrors = collectPageErrors(page);
  await installClassicBettingSave(page, ["8", "6", "8", "10", "3", "2"]);
  await page.goto("/?game=twenty-one");

  await expect(page.locator(".chip-stack b")).toHaveText("500");
  await page.getByRole("button", { name: "压 25 枚筹码" }).click();
  await expect(page.locator(".playing-hand--player .tw-card")).toHaveCount(2);
  await page.getByRole("button", { name: "分牌", exact: true }).click();
  await expect(page.locator(".hand-rail > li")).toHaveCount(2);
  // 等存档真正落盘再刷新，避免在 effect 写入前就重载。
  await expect.poll(() =>
    page.evaluate(() => window.localStorage.getItem("cardforge.save.twenty-one") !== null),
  ).toBe(true);

  const phaseBefore = await page.locator(".table-status small").textContent();
  await page.reload();

  await expect(page.locator(".playing-hand--player .tw-card")).toHaveCount(4);
  await expect(page.locator(".hand-rail > li")).toHaveCount(2);
  await expect(page.locator(".table-status small")).toHaveText(phaseBefore ?? "");
  await expect(page.locator(".chip-stack em")).toHaveText("押 50");
  assertNoPageErrors();
});

test("掼蛋支持键盘浏览、提示与出牌", async ({ page }) => {
  const assertNoPageErrors = collectPageErrors(page);
  await page.goto("/?game=guandan");

  const entry = page.getByRole("button", { name: /入席开牌/ });
  await expect(entry).toBeFocused();
  await entry.click();

  await expect(page.locator(".gd-level-rail > span")).toContainText("第 1 局");
  await expect(page.locator(".gd-match-score__team--vermillion")).toContainText("2");
  await expect(page.locator(".gd-match-score__team--indigo")).toContainText("2");

  const hand = page.getByRole("region", { name: "你的手牌" });
  const cards = hand.locator("button.gd-card");
  await cards.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(cards.nth(1)).toBeFocused();

  await page.getByRole("button", { name: "提示" }).click();
  await expect(hand.locator('button.gd-card[aria-pressed="true"]').first()).toBeVisible();
  const play = page.getByRole("button", { name: /出牌/ });
  await expect(play).toBeEnabled();
  const initialCount = await cards.count();
  await play.click();
  await expect.poll(() => cards.count()).toBeLessThan(initialCount);
  assertNoPageErrors();
});

test("定鼎身份局可以入席并展示四席暗局", async ({ page }) => {
  const assertNoPageErrors = collectPageErrors(page);
  await page.goto("/?game=dingding");

  const entry = page.getByRole("button", { name: /入席开局/ });
  await expect(entry).toBeVisible();
  await entry.click();

  await expect(page.getByRole("region", { name: "四席定鼎牌桌" })).toBeVisible();
  await expect(page.locator(".ding-seat")).toHaveCount(4);
  await expect(page.getByRole("region", { name: "你的手牌" })).toBeVisible();

  await page.getByRole("button", { name: "查看规则" }).click();
  const rules = page.getByRole("dialog", { name: /四席暗局/ });
  await expect(rules).toBeVisible();
  await expect(rules.getByText("无懈", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭规则" }).click();
  assertNoPageErrors();
});

test("声音偏好会跨牌桌和刷新保持", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "持久化与视口无关，只在一个桌面项目验证");
  const assertNoPageErrors = collectPageErrors(page);
  await page.goto("/");

  await page.getByRole("button", { name: "声音开" }).click();
  await expect(page.getByRole("button", { name: "声音关" })).toBeVisible();
  await page.getByRole("button", { name: /二十一刻/ }).click();
  await expect(page.getByRole("button", { name: "开启声音" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "开启声音" })).toBeVisible();
  await page.getByRole("button", { name: /入座经典牌桌/ }).click();
  await page.getByRole("button", { name: "返回游戏大厅" }).click();
  await expect(page.getByRole("button", { name: "声音关" })).toBeVisible();
  assertNoPageErrors();
});

test("游戏模块加载期间显示带忙碌状态的宿主页", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "宿主生命周期与视口无关，只在一个桌面项目验证");
  const assertNoPageErrors = collectPageErrors(page);
  await page.route("**/src/games/ember-pact/index.ts", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });

  const navigation = page.goto("/?game=ember-pact");
  const loading = page.locator('.game-loading[role="status"][aria-busy="true"]');
  await expect(loading).toContainText("正在展开牌桌");
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await navigation;
  await expect(page.getByRole("dialog", { name: /选择执火者与规则/ })).toBeVisible();
  assertNoPageErrors();
});

test("游戏模块加载失败后可以重试恢复", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "宿主生命周期与视口无关，只在一个桌面项目验证");
  let shouldFail = true;
  await page.route(/\/src\/games\/twenty-one\/.*\.(?:ts|tsx)(?:\?.*)?$/, async (route) => {
    if (shouldFail) await route.abort("failed");
    else await route.continue();
  });

  await page.goto("/?game=twenty-one");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("暂时无法打开");
  const retry = page.getByRole("button", { name: "重试牌桌" });
  await expect(retry).toBeFocused();

  shouldFail = false;
  await retry.click();
  await expect(page.getByRole("dialog", { name: /选择这一席/ })).toBeVisible();
});

for (const game of [
  { id: "ember-pact", landmark: "争焰战场" },
  { id: "twenty-one", landmark: "二十一刻牌桌" },
  { id: "guandan", landmark: "四人掼蛋牌桌" },
  { id: "dingding", landmark: "四席定鼎牌桌" },
] as const) {
  test(`${game.id} 牌桌适配当前视口`, async ({ page }) => {
    const assertNoPageErrors = collectPageErrors(page);
    await enterGame(page, game.id);
    await expect(page.getByRole("region", { name: game.landmark })).toBeVisible();
    await expectNoDocumentOverflow(page, true);
    assertNoPageErrors();
  });
}
