import type { CardIdentity } from "../../../shared/types/game";

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export type TwentyOnePhase = "betting" | "player-turn" | "dealer-turn" | "settled";
export type TwentyOneOutcome = "player" | "dealer" | "push";

export interface PlayingCard extends CardIdentity {
  readonly suit: Suit;
  readonly rank: Rank;
}

export interface HandValue {
  readonly total: number;
  readonly soft: boolean;
  readonly blackjack: boolean;
  readonly busted: boolean;
}

export interface TableEvent {
  readonly id: number;
  readonly actor: "player" | "dealer" | "table";
  readonly type: "deal" | "hit" | "stand" | "reveal" | "settle" | "bet" | "double";
  readonly card?: PlayingCard;
  readonly text: string;
}

export interface TwentyOneState {
  readonly revision: number;
  readonly phase: TwentyOnePhase;
  readonly deck: readonly PlayingCard[];
  readonly playerHand: readonly PlayingCard[];
  readonly dealerHand: readonly PlayingCard[];
  readonly dealerRevealed: boolean;
  readonly outcome?: TwentyOneOutcome;
  readonly reason?: string;
  /** 手上剩余筹码，已扣除本手押注。 */
  readonly chips: number;
  readonly bet: number;
  readonly doubled: boolean;
  /** 本手净输赢，结算后才有值。 */
  readonly payout?: number;
  readonly handNumber: number;
  readonly log: readonly TableEvent[];
  readonly lastEvent?: TableEvent;
}
