import { GameRegistry } from "../core/games/GameRegistry";
import type { GameRegistration } from "../core/games/types";

const plannedGames: readonly GameRegistration[] = [
  {
    manifest: {
      id: "color-current",
      name: "色流",
      shortName: "色流",
      description: "颜色与数字驱动的快速匹配",
      genre: "出牌匹配",
      players: "2–6 人",
      sessionLength: "约 8 分钟",
      availability: "planned",
      accent: "#c9654e",
    },
  },
  {
    manifest: {
      id: "deep-deck",
      name: "沉降牌库",
      shortName: "沉降牌库",
      description: "逐局构筑与未知路线",
      genre: "Roguelike",
      players: "单人",
      sessionLength: "约 25 分钟",
      availability: "planned",
      accent: "#676481",
    },
  },
];

export const gameRegistry = new GameRegistry().register({
  manifest: {
    id: "ember-pact",
    name: "争焰",
    shortName: "争焰",
    description: "选择一名执火者，与 AI 队友在四席战场中设局、支援并击溃对手。",
    genre: "四人阵营策略",
    players: "1 人 + 3 AI",
    sessionLength: "约 8–10 分钟",
    availability: "playable",
    accent: "#cf6049",
    featured: true,
    mark: "焰",
    tagline: "四席交锋，联手争焰",
  },
  load: () => import("./ember-pact"),
}).register({
  manifest: {
    id: "twenty-one",
    name: "二十一刻",
    shortName: "二十一刻",
    description: "押上筹码，读懂手里的刻度，在欲望与克制之间停下。",
    genre: "筹码 21 点",
    players: "单人 vs 庄家",
    sessionLength: "约 5–10 分钟",
    availability: "playable",
    accent: "#a47b44",
    mark: "21",
  },
  load: () => import("./twenty-one"),
}).register({
  manifest: {
    id: "guandan",
    name: "掼蛋",
    shortName: "掼蛋",
    description: "双副牌四人对家，从 2 一路打到 A 才算赢下整场。",
    genre: "对家牌型竞技",
    players: "1 人 + 3 AI",
    sessionLength: "约 20–30 分钟",
    availability: "playable",
    accent: "#b33a37",
    mark: "贯",
  },
  load: () => import("./guandan"),
}).register({
  manifest: {
    id: "dingding",
    name: "定鼎",
    shortName: "定鼎",
    description: "四席暗藏身份：主君、辅臣、叛锋与流谋围绕一张牌桌互相试探。",
    genre: "身份阵营",
    players: "1 人 + 3 AI",
    sessionLength: "约 15–25 分钟",
    availability: "playable",
    accent: "#c8a15a",
    mark: "鼎",
    tagline: "四席暗局，先明主君，再定鼎",
  },
  load: () => import("./dingding"),
});

for (const game of plannedGames) gameRegistry.register(game);
