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
  | "nightowl";

export type TriggerPoint =
  | "turnStart"
  | "turnEnd"
  | "damageDealt"
  | "damageReceived"
  | "enterDying"
  | "trickResolved";

export type SkillEffect =
  | "heal-self-1"
  | "draw-self-1"
  | "draw-self-2";

export interface TriggerSpec {
  readonly effect: SkillEffect;
  /** 每个角色在自己的回合内只触发一次；新回合开始时重置。 */
  readonly oncePerTurn?: boolean;
}

export type ActiveSkillTarget = "self" | "wounded";

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
  | "next-damage-reduction"
  | "distance-to-self"
  | "attack-range"
  | "dying-draw";

export type ActiveSkillEffect =
  | { readonly kind: "heal-1"; readonly target: "wounded" }
  | { readonly kind: "draw"; readonly count: 1 | 2 }
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
];

export const HERO_CATALOG: Readonly<Record<HeroId, HeroDefinition>> = {
  redblade: {
    id: "redblade",
    name: "赤锋",
    title: "破阵先锋",
    skillName: "厉兵",
    description: "每回合你首次造成伤害后，摸 1 张牌；出牌阶段可弃一张「刺击」，令本回合下一张「刺击」伤害 +1。",
    triggers: {
      damageDealt: { effect: "draw-self-1", oncePerTurn: true },
    },
    activeSkill: {
      id: "pojun",
      name: "破军",
      description: "出牌阶段限一次，弃置一张「刺击」，本回合你下一张「刺击」伤害 +1。",
      prompt: "选择一张「刺击」作为消耗，本回合下一张「刺击」伤害 +1。",
      cost: { kind: "discard", count: 1, filter: "strike" },
      target: "self",
      effect: { kind: "buff", buff: "next-strike-damage" },
    },
  },
  ironward: {
    id: "ironward",
    name: "玄甲",
    title: "守城老将",
    skillName: "承创",
    description: "每回合你首次受到伤害后，摸 1 张牌；出牌阶段可弃一张「闪避」，令本回合你下一次受到的伤害 -1。",
    triggers: {
      damageReceived: { effect: "draw-self-1", oncePerTurn: true },
    },
    activeSkill: {
      id: "jianbi",
      name: "坚壁",
      description: "出牌阶段限一次，弃置一张「闪避」，本回合你下一次受到的伤害 -1。",
      prompt: "选择一张「闪避」作为消耗，本回合下一次受到的伤害 -1。",
      cost: { kind: "discard", count: 1, filter: "evade" },
      target: "self",
      effect: { kind: "buff", buff: "next-damage-reduction" },
    },
  },
  springtide: {
    id: "springtide",
    name: "春霖",
    title: "杏林隐医",
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
    skillName: "巡夜",
    description: "你的回合开始时，摸 1 张牌。",
    triggers: {
      turnStart: { effect: "draw-self-1" },
    },
  },
};

export function heroOf(player: DingPlayer): HeroDefinition | undefined {
  return HERO_IDS.includes(player.heroId as HeroId)
    ? HERO_CATALOG[player.heroId as HeroId]
    : undefined;
}
