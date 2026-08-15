import type { DingPlayer } from "./types";

export type HeroId =
  | "redblade"
  | "ironward"
  | "springtide"
  | "cloudstep"
  | "whitesteed"
  | "lastwill"
  | "cleareye"
  | "scrollkeeper"
  | "nightowl"
  | "xuanji"
  | "jinyu"
  | "yueji"
  | "liexiao"
  | "wufeng"
  | "chongzhen"
  | "haoke"
  | "youjiao"
  | "junshi"
  | "panwei"
  | "fubi";

export type TriggerPoint =
  | "turnStart"
  | "turnEnd"
  | "damageDealt"
  | "damageReceived"
  | "enterDying"
  | "trickResolved"
  | "playerDied"
  | "death";

export type SkillEffect =
  | "heal-self-1"
  | "draw-self-1"
  | "draw-self-2"
  | "silence-source";

export interface TriggerSpec {
  readonly effect: SkillEffect;
  /** 每个角色在自己的回合内只触发一次；新回合开始时重置。 */
  readonly oncePerTurn?: boolean;
}

export type ActiveSkillTarget = "self" | "wounded" | "other";

export type ActiveSkillCost =
  | { readonly kind: "none" }
  | {
      readonly kind: "discard";
      readonly count: 1;
      /** 不填表示任意手牌；strike/evade/trick 会过滤可消耗手牌。 */
      readonly filter?: "strike" | "evade" | "trick";
    };

export type ActiveSkillBuff =
  | "next-strike-damage"
  | "next-strike-unavoidable"
  | "next-damage-reduction"
  | "distance-to-self"
  | "attack-range"
  | "dying-draw";

export type ActiveSkillEffect =
  | { readonly kind: "heal-1"; readonly target: "wounded" }
  | { readonly kind: "heal-self"; readonly amount: 1 }
  | { readonly kind: "draw"; readonly count: 1 | 2 | 3 }
  | { readonly kind: "draw-discard"; readonly draw: 2; readonly discard: 1 }
  | { readonly kind: "draw-target"; readonly count: 1 }
  | { readonly kind: "damage"; readonly amount: 1 }
  | { readonly kind: "discard-target"; readonly count: 1 }
  | { readonly kind: "delay-target"; readonly flag: "delay:skip-play" | "delay:skip-draw" }
  | { readonly kind: "reset-strike" }
  | { readonly kind: "buff"; readonly buff: ActiveSkillBuff };

export interface ActiveSkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly cost: ActiveSkillCost;
  readonly target: ActiveSkillTarget;
  readonly effect: ActiveSkillEffect;
}

export interface HeroDefinition {
  readonly id: HeroId;
  readonly name: string;
  readonly title: string;
  /** 基础体力上限；主君身份额外 +1。 */
  readonly maxHp: 3 | 4;
  readonly skillName: string;
  readonly description: string;
  readonly triggers?: Partial<Record<TriggerPoint, TriggerSpec>>;
  /** 出牌阶段可主动发动的技能；进入 PendingSkill 决策帧后结算。 */
  readonly activeSkill?: ActiveSkillDefinition;
  /** 该角色计算与其他角色的距离时的修正（如 -1）。 */
  readonly distanceFromModifier?: number;
  /** 其他角色计算与该角色的距离时的修正（如 +1）。 */
  readonly distanceToModifier?: number;
}

export const HERO_IDS: readonly HeroId[] = [
  "redblade",
  "ironward",
  "springtide",
  "cloudstep",
  "whitesteed",
  "lastwill",
  "cleareye",
  "scrollkeeper",
  "nightowl",
  "xuanji",
  "jinyu",
  "yueji",
  "liexiao",
  "wufeng",
  "chongzhen",
  "haoke",
  "youjiao",
  "junshi",
  "panwei",
  "fubi",
];

