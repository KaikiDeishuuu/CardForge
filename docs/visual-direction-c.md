# 视觉方向 C:宣纸牌室 — 实施文档

把全站从「深绿牌桌 + 黄铜 + 复古印刷」换成「宣纸 + 墨阶 + 朱砂」,同时把争焰和二十一刻并入
`GameShell` / `--cf-*` 体系,让五个游戏第一次落在同一个 token 层上。

**核心约束:视觉切换只是第 4 步,前三步是纯技术债。跳过它们直接改 `tokens.css`,对争焰和二十一刻不生效。**

---

## 0. 范围

**做:**

- 争焰、二十一刻接入 `GameShell`,自建弹层换成共享 `Dialog` / `ToolMenu`
- 这两个游戏的硬编码颜色/尺寸换成 `--cf-*`
- 替换 `src/styles/tokens.css` 的色板、圆角、阴影、字体
- 大厅重做,`src/styles/global.css` 的旧变量退役
- 补深色模式

**不做:**

- 不动任何 `domain/` 下的引擎、AI、持久化逻辑
- 不动 `GameRegistry` / manifest 结构(`accent` 字段保留,但在新方向下大厅只用它做极弱的区分)
- 不改游戏玩法、文案、交互流程

---

## 1. 开工前

当前基线,开工前先确认能过:

```bash
npm run lint && npm run typecheck && npm test
```

写这份文档时的结果:**29 个测试文件 / 322 个测试全部通过**。每一步做完都要回到这条线。

e2e 需要先构建:

```bash
npm run build && npm run test:e2e
```

建议每一步一个提交,分支从 `main` 开:

```bash
git switch -c feat/visual-direction-c
```

---

## 2. 一条不能违反的顺序约束

`src/styles/global.css` 在 `main.tsx` 里全局引入,它定义的 `--display`、`--utility`、`--ink`、
`--paper`、`--red`、`--line` 会泄漏到所有游戏的 CSS 里。实测使用量:

| 变量 | 全站使用次数 | 争焰 | 二十一刻 |
|---|---|---|---|
| `--utility` | 75 | ✅ | ✅ |
| `--display` | 46 | ✅ | ✅ |
| `--red` | 8 | | |
| `--ink` / `--line` | 各 6 | | |
| `--paper` / `--mist` | 各 2 | | |

争焰的 CSS 里 `var(--display)` + `var(--utility)` 一共 **61 处**,二十一刻 **31 处**。

**如果先做第 5 步(退役 `global.css`)再迁移这两个游戏,它们的字体会静默回退到浏览器默认 serif/sans,
不会报错、不会有测试失败,只有肉眼能发现。** 所以顺序锁死为:

```
迁移 GameShell → token 化 → 换色板 → 退役 global.css → 深色模式
   步骤 1、2        步骤 3       步骤 4      步骤 5        步骤 6
```

---

## 3. 受测试保护的类名

改这些类名必须同步改测试,否则会红。迁移时优先保留原类名,只换它们的样式来源。

| 类名 | 被谁依赖 | 位置 |
|---|---|---|
| `.featured-game`、`.planned-game.is-playable` | e2e | `e2e/cardforge.spec.ts:168` |
| `.team-label--ally span`、`.team-label--enemy span` | e2e | `e2e/cardforge.spec.ts:200,208,209` |
| `.pact-save-warning` | 单测 | `src/games/ember-pact/EmberPactGame.test.tsx:162` |
| `.twenty-one-surface` | 单测 | `src/games/twenty-one/components/TwentyOneExperience.test.tsx:363,369` |
| `.player-hands-grid--3` | 单测 | 同上 `:263` |
| `.table-status` | 单测 | 同上 `:299` |
| `.cf-game-shell__surface` | 单测 | `src/shared/ui/GameShell.test.tsx:93,103` |

其中 `.twenty-one-surface` 在第 2 步会被 `GameShell` 的 `.cf-game-shell__surface` 取代,
那两行断言要一起改——这是第 2 步唯一预期会红的测试。

e2e 绝大多数用的是 `getByRole` + 可访问名,不受 CSS 影响,这是好消息:
**只要不改 `aria-label` 和可见文案,重构 CSS 不会碰倒 e2e。**

---

## 步骤 1 — 争焰接入 GameShell

### 现状

`src/games/ember-pact/EmberPactGame.tsx:369` 起是完全自建的外壳:

