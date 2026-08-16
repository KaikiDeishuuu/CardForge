import type { TexasCard, TexasRank, TexasSuit } from "./types";

export const TEXAS_SUITS: readonly TexasSuit[] = ["spades", "hearts", "diamonds", "clubs"];
export const TEXAS_RANKS: readonly TexasRank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

const SUIT_NAMES: Readonly<Record<TexasSuit, string>> = {
  spades: "黑桃",
  hearts: "红心",
  diamonds: "方片",
  clubs: "梅花",
};

export function createTexasDeck(): TexasCard[] {
  return TEXAS_SUITS.flatMap((suit) => TEXAS_RANKS.map((rank) => ({
    id: `${suit}-${rank}`,
    name: `${SUIT_NAMES[suit]} ${rank}`,
    suit,
    rank,
  })));
}

export function shuffleTexasDeck(
  cards: readonly TexasCard[] = createTexasDeck(),
  random: () => number = Math.random,
): TexasCard[] {
  const result = [...cards];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function texasRankValue(rank: TexasRank): number {
  if (rank === "A") return 14;
  if (rank === "K") return 13;
  if (rank === "Q") return 12;
  if (rank === "J") return 11;
  return Number(rank);
}
