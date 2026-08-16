# 游戏侧待办

调查时间 2026-08-16,基线提交 `2cbedad`(德州 AI 那轮之后)。

按「改动收益 ÷ 风险」排的序。A 和 B 是有明确终点的活;C 是开放性的调优,需要平衡脚本兜底;D、E 是工具与环境。

---

## 先读这一段:任何 AI 调参都要先跑平衡脚本

德州那轮的教训值得单独写出来,因为它会重演。

我按理论推导改了三处,自认为都对,结果 head-to-head **−58.75 bb/100**。去查噪声本底才发现:**同一个 AI 放两个座位互打,2000 手的 95% 区间是 ±429 bb/100**,而且结果呈双峰(+180 或 −230)——胜负由少数几个全下底池决定。我测的 30–60 bb/100 差异全在噪声里,那个 −58.75 什么都不说明。

改成**对偶记分**(同一副牌两个座位各打一次,牌运抵消)后误差降到 ±3~20,才看清真实情况:

| 变体 | vs 旧版 |
|---|---|
| 听牌 rule of 4 | −3.8 ± 5.9(噪声内) |
| 尺度混合 w=0.28 | **−22.6 ± 3.8(真的变差)** |
| 尺度混合 w=0.08 | +4.3 ± 5.0 |

**结论:凭直觉判断 AI 改动的好坏是不可靠的,凭单次对局统计判断同样不可靠。**

```bash
npm run test:balance:texas
```

`scripts/texas-holdem-balance.ts` 里有个 `minBbPer100VsLegacy: -10` 的闸门,拿当前 AI 对打一个**冻结的**旧版快照。那个快照(`legacyBot`)不要去"改进"它,一改这个基准就失去意义。

争焰和定鼎也有脚本(`test:balance:ember`、`test:balance:dingding`),但它们**没有用对偶记分**,所以噪声可能同样淹没信号——动它们的 AI 之前建议先按德州的方式改造。

---

## A. 争焰 AI 完全没有测试

**现状**

| 游戏 | 源码 | 测试 | 比例 |
|---|---|---|---|
| 定鼎 | 5809 | 3586 | 62% |
| 二十一刻 | 3273 | 1398 | 43% |
| 掼蛋 | 1717 | 678 | 40% |
| **争焰** | **3836** | **1046** | **27%** |

`src/games/ember-pact/domain/` 下三个文件零测试:

- **`ai.ts`** — 5 个导出全部没有测试:
  - `predictedIncomingDamage`(:21)
  - `chooseAiResponse`(:38)
  - `scoreMove`(:71)
  - `chooseBestMove`(:208)
  - `chooseAiMove`(:212)
- **`session.ts`** — 11 个导出
- **`data.ts`**

**为什么要紧**

`scoreMove` 是整个争焰 AI 的估值核心,里面全是手调权重。现在改任何一个数字,332 个测试仍然全绿,但 AI 行为已经变了——**没有任何东西会告诉你**。`test:balance:ember` 测的是整体胜率,不是单个决策对不对,而且它的噪声本底没测过。

**怎么做**

`src/games/dingding/domain/ai.test.ts` 是现成的模板,它的做法是手工构造 `DingState` 再断言具体决策。争焰照抄这个结构即可。

优先覆盖的行为(按价值排):

1. `chooseAiResponse` —— 该不该用卸力挡攻击,手里只剩一张响应牌时会不会留
2. `scoreMove` 的相对序 —— 不断言绝对分数(会随调参变),断言"击杀 > 补刀 > 过牌"这类**排序关系**
3. `predictedIncomingDamage` —— 边界:无来袭、多段来袭、目标已死
4. `chooseAiMove` 在 `difficulty` 三档下的差异

**注意**:不要断言绝对分值,那样每次调权重都要改测试,测试会变成负担而不是保护。断言序关系和边界。

**验证**

```bash
npx vitest run src/games/ember-pact
```

做完后 `grep -c "" src/games/ember-pact/domain/ai.test.ts` 应该有 150 行以上,覆盖率从 27% 拉到 40%+。

---

## B. 德州没有难度分级,而 `BotStyle` 是一条完整的死代码链

五个游戏里德州是唯一没有难度选项的(争焰、定鼎、掼蛋都有 `difficulty`)。

但**类型和数据通路已经铺好了,只差最后一步**:

| 位置 | 内容 | 状态 |
|---|---|---|
| `domain/types.ts:7` | `type BotStyle = "careful" \| "steady" \| "bold"` | 已定义 |
| `domain/types.ts:19` | `TexasPlayer.botStyle?: BotStyle` | 已定义 |
| `domain/engine.ts:22` | east 座位设了 `botStyle: "steady"` | 已赋值 |
| `persistence.ts:83,88` | 存档校验它 | 已校验 |
| `domain/observation.ts` | **没有暴露 botStyle** | ← 断点 |
| `domain/ai.ts` | **从不读它** | ← 断点 |

也就是说这个字段被定义、被赋值、被持久化、被校验,唯独没有被使用。

**怎么做**

1. `observation.ts` 的 `TexasObservation` 加 `readonly botStyle?: BotStyle`,在 `buildTexasObservation` 里从 actor 带出来
2. `ai.ts` 用它调整三个已有的常量。建议方向(具体数值用平衡脚本定):

| 档位 | 思路 | 可调的旋钮 |
|---|---|---|
| `careful` | 跟注更紧、几乎不半诈唬 | 提高 `:120` 的 0.54 门槛,降低 `SIZING_MIX_WEIGHT` |
| `steady` | 现状 | 保持 |
| `bold` | 跟注更松、下注更频 | 降低 `:120`/`:128` 的门槛,提高 `MAX_DRAW_EQUITY` |

3. UI 侧加选择器(参考掼蛋/定鼎的难度入口)

**验证**

三档跑平衡脚本,应该看到单调的强弱序:

```bash
npm run test:balance:texas
```

`careful` 对跟注站应该比 `steady` 差(太紧,赚不到),`bold` 对岩石应该比 `steady` 差(太松,被剥削)。**如果三档打出来的数字在误差棒内没有区别,说明旋钮没拧动,不是"调好了"。**

---

## C. 德州 AI 仍存在的三个弱点

这轮修了听牌计价、下注尺度 tell、位置。剩下三个我没动,因为都需要更大的改动 + 平衡脚本反复验证。

### C1. 从不诈唬 —— 「它一下注就是有牌」

`ai.ts:120` 是唯一的主动下注入口:

```ts
if (raiseTo !== undefined && (strength > 0.72 - edge || (strength > 0.54 - edge && mix > 0.72)))
```

最低门槛是 `strength > 0.50`(有位置时)。而翻牌后纯空气的 strength 大约 0.18 + kicker ≈ **0.32**,永远够不着。面对下注时更严(`:128` 要 0.78),**完全没有诈唬加注**。

后果:人类打十几手就能总结出"它下注 = 有牌",然后无脑弃牌应对所有下注。这是比之前那个尺度 tell 更根本的可读性问题。

**难点**:加诈唬会直接降低对跟注站的收益(诈唬打不动不弃牌的人),所以平衡脚本里 `vsCallingStation` 会掉。需要在 `vsRock`(奖励诈唬)和 `vsCallingStation`(惩罚诈唬)之间找平衡点,不能只看一个数字。建议按牌面质地(干燥/湿润)控制诈唬频率,而不是无条件加。

### C2. 完全不建模对手

`observation.players` 里有 `streetCommitted` 和 `totalCommitted`,但 `ai.ts` 对 `players` 的**唯一**使用是 `:87` 那行找自己的座位号。

也就是说 AI 不知道对手这条街投了多少、加注了几次。一个只加注顶注的对手和一个每条街最小注的对手,在它眼里完全一样。

**入口很小**:`observation` 已经有全部数据,不用改引擎。从"对手这条街的加注次数"这一个特征开始就够了。

### C3. `countStraightOrBetterOuts` 对已成手也算补牌

`evaluator.ts` 的实现是「补到顺子或更好就算一个 out」,所以三条会把补葫芦、补四条的牌也算进去(实测 7 个 outs)。语义上这不叫"听牌",数值上会让本来就强的牌再加一点。

影响很小(强牌 +0.02 左右),但如果之后要基于 outs 做更细的决策,这个口径要先统一。**当前不用急着改**,改了要重跑平衡脚本确认没有副作用。

---

## D. 平衡脚本还差两个,且现有两个的记分方式过时

| 游戏 | 脚本 | 对偶记分 |
|---|---|---|
| 德州 | ✅ `test:balance:texas` | ✅ |
| 争焰 | ✅ `test:balance:ember` | ❌ |
| 定鼎 | ✅ `test:balance:dingding` | ❌ |
| 掼蛋 | ❌ 无 | — |
| 二十一刻 | 不需要 | — |

**掼蛋**值得补一个:它有 `tactician` 难度档(`domain/ai.ts:73`),但那档到底强多少从来没量化过。掼蛋是四人对家局,对偶记分要把四个座位轮转,比德州的两座位复杂,但思路一样。