```jsx
<main className="battle-screen">
  <header className="battle-topbar">      {/* 返回 + 标题 + 5 个 icon-button */}
  <section className="battlefield">        {/* team-label + seat-row ×2 */}
    <section className="hand-dock">        {/* 行动区 */}
  {/* 通知与弹层 */}
</main>
```

五个 `.icon-button`:查看争焰记录(◎)、打开角色与规则(?)、查看战报(≡)、AI 速度(n×)、声音(♪/×)。

弹层已经在用 `useModalFocus`,`role` / `aria-modal` / `aria-labelledby` 都齐全,
但**没有 `inert`**——弹层打开时底下的战场仍可被 Tab 和点到。这是本步最大的实际收益。

### 目标结构

参照已迁移的 `src/games/dingding/DingDingGame.tsx:947` 写法:

```jsx
<GameShell
  className="battle-screen"
  contentClassName="battlefield"
  contentLabel="争焰战场"
  topBar={
    <GameTopBar
      className="battle-topbar"
      title="争焰"
      subtitle="四席阵营策略"
      onBack={onExit}
      actions={toolActions}
      onMore={() => setMoreOpen(true)}
      moreOpen={moreOpen}
    />
  }
  status={restoredNotice ? `已恢复第 ${state.roundNumber} 轮争焰` : undefined}
  actionDock={<div className="hand-dock">…</div>}
  overlayActive={modalOpen}
  overlay={<>{/* 全部弹层 */}</>}
>
  {/* team-label + seat-row */}
</GameShell>
```

### 动作

**1.1 五个 icon-button 转成 `GameToolAction[]`**

```ts
const toolActions: GameToolAction[] = [
  { id: "profile", label: "争焰记录", icon: "◎", onSelect: () => setShowProfile(true) },
  { id: "brief",   label: "角色与规则", icon: "?", onSelect: () => setShowBrief(true) },
  { id: "log",     label: "战报", icon: "≡", pressed: showLog, onSelect: () => setShowLog((v) => !v) },
  { id: "speed",   label: `AI 速度 ${playbackSpeed}×`, icon: `${playbackSpeed}×`, onSelect: cyclePlaybackSpeed },
  { id: "sound",   label: soundEnabled ? "关闭声音" : "开启声音", icon: soundEnabled ? "♪" : "×", onSelect: toggleSound },
];
```

`GameTopBar` 在 ≥48rem 时把 actions 平铺,窄屏收进 `ToolMenu`——这正是现在缺的响应式行为。

⚠️ e2e 依赖 `getByRole("button", { name: "打开角色与规则" })`
(`e2e/cardforge.spec.ts:224`)。`GameToolAction.label` 会成为按钮的可访问名,
所以 **`brief` 那条的 label 必须保持「打开角色与规则」**,或者同步改 e2e。
建议保持原文案,把改动面压到最小。

**1.2 五个自建弹层换成 `<Dialog>`**

| 组件 | 位置 | 当前类名 | role |
|---|---|---|---|
| `TacticalBrief` | `components/TacticalBrief.tsx:81` | `.ledger-overlay` | dialog |
| `CombatantSheet` | `components/TacticalBrief.tsx:219` | `.ledger-overlay--sheet` | dialog |
| `EndTurnConfirm` | `components/BattlePanels.tsx:96` | `.ledger-overlay--confirm` | **alertdialog** |
| `ResultPanel` | `components/BattlePanels.tsx:140` | `.result-overlay` | dialog |
| `ProfilePanel` | `components/BattlePanels.tsx:205` | `.ledger-overlay--profile` | dialog |

每个的改法一致:删掉 `useModalFocus` 调用和外层 div,改成

```jsx
<Dialog
  open
  role="alertdialog"                       {/* 仅 EndTurnConfirm */}
  title="结束本回合"
  onClose={onCancel}
  className="pact-dialog pact-dialog--confirm"
  footer={<>…</>}
>
  {/* 原来的内容 */}
</Dialog>
```

⚠️ **这里有个容易踩的坑:** `.ledger-overlay` 现在是**一个 div 同时当遮罩和面板**
(既有 `position: fixed; inset: 0` 又有 padding 和背景)。`Dialog` 把这两层拆开了:
`.cf-dialog-backdrop`(遮罩)+ `.cf-dialog`(面板)。所以 `ember-pact.css` 里
`.ledger-overlay` 那一坨样式要**拆成两份**,分别挂到 `backdropClassName` 和 `className` 上。
不拆的话会出现「面板铺满全屏」或「遮罩不生效」。

`ResultPanel` 的 `useModalFocus({ active: true, initialFocus: ".primary-button" })`
对应 `Dialog` 的 `initialFocus=".primary-button"`。

