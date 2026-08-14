# CardForge 架构说明

## 当前边界

CardForge 采用三层很薄的结构：

```text
平台 app
  ├─ core/games：注册、清单、异步装载契约
  ├─ shared：不带规则的视觉与设备能力
  └─ games/<game-id>：某一游戏完整的规则、状态、AI 和 UI
```

依赖只向 `core` / `shared` 方向流动。一个游戏不能导入另一个游戏的实现；平台也不能根据某个游戏的 HP、阵营或卡牌类型做判断。

### core

`GameManifest` 是大厅可读取的元数据，`GameRuntimeProps` 是平台传给游戏的最小生命周期接口，`GameRegistry` 负责去重与检查可玩游戏是否提供加载器。注册项通过动态 `import()` 加载，因此新增游戏不会自动进入首屏包。

### shared

`CardFrame` 只提供卡片的几何、排版、选中与禁用状态。它不知道费用、伤害、颜色匹配或点数。`ParticipantIdentity` 只描述身份和控制者，不假设玩家拥有生命值。声音服务同样只接受抽象提示音。

只有确认被多种游戏共同需要、且不引入玩法假设的能力，才应移入 `shared`。

### games/ember-pact

Demo 自己拥有：

- `domain/data.ts`：角色与卡牌数据；
- `domain/engine.ts`：抽牌、合法目标、效果解析、回合、死亡与胜负；
- `domain/ai.ts`：只属于本游戏的决策；
- `EmberPactGame.tsx`：交互编排和 AI 动画节奏；
- `components/` 与样式：HP、护盾、战场和手牌表现。

规则引擎是纯函数。UI 发送 `playCard` / `passTurn` 意图并渲染返回的新状态，不直接修改 HP。卡牌效果由数据中的 `effects` 数组描述，再交给效果处理器解析；被动、状态、过载和抽牌溢出都会产生结构化 `ResolvedEvent`，战报、AI 评分和动画消费同一份结算结果。

## 新增一个游戏

1. 创建 `src/games/<game-id>/`，让该目录完整拥有自己的状态、规则、AI 和 UI。
2. 导出一个满足 `GameRuntimeProps` 的 `Game` 组件。
3. 在 `src/games/registry.ts` 中加入 manifest 和动态加载器。
4. 为规则层编写纯函数测试，并验证 390px 宽竖屏。

如果新游戏需要 UNO 式颜色匹配或 Blackjack 式庄家流程，应直接在新游戏内定义这些概念，而不是扩充平台 `GameState`。只有当第二个游戏真实复用了某项能力，再考虑提取共享模块。

## 第一阶段刻意不做

当前没有通用技能 DSL、联网同步、持久化账号、商城、复杂事件总线或跨游戏存档格式。这些能力需要真实的第二个游戏或产品需求来验证边界，现在加入只会让最小契约变重。

## 框架引入阈值

2026-08 的架构审查决定暂不引入 XState、boardgame.io、Phaser 或 Colyseus。当前 Core 只负责注册和加载，固定回合、合法行动与 AI 仍足够小，并且只属于「烬契」。

- **XState**：同一个平台 Session 同时需要存档恢复、暂停、重连、观战或错误重试中的至少两项时，再用于 `app/session` 或 `core/session`；不管理具体游戏规则。
- **boardgame.io**：某一新游戏真实需要复杂阶段、同时行动、隐藏玩家视图、撤销/回放或服务端回合验证时，只在该游戏内部做适配试验；不成为 CardForge 唯一引擎。
- **Phaser**：某一游戏必须使用大量精灵、摄像机、粒子、Shader 或持续帧循环时，才在该游戏的动态加载模块内部使用。
- **Colyseus**：确认真人联网产品需求并建立权威服务端后再评估；平台 Core 不直接依赖网络框架。

在第二款可玩游戏完成前，不凭预想向 Core 提取通用回合、状态、HP、动作或 AI 调度接口。