export const HERO_CATALOG: Readonly<Record<HeroId, HeroDefinition>> = {
  redblade: {
    id: "redblade",
    name: "赤锋",
    title: "破阵先锋",
    maxHp: 4,
    skillName: "厉兵",
    description: "每回合你首次造成伤害后，摸 1 张牌；出牌阶段可弃一张「刺击」，令本回合下一张「刺击」伤害 +1（打出即消耗，即使被闪避）。",
    triggers: {
      damageDealt: { effect: "draw-self-1", oncePerTurn: true },
    },
    activeSkill: {
      id: "pojun",
      name: "破军",
      description: "出牌阶段限一次，弃置一张「刺击」，本回合你下一张「刺击」伤害 +1（打出即消耗，即使被闪避）。",
      prompt: "选择一张「刺击」作为消耗，本回合下一张「刺击」伤害 +1；该增益会在下一张「刺击」打出时消耗。",
      cost: { kind: "discard", count: 1, filter: "strike" },
      target: "self",
      effect: { kind: "buff", buff: "next-strike-damage" },
    },
  },
  ironward: {
    id: "ironward",
    name: "玄甲",
    title: "守城老将",
    maxHp: 4,
    skillName: "承创",
    description: "每回合你首次受到伤害后，摸 1 张牌；出牌阶段可弃一张「闪避」，令你下一次受到的伤害 -1（持续到你下个回合开始）。",
    triggers: {
      damageReceived: { effect: "draw-self-1", oncePerTurn: true },
    },
    activeSkill: {
      id: "jianbi",
      name: "坚壁",
      description: "出牌阶段限一次，弃置一张「闪避」，令你下一次受到的伤害 -1（持续到你下个回合开始）。",
      prompt: "选择一张「闪避」作为消耗，下一次受到的伤害 -1（持续到你下个回合开始）。",
      cost: { kind: "discard", count: 1, filter: "evade" },
      target: "self",
      effect: { kind: "buff", buff: "next-damage-reduction" },
    },
  },
  springtide: {
    id: "springtide",
    name: "春霖",
    title: "杏林隐医",
    maxHp: 3,
    skillName: "回春",
    description: "你的回合开始时，若已受伤，回复 1 点体力；出牌阶段可弃一张手牌，令一名受伤角色回复 1 点体力。",
    triggers: {
      turnStart: { effect: "heal-self-1" },
    },
    activeSkill: {
      id: "qingnang",
      name: "青囊",
      description: "出牌阶段限一次，弃置一张手牌，令一名受伤角色回复 1 点体力。",
      prompt: "选择一张手牌作为消耗，并选择一名受伤角色回复 1 点体力。",
      cost: { kind: "discard", count: 1 },
      target: "wounded",
      effect: { kind: "heal-1", target: "wounded" },
    },
  },
  cloudstep: {
    id: "cloudstep",
    name: "云隐",
    title: "踏雾游侠",
    maxHp: 3,
    skillName: "远遁",
    description: "其他角色计算与你的距离时 +1；出牌阶段可弃一张手牌，本回合该加成额外 +1。",
    distanceToModifier: 1,
    activeSkill: {
      id: "qianxing",
      name: "潜行",
      description: "出牌阶段限一次，弃置一张手牌，本回合其他角色计算与你的距离额外 +1。",
      prompt: "选择一张手牌作为消耗，本回合其他角色计算与你的距离额外 +1。",
      cost: { kind: "discard", count: 1 },
      target: "self",
      effect: { kind: "buff", buff: "distance-to-self" },
    },
  },
  whitesteed: {
    id: "whitesteed",
    name: "白骑",
    title: "轻骑斥候",
    maxHp: 4,
    skillName: "长驱",
    description: "你计算与其他角色的距离时 -1；出牌阶段可弃一张手牌，本回合攻击范围 +1。",
    distanceFromModifier: -1,
    activeSkill: {
      id: "tuxi",
      name: "突袭",
      description: "出牌阶段限一次，弃置一张手牌，本回合你的攻击范围 +1。",
      prompt: "选择一张手牌作为消耗，本回合你的攻击范围 +1。",
      cost: { kind: "discard", count: 1 },
      target: "self",
      effect: { kind: "buff", buff: "attack-range" },
    },
  },
  lastwill: {
    id: "lastwill",
    name: "遗烈",
    title: "孤臣余烬",
    maxHp: 3,
    skillName: "死志",
    description: "每回合你首次进入濒死时，摸 2 张牌；出牌阶段可发动「余烬」，本回合下一次进入濒死时再摸 1 张牌。",
    triggers: {
      enterDying: { effect: "draw-self-2", oncePerTurn: true },
    },
    activeSkill: {
      id: "yujin",
      name: "余烬",
      description: "出牌阶段限一次，本回合你下一次进入濒死时，额外摸 1 张牌。",
      prompt: "本回合下一次进入濒死时，额外摸 1 张牌。",
      cost: { kind: "none" },
      target: "self",
      effect: { kind: "buff", buff: "dying-draw" },
    },
  },
  cleareye: {
    id: "cleareye",
    name: "明鉴",
    title: "观局客卿",
    maxHp: 3,
    skillName: "洞彻",
    description: "每回合你首次结算一张锦囊后，摸 1 张牌；出牌阶段可弃一张锦囊，再摸两张牌。",
    triggers: {
      trickResolved: { effect: "draw-self-1", oncePerTurn: true },
    },
    activeSkill: {
      id: "dongche",
      name: "洞彻",
      description: "出牌阶段限一次，弃置一张锦囊牌，摸两张牌。",
      prompt: "选择一张锦囊牌作为消耗，随后摸两张牌。",
      cost: { kind: "discard", count: 1, filter: "trick" },
      target: "self",
      effect: { kind: "draw", count: 2 },
    },
  },
  scrollkeeper: {
    id: "scrollkeeper",
    name: "黄卷",
    title: "秉笔史官",
    maxHp: 3,
    skillName: "筹谋",
    description: "你的回合结束时，摸 1 张牌；出牌阶段可弃一张手牌，再摸一张牌。",
    triggers: {
      turnEnd: { effect: "draw-self-1", oncePerTurn: true },
    },
    activeSkill: {
      id: "bingbi",
      name: "秉笔",
      description: "出牌阶段限一次，弃置一张手牌，摸一张牌。",
      prompt: "选择一张手牌作为消耗，随后摸一张牌。",
      cost: { kind: "discard", count: 1 },
      target: "self",
      effect: { kind: "draw", count: 1 },
    },
  },
  nightowl: {
    id: "nightowl",
    name: "夜枭",
    title: "巡夜暗哨",
    maxHp: 3,
    skillName: "巡夜",
    description: "你的回合开始时，摸 1 张牌。",
    triggers: {
      turnStart: { effect: "draw-self-1" },
    },
  },
  xuanji: {
    id: "xuanji",
    name: "璇玑",
    title: "观星遗策",
    maxHp: 3,
    skillName: "遗策",
    description: "每回合你首次受到伤害后，摸 2 张牌；出牌阶段可弃一张手牌，摸 2 张牌，然后自动弃置一张低价值手牌。",
    triggers: {
      damageReceived: { effect: "draw-self-2", oncePerTurn: true },
    },
    activeSkill: {
      id: "yance",
      name: "演策",
      description: "出牌阶段限一次，弃置一张手牌，摸两张牌，然后自动弃置一张低价值手牌。",
      prompt: "选择一张手牌作为消耗，随后摸两张牌并自动弃置一张低价值手牌。",
      cost: { kind: "discard", count: 1 },
      target: "self",
      effect: { kind: "draw-discard", draw: 2, discard: 1 },
    },
  },
  jinyu: {
    id: "jinyu",
    name: "金玉",
    title: "金枝玉叶",
    maxHp: 3,
    skillName: "金枝",
    description: "每回合有其他角色死亡后，你摸 2 张牌；出牌阶段可令一名受伤角色回复 1 点体力。",
    triggers: {
      playerDied: { effect: "draw-self-2", oncePerTurn: true },
    },
    activeSkill: {
      id: "yucheng",
      name: "玉成",
      description: "出牌阶段限一次，令一名受伤角色回复 1 点体力。",
      prompt: "选择一名受伤角色，令其回复 1 点体力。",
      cost: { kind: "none" },
      target: "wounded",
      effect: { kind: "heal-1", target: "wounded" },
    },
  },
  yueji: {
    id: "yueji",
    name: "乐姬",
    title: "胡笳断肠",
    maxHp: 3,
    skillName: "绝弦",
    description: "你死亡时，令伤害来源失去所有武将技能；出牌阶段可摸 1 张牌。",
    triggers: {
      death: { effect: "silence-source" },
    },
    activeSkill: {
      id: "beige",
      name: "悲歌",
      description: "出牌阶段限一次，摸 1 张牌。",
      prompt: "发动「悲歌」，摸 1 张牌。",
      cost: { kind: "none" },
      target: "self",
      effect: { kind: "draw", count: 1 },
    },
  },
  liexiao: {
    id: "liexiao",
    name: "烈骁",
    title: "贯阵强锋",
    maxHp: 4,
    skillName: "破坚",
    description: "出牌阶段可弃置一张「刺击」，令本回合你下一张「刺击」无法被「闪避」响应。",
    activeSkill: {
      id: "pojian",
      name: "破坚",
      description: "出牌阶段限一次，弃置一张「刺击」，本回合下一张「刺击」无法被闪避。",
      prompt: "选择一张「刺击」作为消耗，本回合下一张「刺击」无法被闪避。",
      cost: { kind: "discard", count: 1, filter: "strike" },
      target: "self",
      effect: { kind: "buff", buff: "next-strike-unavoidable" },
    },
  },
  wufeng: {
    id: "wufeng",
    name: "武锋",
    title: "双刀都尉",
    maxHp: 4,
    skillName: "再战",
    description: "出牌阶段可弃置一张「刺击」，重置本回合的「刺击」使用次数。",
    activeSkill: {
      id: "zaizhan",
      name: "再战",
      description: "出牌阶段限一次，若你本回合已使用过「刺击」，弃置一张「刺击」并重置刺击使用次数。",
      prompt: "选择一张「刺击」作为消耗，重置本回合刺击使用次数。",
      cost: { kind: "discard", count: 1, filter: "strike" },
      target: "self",
      effect: { kind: "reset-strike" },
    },
  },
  chongzhen: {
    id: "chongzhen",
    name: "冲阵",
    title: "先登死士",
    maxHp: 3,
    skillName: "陷阵",
    description: "出牌阶段可弃置一张「刺击」，对一名其他角色造成 1 点伤害。",
    activeSkill: {
      id: "xianzhen",
      name: "陷阵",
      description: "出牌阶段限一次，弃置一张「刺击」，对一名其他角色造成 1 点伤害。",
      prompt: "选择一张「刺击」作为消耗，并选择一名角色造成 1 点伤害。",
      cost: { kind: "discard", count: 1, filter: "strike" },
      target: "other",
      effect: { kind: "damage", amount: 1 },
    },
  },
  haoke: {
    id: "haoke",
    name: "豪客",
    title: "一掷千金",
    maxHp: 3,
    skillName: "豪掷",
    description: "出牌阶段可弃置一张手牌，摸三张牌。",
    activeSkill: {
      id: "haozhi",
      name: "豪掷",
      description: "出牌阶段限一次，弃置一张手牌，摸三张牌。",
      prompt: "选择一张手牌作为消耗，随后摸三张牌。",
      cost: { kind: "discard", count: 1 },
      target: "self",
      effect: { kind: "draw", count: 3 },
    },
  },
  youjiao: {
    id: "youjiao",
    name: "游缴",
    title: "巡城捕手",
    maxHp: 3,
    skillName: "缴械",
    description: "出牌阶段可弃置一张手牌，令一名其他角色随机弃置一张手牌。",
    activeSkill: {
      id: "jiaoxie",
      name: "缴械",
      description: "出牌阶段限一次，弃置一张手牌，令一名其他角色随机弃置一张手牌。",
      prompt: "选择一张手牌作为消耗，并选择一名其他角色弃置一张手牌。",
      cost: { kind: "discard", count: 1 },
      target: "other",
      effect: { kind: "discard-target", count: 1 },
    },
  },
  junshi: {
    id: "junshi",
    name: "军师",
    title: "困局设谋",
    maxHp: 3,
    skillName: "困局",
    description: "出牌阶段可弃置一张锦囊牌，令一名其他角色跳过下一个出牌阶段。",
    activeSkill: {
      id: "kunju",
      name: "困局",
      description: "出牌阶段限一次，弃置一张锦囊牌，令一名其他角色跳过下一个出牌阶段。",
      prompt: "选择一张锦囊牌作为消耗，并选择一名其他角色跳过下一个出牌阶段。",
      cost: { kind: "discard", count: 1, filter: "trick" },
      target: "other",
      effect: { kind: "delay-target", flag: "delay:skip-play" },
    },
  },
  panwei: {
    id: "panwei",
    name: "磐卫",
    title: "不动营垒",
    maxHp: 4,
    skillName: "整备",
    description: "出牌阶段可回复 1 点体力。",
    activeSkill: {
      id: "zhengbei",
      name: "整备",
      description: "出牌阶段限一次，回复 1 点体力。",
      prompt: "发动「整备」，回复 1 点体力。",
      cost: { kind: "none" },
      target: "self",
      effect: { kind: "heal-self", amount: 1 },
    },
  },
  fubi: {
    id: "fubi",
    name: "辅弼",
    title: "举贤任能",
    maxHp: 3,
    skillName: "举荐",
    description: "出牌阶段可令一名其他角色摸 1 张牌。",
    activeSkill: {
      id: "jujian",
      name: "举荐",
      description: "出牌阶段限一次，令一名其他角色摸 1 张牌。",
      prompt: "选择一名其他角色，令其摸 1 张牌。",
      cost: { kind: "none" },
      target: "other",
      effect: { kind: "draw-target", count: 1 },
    },
  },
};

export function heroOf(player: DingPlayer): HeroDefinition | undefined {
  return HERO_IDS.includes(player.heroId as HeroId)
    ? HERO_CATALOG[player.heroId as HeroId]
    : undefined;
}