`ProfilePanel` 和 `CombatantSheet` 现在靠外层 `onClick={onClose}` 关闭,
换成 `Dialog` 的 `dismissOnBackdrop`(默认 true)即可,把那个 `onClick` 删掉——
它现在其实有 bug:点面板内部也会冒泡关闭。

**1.3 `.battle-log` 保持原样**

它是个 `<aside>` 侧栏不是模态,不进 `overlay`,留在 `GameShell` 的 children 里即可。
但它现在的 z-index 要改成 `var(--cf-z-sticky)` 以下,避免压住 topbar。

**1.4 `.pact-save-warning` / `.pact-restore-notice`**

`restoredNotice` 可以直接喂给 `GameShell` 的 `status` 槽(它自带 `role="status"` + `aria-live`)。
`.pact-save-warning` 是 `role="alert"`,**类名必须保留**(单测依赖),继续放在 children 里。

### 验证

```bash
npm run lint && npm run typecheck && npm test
```

预期:**全绿,0 处改测试**。争焰的单测只断言 `.pact-save-warning`,该类名不动。

手动检查两件 GameShell 才有的事:

1. 打开「角色与规则」,按 Tab —— 焦点不应该跑到底下的战场牌上(`inert` 生效)
2. 窗口宽度收到 600px 以下 —— 五个工具按钮应该收进右上角「•••」

```bash
npm run build && npm run test:e2e
```

### 完成标准

- `EmberPactGame.tsx` 不再出现 `<main className="battle-screen">`,改由 `GameShell` 渲染
- `components/` 下不再有 `useModalFocus` 调用(全部由 `Dialog` 接管)
- 弹层打开时战场不可 Tab

---

## 步骤 2 — 二十一刻接入 GameShell

### 现状

比争焰近一半:已经在用 `GameTopBar` 和 `ToolMenu`
(`src/games/twenty-one/components/TwentyOneExperience.tsx:5`),
而且 `:270` 那行 `<div className="twenty-one-surface" inert={overlayOpen || undefined}>`
**等于手写了一遍 `GameShell` 的 surface 层**。所以这步基本是删代码。

三个自建 modal 仍在用 `useModalFocus`:ledger(`:382`)、result(`:402`)、summary(`:408`),
外加一个独立的 setup 屏(`:495`)。

### 动作

**2.1 `.twenty-one-surface` 让位给 `GameShell`**

```jsx
<GameShell
  className="twenty-one-screen"
  contentClassName="twenty-one-table"
  contentLabel="二十一刻牌桌"
  topBar={<GameTopBar className="twenty-one-topbar" … />}
  actionDock={…}
  overlayActive={overlayOpen}
  overlay={<>{/* ToolMenu + 三个 Dialog */}</>}
>
```

**⚠️ 这是本次唯一预期会红的测试。** 改完后
`src/games/twenty-one/components/TwentyOneExperience.test.tsx:363` 和 `:369` 的

```ts
expect(document.querySelector(".twenty-one-surface")?.hasAttribute("inert")).toBe(true);
```

要改成 `.cf-game-shell__surface`。断言的语义完全不变,只是换了实现者。

**2.2 三个 modal 换 `<Dialog>`**

和步骤 1.2 同法。注意 `.twenty-one-modal--result` 有独立样式,用 `className` 传进去。

**2.3 setup 屏(`:495`)**

它是另一个 `<main className="twenty-one-screen twenty-one-screen--setup">`,
带一个恒为 `inert` 的背景层和一个 setup modal。同样换成 `GameShell` +
`overlayActive` 恒 true + `overlay={<Dialog open …>}`。

`:497` 那个手写的 `<header className="twenty-one-topbar">` 换成 `GameTopBar`,
注意它的 `onBack` 是 `onExit`,标题 `CARDFORGE · TABLE 002` 保留。

**2.4 保留 `.player-hands-grid--3` 和 `.table-status`**

单测依赖,不要改名。

### 验证

```bash
npm test
```

预期:**只有上面那两行断言需要改**,改完全绿。

```bash
npm run build && npm run test:e2e
```

`e2e/twenty-one.spec.ts` 全部走 role 选择器,应该零改动通过。

---

## 步骤 3 — 两个游戏的 token 化

到这一步为止,视觉上应该**没有任何变化**。

### 工作量

| 文件 | 行数 | 硬编码颜色 | 不对称圆角 | `--display`/`--utility` |
|---|---|---|---|---|
| `ember-pact.css` | 2399 | 284 | 22 | 61 |
| `twenty-one.css` | 2495 | 245 | 14 | 31 |

