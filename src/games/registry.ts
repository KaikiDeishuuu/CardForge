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
    name: "烬契",
    shortName: "烬契",
    description: "四套非对称牌组，在状态、被动与行动顺序之间找到配合。",
    genre: "2v2 阵营对战",
    players: "1 人 + 3 AI",
    sessionLength: "约 8–10 分钟",
    availability: "playable",
    accent: "#cf6049",
  },
  load: () => import("./ember-pact"),
}).register({
  manifest: {
    id: "twenty-one",
    name: "二十一刻",
    shortName: "二十一刻",
    description: "读懂手里的刻度，在欲望与克制之间停下。",
    genre: "轻量 21 点",
    players: "单人 vs 庄家",
    sessionLength: "约 2–3 分钟",
    availability: "playable",
    accent: "#a47b44",
  },
  load: () => import("./twenty-one"),
}).register({
  manifest: {
    id: "guandan",
    name: "掼蛋 · 入门局",
    shortName: "掼蛋",
    description: "双副牌四人对家，在跟牌、让牌与炸弹之间完成接力。",
    genre: "对家牌型竞技",
    players: "1 人 + 3 AI",
    sessionLength: "约 6–10 分钟",
    availability: "playable",
    accent: "#b33a37",
  },
  load: () => import("./guandan"),
});

for (const game of plannedGames) gameRegistry.register(game);
