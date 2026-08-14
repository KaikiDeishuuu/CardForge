# CardForge

CardForge 是一个手机竖屏优先、可持续加入新玩法的卡牌游戏平台。当前版本包含统一游戏大厅、游戏注册与按需加载机制、无规则假设的共享卡牌外壳，以及一局可完整进行的原创 2v2 战术游戏「烬契」。

「烬契」现包含四套非对称牌组、角色被动、破绽/灼烧/蓄势状态、评分式 AI、回合末过载和游戏内战术炉谱；所有战斗概念仍保留在游戏自身模块。

## 运行

```bash
npm install
npm run dev
```

验证命令：

```bash
npm run typecheck
npm test
npm run build
```

## 项目结构

```text
src/
  app/                    # 平台大厅与游戏装载入口
  core/games/             # 游戏清单、注册表、最小运行契约
  shared/                 # 无玩法规则的卡牌视觉、声音、基础身份类型
  games/
    registry.ts           # 平台唯一的游戏登记处
    ember-pact/           # 独立 Demo：规则、数据、AI、组件与样式
      domain/             # 可单测的纯规则层
      components/         # 只属于该游戏的表现组件
```

核心层不包含 HP、攻击、阵营或传统回合阶段。它只负责“有哪些游戏”和“如何加载游戏”。「烬契」中的战斗概念全部保留在自己的模块内。

更详细的依赖边界和新增游戏步骤见 [docs/architecture.md](docs/architecture.md)。