对照已迁移的:`dingding.css` 只有 31 处硬编码色、203 处 `--cf-*`。这是目标形态。

### 动作

**3.1 在每个游戏的根类上做局部映射**

照 `dingding.css:1` 和 `guandan.css:1` 的写法,在根选择器里把游戏私有变量接到 `--cf-*` 上:

```css
.battle-screen {
  --cf-color-table: #17383d;          /* 保持现有深绿,这步不换色 */
  --cf-color-accent: #cf6049;
  --pact-panel: #244348;
  --pact-line: rgb(255 255 255 / 13%);
}
```

**3.2 按族替换,不要逐条替换**

用高频色分组,一族一族地换。争焰的实测分布:

| 现值 | 出现 | 换成 |
|---|---|---|
| `#17383d` | 11 | `var(--cf-color-table)` |
| `#244348` | 5 | `var(--pact-panel)` |
| `#34575a` / `#3f7476` | 10 | `var(--cf-color-table-subtle)` |
| `#8b554b` | 4 | `var(--cf-color-accent)` |
| `#e3b35f` / `#6f5736` | 7 | `var(--cf-color-warning)` |
| `rgba(255,255,255,0.x)` | ~20 | `var(--cf-color-border-on-table)` 或保留 |

二十一刻:

| 现值 | 出现 | 换成 |
|---|---|---|
| `#263e44` / `#274b55` | 8 | `var(--cf-color-table)` |
| `#7c2f3b` / `#6d3039` | 9 | `var(--cf-color-accent)` |
| `#556467` / `#71807e` | 8 | `var(--cf-color-text-on-table-muted)` |
| `#c49a51` / `#f0dfc0` | 6 | `var(--cf-color-warning)` |

**3.3 间距和触控**

裸 px 换 `--cf-space-*`(4px 制)。所有可点元素补 `min-height: var(--cf-touch-target)`。
争焰的 `.icon-button` 是 44px,正好等于 `2.75rem`,直接换。

**3.4 圆角先统一到 `--cf-radius-md`**

那 36 处不对称圆角(`15px 3px 15px 3px` 之类)先全换成 `var(--cf-radius-md)`。
这步会**改变外观**——这是整个流程里第一次视觉变化,可以接受,因为它是第 4 步的一部分,
提前做只是为了避免第 4 步的 diff 太大。

如果想让第 3 步严格「零视觉变化」,就把圆角留到第 4 步一起做。

**3.5 `--display` / `--utility` 换成 `--cf-font-*`**

这是解除步骤 5 阻塞的关键动作:

```
var(--display)  →  var(--cf-font-display)
var(--utility)  →  var(--cf-font-sans)   /* 见下方说明 */
```

⚠️ `--utility` 是 DIN Alternate 窄体,`--cf-font-sans` 是 Avenir Next,**不等价**。
这 92 处替换会让所有小标签变宽。两个选择:

- **(推荐)** 在 `tokens.css` 里补一个 `--cf-font-label`,值就用原来的 `--utility` 字体栈,
  保持现状,把「要不要保留窄体标签」这个决定推到第 4 步一起做
- 或者接受变宽,顺势把窄体大写标签这个旧风格特征去掉

