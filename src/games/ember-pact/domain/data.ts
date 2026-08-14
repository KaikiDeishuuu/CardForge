import type {
  BattleCard,
  CardInstance,
  Combatant,
  PassiveDefinition,
  PassiveId,
  StatusDefinition,
  StatusId,
  TeamId,
} from "./types";

export const TEAM_NAMES: Record<TeamId, string> = {
  dawn: "晨铸同盟",
  dusk: "夜蚀来客",
};

export const STATUS_CATALOG: Record<StatusId, StatusDefinition> = {
  exposed: {
    id: "exposed",
    name: "破绽",
    symbol: "裂",
    description: "下一次受到直接攻击时伤害 +2，随后移除。",
    tone: "#d0a45d",
    harmful: true,
  },
  burning: {
    id: "burning",
    name: "灼烧",
    symbol: "灼",
    description: "自身回合结束时受到 2 点真实伤害，持续两个自身回合。",
    tone: "#cf654e",
    harmful: true,
  },
  tempered: {
    id: "tempered",
    name: "蓄势",
    symbol: "势",
    description: "下一次直接攻击伤害 +2，随后移除。",
    tone: "#6fa4a0",
    harmful: false,
  },
};

export const PASSIVE_CATALOG: Record<PassiveId, PassiveDefinition> = {
  "furnace-heart": {
    id: "furnace-heart",
    name: "炉心",
    description: "在自己的行动中为自己获得护盾时，同时获得蓄势。",
  },
  afterglow: {
    id: "afterglow",
    name: "余辉",
    description: "每次治疗同时使目标获得 2 点护盾。",
  },
  siegebreaker: {
    id: "siegebreaker",
    name: "破城",
    description: "直接攻击拥有护盾的目标时，伤害 +2。",
  },
  firehunt: {
    id: "firehunt",
    name: "猎火",
    description: "直接攻击处于灼烧状态的目标时，伤害 +2。",
  },
};

export const CARD_CATALOG: Record<string, BattleCard> = {
  sever: {
    id: "sever",
    name: "断光",
    kind: "attack",
    symbol: "╱",
    description: "对一名敌方造成 3 点伤害",
    target: "enemy",
    tone: "#cc5f4a",
    effects: [{ kind: "damage", amount: 3, target: "chosen" }],
  },
  plate: {
    id: "plate",
    name: "层甲",
    kind: "guard",
    symbol: "◇",
    description: "使一名友方获得 5 点护盾",
    target: "ally",
    tone: "#477a80",
    effects: [{ kind: "block", amount: 5, target: "chosen" }],
  },
  rekindle: {
    id: "rekindle",
    name: "回火",
    kind: "restore",
    symbol: "✦",
    description: "为一名友方恢复 4 点生命",
    target: "ally",
    tone: "#bc8744",
    effects: [{ kind: "heal", amount: 4, target: "chosen" }],
  },
  fracture: {
    id: "fracture",
    name: "裂纹",
    kind: "tactic",
    symbol: "⌁",
    description: "造成 1 点伤害，并施加破绽",
    target: "enemy",
    tone: "#a97752",
    effects: [
      { kind: "damage", amount: 1, target: "chosen" },
      { kind: "apply-status", status: "exposed", target: "chosen" },
    ],
  },
  cinder: {
    id: "cinder",
    name: "燃烬",
    kind: "tactic",
    symbol: "△",
    description: "造成 1 点伤害，并施加两回合灼烧",
    target: "enemy",
    tone: "#be4e3e",
    effects: [
      { kind: "damage", amount: 1, target: "chosen" },
      { kind: "apply-status", status: "burning", duration: 2, target: "chosen" },
    ],
  },
  temper: {
    id: "temper",
    name: "淬势",
    kind: "guard",
    symbol: "⬡",
    description: "自己获得 3 点护盾与蓄势",
    target: "self",
    tone: "#39767a",
    effects: [
      { kind: "block", amount: 3, target: "self" },
      { kind: "apply-status", status: "tempered", target: "self" },
    ],
  },
  refine: {
    id: "refine",
    name: "洗炼",
    kind: "restore",
    symbol: "◌",
    description: "恢复 2 点生命，并移除破绽与灼烧",
    target: "ally",
    tone: "#7a966f",
    effects: [
      { kind: "heal", amount: 2, target: "chosen" },
      { kind: "cleanse", statuses: ["exposed", "burning"], target: "chosen" },
    ],
  },
  siphon: {
    id: "siphon",
    name: "汲取",
    kind: "attack",
    symbol: "⊘",
    description: "造成 3 点伤害，并为自己恢复 2 点生命",
    target: "enemy",
    tone: "#8d4b63",
    effects: [
      { kind: "damage", amount: 3, target: "chosen" },
      { kind: "heal", amount: 2, target: "self" },
    ],
  },
  aegis: {
    id: "aegis",
    name: "守誓",
    kind: "guard",
    symbol: "⌂",
    description: "使一名友方获得 4 点护盾，并移除其破绽",
    target: "ally",
    tone: "#3f6f86",
    effects: [
      { kind: "block", amount: 4, target: "chosen" },
      { kind: "cleanse", statuses: ["exposed"], target: "chosen" },
    ],
  },
  emberwind: {
    id: "emberwind",
    name: "烬风",
    kind: "tactic",
    symbol: "≈",
    description: "造成 2 点伤害，并施加一回合灼烧",
    target: "enemy",
    tone: "#c25a3c",
    effects: [
      { kind: "damage", amount: 2, target: "chosen" },
      { kind: "apply-status", status: "burning", duration: 1, target: "chosen" },
    ],
  },
  rally: {
    id: "rally",
    name: "振鼓",
    kind: "tactic",
    symbol: "◈",
    description: "使一名友方获得 2 点护盾与蓄势",
    target: "ally",
    tone: "#5b8a72",
    effects: [
      { kind: "block", amount: 2, target: "chosen" },
      { kind: "apply-status", status: "tempered", target: "chosen" },
    ],
  },
};

