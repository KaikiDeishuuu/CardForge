import type { DingPlayer } from "./types";

export type HeroId =
  | "redblade"
  | "ironward"
  | "springtide"
  | "cloudstep"
  | "whitesteed"
  | "lastwill"
  | "cleareye"
  | "scrollkeeper";

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

export interface HeroDefinition {
  readonly id: HeroId;
  readonly name: string;
  readonly title: string;
  readonly skillName: string;
  readonly description: string;
  readonly triggers?: Partial<Record<TriggerPoint, TriggerSpec>>;
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
];

export const HERO_CATALOG: Readonly<Record<HeroId, HeroDefinition>> = {
  redblade: {
    id: "redblade",
    name: "赤锋",
    title: "破阵先锋",
    skillName: "厉兵",
    description: "每回合你首次造成伤害后，摸 1 张牌。",
    triggers: {
      damageDealt: { effect: "draw-self-1", oncePerTurn: true },
    },
  },
  ironward: {
    id: "ironward",
    name: "玄甲",
    title: "守城老将",
    skillName: "承创",
    description: "每回合你首次受到伤害后，摸 1 张牌。",
    triggers: {
      damageReceived: { effect: "draw-self-1", oncePerTurn: true },
    },
  },
  springtide: {
    id: "springtide",
    name: "春霖",
    title: "杏林隐医",
    skillName: "回春",
    description: "你的回合开始时，若已受伤，回复 1 点体力。",
    triggers: {
      turnStart: { effect: "heal-self-1" },
    },
  },
  cloudstep: {
    id: "cloudstep",
    name: "云隐",
    title: "踏雾游侠",
    skillName: "远遁",
    description: "其他角色计算与你的距离时 +1。",
    distanceToModifier: 1,
  },
  whitesteed: {
    id: "whitesteed",
    name: "白骑",
    title: "轻骑斥候",
    skillName: "长驱",
    description: "你计算与其他角色的距离时 -1。",
    distanceFromModifier: -1,
  },
  lastwill: {
    id: "lastwill",
    name: "遗烈",
    title: "孤臣余烬",
    skillName: "死志",
    description: "每回合你首次进入濒死时，摸 2 张牌。",
    triggers: {
      enterDying: { effect: "draw-self-2", oncePerTurn: true },
    },
  },
  cleareye: {
    id: "cleareye",
    name: "明鉴",
    title: "观局客卿",
    skillName: "洞彻",
    description: "每回合你首次结算一张锦囊后，摸 1 张牌。",
    triggers: {
      trickResolved: { effect: "draw-self-1", oncePerTurn: true },
    },
  },
  scrollkeeper: {
    id: "scrollkeeper",
    name: "黄卷",
    title: "秉笔史官",
    skillName: "筹谋",
    description: "你的回合结束时，摸 1 张牌。",
    triggers: {
      turnEnd: { effect: "draw-self-1", oncePerTurn: true },
    },
  },
};

export function heroOf(player: DingPlayer): HeroDefinition | undefined {
  return player.heroId in HERO_CATALOG ? HERO_CATALOG[player.heroId as HeroId] : undefined;
}