### 验证

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e
```

全绿。CSS 改动不该碰倒任何测试——如果红了,说明手滑改到了 JSX。

### 完成标准

```bash
grep -c "var(--cf-" src/games/ember-pact/ember-pact.css     # 应 > 150
grep -c "var(--cf-" src/games/twenty-one/twenty-one.css     # 应 > 150
grep -c "var(--display)\|var(--utility)" src/games/ember-pact/ember-pact.css   # 应为 0
grep -c "var(--display)\|var(--utility)" src/games/twenty-one/twenty-one.css   # 应为 0
```

**最后一条为 0,是进入步骤 5 的前提。**

---

## 步骤 4 — 替换 tokens.css(视觉切换点)

前三步做完,这一步是当天可见、可整体回滚的。

### 动作

替换 `src/styles/tokens.css` 里的色板、圆角、阴影、字体。变量名一个都不动:

```css
:root {
  /* ---- 宣纸 ---- */
  --cf-color-canvas:          #e4dfd3;
  --cf-color-surface:         #edeae1;
  --cf-color-surface-raised:  #f6f4ed;

  /* ---- 墨底牌桌 ---- */
  --cf-color-table:           #2b2a26;
  --cf-color-table-subtle:    #3a3833;

  /* ---- 墨阶文字 ---- */
  --cf-color-text:                 #17161a;
  --cf-color-text-muted:           #6e6b62;
  --cf-color-text-on-table:        #ece8dd;
  --cf-color-text-on-table-muted:  #a8a49a;

  --cf-color-border:          rgb(23 22 20 / 14%);
  --cf-color-border-on-table: rgb(236 232 221 / 16%);

  /* ---- 朱砂:全站唯一彩色 ---- */
  --cf-color-accent:          #9e3b32;
  --cf-color-accent-contrast: #f6f4ed;

  /* ---- 焦点环要同时压得住纸和墨,所以比朱砂更亮 ---- */
  --cf-color-focus:           #c4564a;
  --cf-color-focus-contrast:  #17161a;

  /* ---- 语义色向墨色收敛,不跟朱砂抢 ---- */
  --cf-color-success:         #4a5f4a;
  --cf-color-warning:         #8a6a35;
  --cf-color-danger:          #9e3b32;
  --cf-color-scrim:           rgb(23 22 20 / 62%);

  /* ---- 印章是方的 ---- */
  --cf-radius-sm:  2px;
  --cf-radius-md:  2px;
  --cf-radius-lg:  2px;

  /* ---- 发丝线分隔,不用投影 ---- */
  --cf-shadow-sm:     none;
  --cf-shadow-md:     0 1px 2px rgb(23 22 20 / 8%);
  --cf-shadow-dialog: 0 12px 40px rgb(23 22 20 / 24%);

  /* ---- 宋体转正为标题字 ---- */
  --cf-font-display: "Bodoni 72", "Didot", "Songti SC", "STSong",
                     "Source Han Serif SC", "Noto Serif CJK SC", serif;
}
```

### 三个必须一起处理的问题

**① 拉丁数字**

宋体的拉丁字形偏窄偏平,而德州和二十一刻满屏是筹码数和点数。
上面 `--cf-font-display` **刻意把 Bodoni/Didot 留在栈的最前面**:
拉丁字符走 Bodoni,CJK 回落到宋体。不要为了「纯宋体」把 Bodoni 删掉,
否则牌桌上的数字会散。

所有数字列还要补:

```css
font-variant-numeric: tabular-nums;
```

**② 朱砂配额**

全站只剩一个彩色,「当前回合」「可点击」「危险操作」三件事要靠
**朱砂 + 边框 + 字重**区分,而不是三种颜色。需要重写的地方:

```bash
grep -rn "is-danger" src --include="*.css"
grep -rn "aria-pressed" src --include="*.css"
```

建议约定:

- 主操作 = 朱砂填充
- 当前回合 / 选中 = 朱砂描边 + 不填充
- 危险操作 = 朱砂文字 + 墨色描边

**③ 焦点环不要用朱砂**

`--cf-color-focus` 单独取了更亮的 `#c4564a`。朱砂 `#9e3b32` 在墨底
`#2b2a26` 上对比度不够,不满足可见焦点要求。**不要为了「只用一个红」把它并掉。**

### 顺带清掉的东西

这一步之后,下面这些是净删除而不是重写:

```bash
# 不对称圆角(36 处,步骤 3.4 若已做则此处为 0)
grep -rn "border-radius:[^;]*px [0-9]" src --include="*.css"

# 硬边偏移投影(6 处)
grep -rn "box-shadow:[^;]*px 0 rgba" src --include="*.css"

# 网格/斜纹纹理(11 处)
grep -rn "repeating-linear-gradient\|1px, transparent 1px" src --include="*.css"
```

印章可以直接复用现有的 `.game-error__seal`(`src/styles/global.css:856`),
它本来就是朱红圆章,改成方章即可。

### 验证

```bash
npm test && npm run build && npm run test:e2e
```

全绿(纯 CSS 改动)。然后**逐个游戏肉眼过一遍**,重点看:

- 每屏是否只有一处朱砂
- 焦点环在纸底和墨底上都清晰可见
- 德州/二十一刻的数字有没有散

### 回滚

```bash
git revert <本步的 commit>
```

只有一个文件,回滚干净。

---

## 步骤 5 — 大厅重做,global.css 退役

**前提:步骤 3 的最后一条 grep 必须为 0。**

大厅是唯一需要真正重画的地方——它的整套视觉都写在 `global.css` 里,
93 处硬编码色、6 处网格纹理、7 处不对称圆角。

### 动作

**5.1 `global.css` 顶部的旧变量块整体删除**

