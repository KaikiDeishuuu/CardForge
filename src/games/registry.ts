import { GameRegistry } from "../core/games/GameRegistry";
import type { GameRegistration } from "../core/games/types";

const plannedGames: readonly GameRegistration[] = [
  {
    manifest: {
      id: "trick-table",
      name: "搭档牌桌",
      shortName: "搭档牌桌",
      description: "合作、叫牌与不完全信息",
      genre: "搭档竞技",
      players: "3–4 人",
      sessionLength: "约 12 分钟",
      availability: "planned",
      accent: "#557681",
    },
  },
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
      id: "twenty-one",
      name: "二十一刻",
      shortName: "二十一刻",
      description: "风险判断与桌面概率",
      genre: "点数博弈",
      players: "1–5 人",
      sessionLength: "约 5 分钟",
      availability: "planned",
      accent: "#a47b44",
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
});

for (const game of plannedGames) gameRegistry.register(game);