**二十一刻**不需要:庄家规则是固定的,没有对手 AI 可调;`strategy.ts` 那个基本策略提示已经有测试了。

**争焰和定鼎**的脚本建议按德州的方式改造成对偶记分,否则它们报出来的胜率差异可能和我踩的坑一样——全是噪声。改造的关键是让同一副牌/同一初始局面被不同座位各打一次。

---

## E. 定鼎横屏 e2e 偶发失败(既有问题,不是新引入的)

**现象**

`e2e/cardforge.spec.ts:577` `定鼎关键区块在极窄与手机横屏下不会互相覆盖 @dingding-layout`

```
Error: 底部操作按钮 3应具有可测量边界
expect(received).not.toBeNull()   ← boundingBox() 返回 null
```

**已确认的事实**

- 单独跑 **3/3 通过**
- 全量并行跑,两次失败落在**不同的 project**(先 mobile-landscape,后 mobile-compact)
- **把改动 stash 掉、在提交态基线上重跑,同样复现**(第一次挂、第二次过)→ 与德州那轮改动无关
- CI 配了 `retries: 2`(`playwright.config.ts:12`),所以线上一直看不到;本地 `retries: 0` 才暴露

**根因推断**

`cardforge.spec.ts:620` 附近:

```ts
for (let index = 0; index < await actionButtons.count(); index += 1) {
  const action = actionButtons.nth(index);
  await expectElementWithinViewport(page, action);
  await expectMinimumHitArea(action, `底部操作按钮 ${index + 1}`);
}
```

循环**每一轮都重新 `await actionButtons.count()`**,而定鼎的 AI 有节奏定时器会让操作区在这期间重渲染。按钮列表一变,`nth(index)` 就可能指向已经卸载的节点,`boundingBox()` 于是返回 null。6 个 worker 并行时机器更慢,窗口更容易撞上。

**建议**

循环前先把 count 取一次存下来,并且在进入循环前等操作区稳定(例如等 AI 回合结束的状态标志),而不是在活动状态下逐个量。另一种做法是先把所有按钮的 boundingBox 一次性批量取出再断言。

---

## F. 环境:两个会反复咬人的坑

### F1. e2e 在本地会「全挂但退出码 0」

`playwright.config.ts:5` 本地默认走系统 Chrome channel:

```ts
const channel = process.env.PW_CHANNEL ?? (process.env.CI ? "" : "chrome");
```

这台机器没装 Google Chrome(`/opt/google/chrome/chrome` 不存在),于是 **117 个用例全部在 ~5ms 内失败,而整个命令仍然退出 0**。用 `tail` 看输出会正好把失败列表截掉,读起来像通过。

```bash
PW_CHANNEL= npm run test:e2e
```

健康结果是 **67 passed / 50 skipped / 0 failed**。那 50 个跳过是 spec 自带的 `test.skip(projectName !== "desktop", ...)` 守卫,不是异常。

**永远不要只看退出码判断 e2e 通过,要读 `N passed` 那一行。**

### F2. root 所有权(已第三次复发)

`.git/objects`、`test-results/`、`playwright-report/` 会变成 root 所有,症状分别是 `git commit` 报 `insufficient permission`、Playwright 报 `EACCES`。修法(不需要 sudo):

```bash
docker run --rm -v "$PWD":/w alpine chown -R 1000:1000 /w
```

**注意分别发生**:这次先修了 `test-results/`,提交时又被 `.git` 挡了一次。一次性 chown 整个仓库省事。

### F3. CI 的 Node 20 弃用警告(非阻塞)

```
actions/download-artifact@v6 targets Node.js 20, forced to run on Node.js 24
```

目前只是警告。等 GitHub 真正移除 Node 20 支持时 deploy job 会开始失败。把 workflow 里的 action 版本抬一档即可,几分钟的事,和游戏逻辑无关。

---

## 附:当前基线

```bash
npm run lint          # 通过
npm run typecheck     # 通过
npm test              # 30 文件 / 332 测试通过
npm run build         # 通过
PW_CHANNEL= npm run test:e2e   # 67 通过 / 50 跳过(E 那条偶发除外)
npm run test:balance:texas     # 退出码 0
```

德州平衡脚本当前读数(8400 副对偶,6 组种子):

| 对手 | bb/100 |
|---|---|
| 跟注站 | +414.9 ± 22.0 |
| 岩石 | +167.0 ± 19.6 |
| 激进 | +197.1 ± 15.1 |
| 冻结旧版 | +2.3 ± 7.8 |