// 每套牌 14 张，牌组构成要能被角色被动读出来：
// 炉心堆护盾、余辉堆治疗、破城堆压制、猎火堆灼烧。
const DECK_RECIPES: Record<string, readonly string[]> = {
  player: [
    "sever", "sever", "sever", "sever",
    "plate", "plate", "plate", "rekindle",
    "fracture", "fracture", "temper", "temper",
    "aegis", "aegis",
  ],
  luna: [
    "sever", "sever", "plate", "plate",
    "rekindle", "rekindle", "rekindle", "rekindle",
    "refine", "refine", "refine", "temper",
    "rally", "rally",
  ],
  scar: [
    "sever", "sever", "sever", "sever", "plate", "plate",
    "fracture", "fracture", "fracture",
    "siphon", "siphon", "siphon", "temper", "temper",
  ],
  ember: [
    "sever", "sever", "sever", "plate", "plate",
    "cinder", "cinder", "cinder",
    "emberwind", "emberwind", "emberwind",
    "fracture", "temper", "temper",
  ],
};

export function buildDeck(ownerId: string): CardInstance[] {
  const recipe = DECK_RECIPES[ownerId];
  if (!recipe) throw new Error(`Unknown Ember Pact combatant: ${ownerId}`);

  return recipe.map((definitionId, index) => ({
    uid: `${ownerId}-${index}-${definitionId}`,
    definitionId,
  }));
}

export const COMBATANT_SEEDS: ReadonlyArray<
  Omit<Combatant, "hp" | "block" | "statuses" | "hand" | "deck" | "discard">
> = [
  {
    id: "player",
    // 四人都有本名：出战角色可选之后，「你」不再固定属于这个座位。
    displayName: "初焰",
    controller: "human",
    title: "晨铸先锋",
    monogram: "焰",
    team: "dawn",
    passiveId: "furnace-heart",
    maxHp: 24,
  },
  {
    id: "luna",
    displayName: "弦月",
    controller: "ai",
    title: "修复师",
    monogram: "弦",
    team: "dawn",
    passiveId: "afterglow",
    maxHp: 20,
  },
  {
    id: "scar",
    displayName: "铸痕",
    controller: "ai",
    title: "破阵者",
    monogram: "痕",
    team: "dusk",
    passiveId: "siegebreaker",
    maxHp: 25,
  },
  {
    id: "ember",
    displayName: "余烬",
    controller: "ai",
    title: "游猎者",
    monogram: "烬",
    team: "dusk",
    passiveId: "firehunt",
    maxHp: 21,
  },
];
