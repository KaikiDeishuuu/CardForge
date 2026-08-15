import type {
  BattleCard,
  CardInstance,
  Combatant,
  Difficulty,
  PassiveDefinition,
  PassiveId,
  StatusDefinition,
  StatusId,
  TeamId,
} from "./types";

export const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  novice: "见习",
  standard: "标准",
  tactician: "战术",
};

export const TEAM_NAMES: Record<TeamId, string> = {
  dawn: "守炉庭",
  dusk: "逐光团",
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
    description: "自身回合结束时受到 2 点真实伤害；持续时间由施加它的牌决定。",
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
    role: "防守反击",
    description: "在自己的行动中为自己获得护盾时，同时获得蓄势。",
  },
  afterglow: {
    id: "afterglow",
    name: "余辉",
    role: "治疗支援",
    description: "每次产生实际治疗时，同时使目标获得 2 点护盾。",
  },
  siegebreaker: {
    id: "siegebreaker",
    name: "破城",
    role: "破盾强攻",
    description: "直接攻击拥有护盾的目标时，伤害 +1。",
  },
  firehunt: {
    id: "firehunt",
    name: "猎火",
    role: "灼烧追击",
    description: "直接攻击处于灼烧状态的目标时，伤害 +2。",
  },
};

export const CARD_CATALOG: Record<string, BattleCard> = {
  sever: {
    id: "sever",
    name: "锋击",
    kind: "attack",
    symbol: "╱",
    description: "对一名敌方造成 5 点伤害，可被卸力",
    target: "enemy",
    tone: "#cc5f4a",
    cost: 1,
    respondable: true,
    effects: [{ kind: "damage", amount: 5, target: "chosen" }],
  },
  plate: {
    id: "plate",
    name: "护阵",
    kind: "guard",
    symbol: "◇",
    description: "使一名友方获得 4 点护盾",
    target: "ally",
    tone: "#477a80",
    cost: 1,
    effects: [{ kind: "block", amount: 4, target: "chosen" }],
  },
  rekindle: {
    id: "rekindle",
    name: "援护",
    kind: "restore",
    symbol: "✦",
    description: "恢复 3 点生命；每名队友每局首次退场可被援护归队",
    target: "ally",
    tone: "#bc8744",
    cost: 1,
    canTargetDefeatedAllies: true,
    effects: [{ kind: "heal", amount: 3, target: "chosen", canRevive: true }],
  },
  fracture: {
    id: "fracture",
    name: "破阵",
    kind: "tactic",
    symbol: "⌁",
    description: "造成 2 点伤害，并施加破绽",
    target: "enemy",
    tone: "#a97752",
    cost: 1,
    effects: [
      { kind: "damage", amount: 2, target: "chosen" },
      { kind: "apply-status", status: "exposed", target: "chosen" },
    ],
  },
  cinder: {
    id: "cinder",
    name: "引燃",
    kind: "tactic",
    symbol: "△",
    description: "造成 1 点伤害，并施加两回合灼烧",
    target: "enemy",
    tone: "#be4e3e",
    cost: 1,
    effects: [
      { kind: "damage", amount: 1, target: "chosen" },
      { kind: "apply-status", status: "burning", duration: 2, target: "chosen" },
    ],
  },
  temper: {
    id: "temper",
    name: "蓄锋",
    kind: "guard",
    symbol: "⬡",
    description: "自己获得 3 点护盾与蓄势",
    target: "self",
    tone: "#39767a",
    cost: 1,
    effects: [
      { kind: "block", amount: 3, target: "self" },
      { kind: "apply-status", status: "tempered", target: "self" },
    ],
  },
  refine: {
    id: "refine",
    name: "净化",
    kind: "restore",
    symbol: "◌",
    description: "恢复 2 点生命，并移除破绽与灼烧",
    target: "ally",
    tone: "#7a966f",
    cost: 1,
    effects: [
      { kind: "heal", amount: 2, target: "chosen" },
      { kind: "cleanse", statuses: ["exposed", "burning"], target: "chosen" },
    ],
  },
  siphon: {
    id: "siphon",
    name: "夺势",
    kind: "attack",
    symbol: "⊘",
    description: "造成 4 点伤害，并恢复自身 2 点生命；可被卸力",
    target: "enemy",
    tone: "#8d4b63",
    cost: 2,
    respondable: true,
    effects: [
      { kind: "damage", amount: 4, target: "chosen" },
      { kind: "heal", amount: 2, target: "self" },
    ],
  },
  aegis: {
    id: "aegis",
    name: "守护",
    kind: "guard",
    symbol: "⌂",
    description: "使一名友方获得 3 点护盾，并移除其破绽",
    target: "ally",
    tone: "#3f6f86",
    cost: 1,
    effects: [
      { kind: "block", amount: 3, target: "chosen" },
      { kind: "cleanse", statuses: ["exposed"], target: "chosen" },
    ],
  },
  emberwind: {
    id: "emberwind",
    name: "焰袭",
    kind: "tactic",
    symbol: "≈",
    description: "造成 2 点伤害，并施加一回合灼烧",
    target: "enemy",
    tone: "#c25a3c",
    cost: 1,
    effects: [
      { kind: "damage", amount: 2, target: "chosen" },
      { kind: "apply-status", status: "burning", duration: 1, target: "chosen" },
    ],
  },
  rally: {
    id: "rally",
    name: "协战",
    kind: "tactic",
    symbol: "◈",
    description: "使一名友方获得 2 点护盾与蓄势",
    target: "ally",
    tone: "#5b8a72",
    cost: 1,
    effects: [
      { kind: "block", amount: 2, target: "chosen" },
      { kind: "apply-status", status: "tempered", target: "chosen" },
    ],
  },
  deflect: {
    id: "deflect",
    name: "卸力",
    kind: "guard",
    symbol: "◒",
    description: "主动使用获得 2 点护盾；响应锋击时减免 4 点伤害",
    target: "self",
    tone: "#4f8588",
    cost: 1,
    responsePower: 4,
    effects: [{ kind: "block", amount: 2, target: "self" }],
  },
};

