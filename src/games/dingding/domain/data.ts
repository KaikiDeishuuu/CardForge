import type { DingCard, IdentityId, MatchWinner, PlayerId } from "./types";

export const IDENTITY_NAMES: Readonly<Record<IdentityId, string>> = {
  lord: "主君",
  loyalist: "辅臣",
  rebel: "叛锋",
  renegade: "流谋",
};

export const WINNER_COPY: Readonly<Record<MatchWinner, { title: string; detail: string }>> = {
  "lord-side": { title: "主君与辅臣守住鼎局", detail: "叛锋与流谋都已退场。" },
  rebel: { title: "叛锋掀翻了主君", detail: "主君倒下，叛锋达成目的。" },
  renegade: { title: "流谋独掌大鼎", detail: "主君倒下时，只剩流谋一人存活。" },
};

export const SEAT_ORDER: readonly PlayerId[] = ["south", "east", "north", "west"];

export const CARD_CATALOG: Readonly<Record<string, DingCard>> = {
  strike: {
    id: "strike",
    name: "刺击",
    kind: "basic",
    type: "strike",
    symbol: "╱",
    tone: "#c85a4a",
    description: "出牌阶段对攻击范围内的一名其他角色使用，目标可打出「闪避」抵消，否则受到 1 点伤害。每回合限用一次。",
  },
  evade: {
    id: "evade",
    name: "闪避",
    kind: "basic",
    type: "evade",
    symbol: "◌",
    tone: "#4f8588",
    description: "响应「刺击」时使用，抵消其造成的伤害。",
  },
  salve: {
    id: "salve",
    name: "疗元",
    kind: "basic",
    type: "salve",
    symbol: "✦",
    tone: "#bc8744",
    description: "出牌阶段对受伤的自己使用，回复 1 点体力；也可以在其他角色濒死时对其使用。",
  },
  focus: {
    id: "focus",
    name: "聚势",
    kind: "trick",
    type: "focus",
    symbol: "＋",
    tone: "#5b8a72",
    description: "出牌阶段对自己使用，摸两张牌。",
  },
  dismantle: {
    id: "dismantle",
    name: "拆解",
    kind: "trick",
    type: "dismantle",
    symbol: "⌁",
    tone: "#a97752",
    description: "出牌阶段对一名其他角色使用，目标随机弃置一张手牌。",
  },
  snatch: {
    id: "snatch",
    name: "牵袭",
    kind: "trick",
    type: "snatch",
    symbol: "↯",
    tone: "#8d4b63",
    description: "出牌阶段对距离 1 的一名其他角色使用，随机获得其一张手牌。",
  },
  nullify: {
    id: "nullify",
    name: "无懈可击",
    kind: "trick",
    type: "nullify",
    symbol: "⊕",
    tone: "#6b5b8e",
    description: "响应一张锦囊牌时使用，抵消其效果；「无懈可击」本身也可以被另一张「无懈可击」反制。",
  },
  longblade: {
    id: "longblade",
    name: "长锋",
    kind: "equipment",
    type: "weapon",
    symbol: "⾧",
    tone: "#8a7a50",
    range: 2,
    description: "武器：你的攻击范围变为 2。",
  },
  repeater: {
    id: "repeater",
    name: "连机弩",
    kind: "equipment",
    type: "weapon",
    symbol: "串",
    tone: "#9b6a4a",
    range: 1,
    unlimitedStrikes: true,
    description: "武器：你的攻击范围变为 1，但出牌阶段使用「刺击」没有次数限制。",
  },
  swift: {
    id: "swift",
    name: "赤影",
    kind: "equipment",
    type: "minus-horse",
    symbol: "驰",
    tone: "#b0523e",
    description: "坐骑：你计算与其他角色的距离时 -1。",
  },
  bulwark: {
    id: "bulwark",
    name: "磐影",
    kind: "equipment",
    type: "plus-horse",
    symbol: "垒",
    tone: "#4e7580",
    description: "坐骑：其他角色计算与你的距离时 +1。",
  },
};

/**
 * M1 牌堆：基础牌之外加入即时锦囊与三张「无懈可击」。
 * 后续里程碑再加入决斗、群体锦囊与延时锦囊。
 */
const DECK_RECIPE: readonly (keyof typeof CARD_CATALOG)[] = [
  "strike", "strike", "strike", "strike", "strike",
  "strike", "strike", "strike", "strike", "strike",
  "strike", "strike", "strike", "strike", "strike",
  "strike", "strike", "strike", "strike", "strike",
  "evade", "evade", "evade", "evade", "evade",
  "evade", "evade", "evade", "evade", "evade",
  "evade", "evade", "evade", "evade",
  "salve", "salve", "salve", "salve", "salve", "salve", "salve", "salve",
  "focus", "focus", "focus",
  "dismantle", "dismantle", "dismantle", "dismantle",
  "snatch", "snatch", "snatch", "snatch",
  "nullify", "nullify", "nullify",
  "longblade", "longblade",
  "repeater", "repeater",
  "swift", "swift",
  "bulwark", "bulwark",
];

export function buildDeck(): DingCard[] {
  return DECK_RECIPE.map((type, index) => {
    const card = CARD_CATALOG[type];
    return { ...card, id: `${type}-${index}` };
  });
}
