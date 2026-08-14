import { expect, test, type Page } from "@playwright/test";

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

async function enterGame(page: Page, id: "ember-pact" | "twenty-one" | "guandan") {
  await page.goto(`/?game=${id}`);
  const entryLabels = {
    "ember-pact": "点亮熔炉",
    "twenty-one": "开始判断",
    guandan: "入席开牌",
  } as const;
  await page.getByRole("button", { name: new RegExp(entryLabels[id]) }).click();
}

test("大厅展示三张独立牌桌且不会横向溢出", async ({ page }) => {
  const assertNoPageErrors = collectPageErrors(page);
  await page.goto("/");

  await expect(page.getByRole("button", { name: /烬契/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /二十一刻/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /掼蛋/ })).toBeEnabled();
  await expect(page.locator(".featured-game, .planned-game.is-playable")).toHaveCount(3);
  await expectNoDocumentOverflow(page);
  assertNoPageErrors();
});

test("烬契规则弹层、选牌和目标选择可以完成", async ({ page }) => {
  const assertNoPageErrors = collectPageErrors(page);
  await page.goto("/?game=ember-pact");

  const dialog = page.getByRole("dialog", { name: /先看炉火/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /点亮熔炉/ })).toBeFocused();
  await dialog.getByRole("button", { name: /点亮熔炉/ }).click();

  const hand = page.getByRole("list", { name: "你的手牌" });
  const chosenCard = hand.getByRole("button").first();
  await chosenCard.click();
  await expect(chosenCard).toHaveAttribute("aria-pressed", "true");

  const targets = page.getByRole("button", { name: /可选为目标/ });
  await expect(targets.first()).toBeVisible();
  await targets.first().click();
  await expect(page.getByText(/的行动|正在思考/).first()).toBeVisible();
  assertNoPageErrors();
});

test("烬契可以改选出战角色并翻转敌我两行", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "选将与视口无关，只在一个桌面项目验证");
  const assertNoPageErrors = collectPageErrors(page);
  await page.goto("/?game=ember-pact");

  const dialog = page.getByRole("dialog", { name: /先看炉火/ });
  await expect(page.locator(".team-label--ally span")).toHaveCount(0);

  const scar = dialog.getByRole("radio", { name: /铸痕/ });
  await scar.click();
  await expect(scar).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: /点亮熔炉/ }).click();

  // 铸痕属夜蚀来客，所以己方那一行应当变成夜蚀。
  await expect(page.locator(".team-label--ally span")).toHaveText("夜蚀来客");
  await expect(page.locator(".team-label--enemy span")).toHaveText("晨铸同盟");
  assertNoPageErrors();
});

test("二十一刻可以下注、要牌并结算到下一手", async ({ page }) => {
  const assertNoPageErrors = collectPageErrors(page);
  await page.goto("/?game=twenty-one");

  const entry = page.getByRole("button", { name: /开始判断/ });
  await expect(entry).toBeFocused();
  await entry.click();

  const chips = page.locator(".chip-stack b");
  await expect(chips).toHaveText("500");

  const hit = page.getByRole("button", { name: /要牌/ });
  const cards = page.locator(".playing-hand--player .tw-card");

  // 押注后有可能直接 Blackjack 结算，那就开下一手再试。
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.getByRole("button", { name: "压 25 枚筹码" }).click();
    await expect(chips).toHaveText("475");
    if (await hit.isEnabled()) break;
    await page.getByRole("button", { name: /下一手/ }).click();
  }

  await expect(hit).toBeEnabled();
  const initialCount = await cards.count();
  await hit.click();
  await expect(cards).toHaveCount(initialCount + 1);
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
  await page.getByRole("button", { name: /开始判断/ }).click();
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
  const loading = page.getByRole("status");
  await expect(loading).toContainText("正在展开牌桌");
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await navigation;
  await expect(page.getByRole("dialog", { name: /先看炉火/ })).toBeVisible();
  assertNoPageErrors();
});

test("游戏模块加载失败后可以重试恢复", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "宿主生命周期与视口无关，只在一个桌面项目验证");
  let shouldFail = true;
  await page.route("**/src/games/twenty-one/index.ts", async (route) => {
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
  await expect(page.getByRole("dialog", { name: /第二十一格/ })).toBeVisible();
});

for (const game of [
  { id: "ember-pact", landmark: "烬契战场" },
  { id: "twenty-one", landmark: "二十一刻牌桌" },
  { id: "guandan", landmark: "四人掼蛋牌桌" },
] as const) {
  test(`${game.id} 牌桌适配当前视口`, async ({ page }) => {
    const assertNoPageErrors = collectPageErrors(page);
    await enterGame(page, game.id);
    await expect(page.getByRole("region", { name: game.landmark })).toBeVisible();
    await expectNoDocumentOverflow(page, true);
    assertNoPageErrors();
  });
}