// 每套牌 18 张，采用相近的攻防/救援骨架，再用少量特色牌强化角色定位。
// 这能避免旧版两阵营基础伤害相差一倍以上的结构性失衡。
const DECK_RECIPES: Record<string, readonly string[]> = {
  player: [
    "sever", "sever", "sever", "sever",
    "plate", "plate", "plate", "rekindle", "rekindle",
    "fracture", "fracture", "temper", "temper",
    "aegis", "rally", "rally", "deflect", "deflect",
  ],
  luna: [
    "sever", "sever", "sever", "plate", "plate", "plate",
    "rekindle", "rekindle", "rekindle", "rekindle",
    "fracture", "fracture", "refine", "refine",
    "rally", "aegis", "deflect", "deflect",
  ],
  scar: [
    "sever", "sever", "sever", "sever", "plate", "plate",
    "rekindle", "rekindle",
    "fracture", "fracture", "fracture",
    "siphon", "siphon", "temper", "temper", "aegis",
    "deflect", "deflect",
  ],
  ember: [
    "sever", "sever", "sever", "sever", "plate", "plate",
    "rekindle", "rekindle", "fracture", "fracture",
    "cinder", "cinder", "emberwind", "emberwind",
    "temper", "rally", "deflect", "deflect",
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
  Omit<Combatant, "hp" | "reviveAvailable" | "block" | "statuses" | "hand" | "deck" | "discard">
> = [
  {
    id: "player",
    // 四人都有本名：出战角色可选之后，「你」不再固定属于这个座位。
    displayName: "初焰",
    controller: "human",
    title: "守炉前锋",
    monogram: "焰",
    team: "dawn",
    passiveId: "furnace-heart",
    maxHp: 19,
  },
  {
    id: "luna",
    displayName: "弦月",
    controller: "ai",
    title: "巡火医师",
    monogram: "弦",
    team: "dawn",
    passiveId: "afterglow",
    maxHp: 17,
  },
  {
    id: "scar",
    displayName: "铸痕",
    controller: "ai",
    title: "逐光破阵者",
    monogram: "痕",
    team: "dusk",
    passiveId: "siegebreaker",
    maxHp: 19,
  },
  {
    id: "ember",
    displayName: "余烬",
    controller: "ai",
    title: "荒野游骑",
    monogram: "烬",
    team: "dusk",
    passiveId: "firehunt",
    maxHp: 17,
  },
];