```css
/* 全部删掉 */
--ink --felt --paper --mist --red --brass --line --display --utility
```

删之前再确认一次全站为 0:

```bash
grep -rn "var(--ink)\|var(--felt)\|var(--paper)\|var(--mist)\|var(--red)\|var(--brass)\|var(--line)\|var(--display)\|var(--utility)" src
```

**5.2 `global.css` 引入 tokens**

```css
@import url("./tokens.css");
```

**5.3 删掉装饰**

- `.wordmark__mark` / `.forge-spinner` 的三根 `<i>` 辐条(`global.css:121-150`)→ 换成方印
- `.featured-game__sigil` 的同心圆 + 辐条(`:332-378`)→ 换成一枚大方印
- `.lobby` 的网格背景(`:64-72`)→ 删除,留纯宣纸底
- `.game-loading` / `.game-error` 的网格(`:738`, `:822`)→ 同上

对应的 JSX 里那些空 `<i />` 也要删,在 `src/app/Lobby.tsx` 的 **73、107、177、193** 行。

⚠️ `Lobby.tsx:116` 也有一个 `<i />`,但它是页脚里的**分隔圆点**不是装饰辐条,
grep `<i />` 会一起捞到它,别误删:

```jsx
<span>{featured.manifest.players}<i />{featured.manifest.sessionLength}</span>
```

**5.4 保留 e2e 依赖的类名**

`.featured-game` 和 `.planned-game.is-playable` **不能改名**,
`e2e/cardforge.spec.ts:168` 断言的是:

```ts
await expect(page.locator(".featured-game, .planned-game.is-playable")).toHaveCount(5);
```

注意它同时锁死了**数量 5**——大厅重画时如果改了主推卡和货架卡的结构关系
(比如把主推也渲染成 `.planned-game`),这条会红。改样式不改结构就没事。

### 验证

```bash
npm test && npm run build && npm run test:e2e
```

`e2e/cardforge.spec.ts` 有大厅相关用例,这步是 e2e 最可能红的一步。
如果红,先看是不是删 `<i />` 时连带删掉了带 `aria-label` 的元素。

---

## 步骤 6 — 补深色模式

整套色板是无彩墨阶,深色版基本是把 canvas/surface 和 text 两组对调,朱砂不动。

**6.1 解开写死的 light**

`src/styles/global.css:2` 现在是 `color-scheme: light;`,改成:

```css
color-scheme: light dark;
```

**6.2 在 `tokens.css` 末尾加**

```css
@media (prefers-color-scheme: dark) {
  :root {
    --cf-color-canvas:         #17161a;
    --cf-color-surface:        #201f1c;
    --cf-color-surface-raised: #2b2a26;
    --cf-color-text:           #ece8dd;
    --cf-color-text-muted:     #a8a49a;
    --cf-color-border:         rgb(236 232 221 / 14%);
    /* 牌桌本来就是墨底,不用改 */
    /* 朱砂在深底上要提亮一档 */
    --cf-color-accent:         #b8483d;
  }
}
```

**⚠️ 只在这个块里重定义 token,不要在里面写组件样式。**
组件一律通过 token 取色,否则会出现「浅色文字压在深色底上」的经典 bug。

**6.3 检查**

深色下重点看大厅(它是唯一大面积浅底的地方)和所有 `.cf-dialog`
(纸质面板在深色下要跟着变墨)。

---

## 附录 A — 验证清单

每一步都跑:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

| 步骤 | 预期测试结果 | 预期视觉变化 |
|---|---|---|
| 1 争焰接 GameShell | 全绿,0 改动 | 无(多了 inert 和响应式工具栏) |
| 2 二十一刻接 GameShell | 改 2 行断言 | 无 |
| 3 两游戏 token 化 | 全绿,0 改动 | 无(圆角除外,见 3.4) |
| 4 换 tokens.css | 全绿,0 改动 | **全站换色** |
| 5 大厅重做 | e2e 可能红 | 大厅重画 |
| 6 深色模式 | 全绿 | 新增深色 |

## 附录 B — 单步回滚

每步一个提交,任意一步可单独 revert。第 4 步只动一个文件,回滚最干净;
第 1、2 步动 JSX,回滚前确认没有后续提交依赖新的组件签名。

## 附录 C — 可以并行的部分

步骤 1 和步骤 2 互不依赖(两个游戏各自独立),可以并行或换序。
步骤 3 必须等 1、2 都完成。步骤 4 必须等 3 完成。5 必须等 3 的 grep 归零。
