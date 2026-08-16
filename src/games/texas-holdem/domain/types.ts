import type { CardIdentity, ControllerKind } from "../../../shared/types/game";

export type TexasSuit = "spades" | "hearts" | "diamonds" | "clubs";
export type TexasRank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";
export type TexasPlayerId = "human" | "east";
export type TexasStreet = "preflop" | "flop" | "turn" | "river" | "showdown";
export type BotStyle = "careful" | "steady" | "bold";

export interface TexasCard extends CardIdentity {
  readonly suit: TexasSuit;
  readonly rank: TexasRank;
}

export interface TexasPlayer {
  readonly id: TexasPlayerId;
  readonly displayName: string;
  readonly controller: ControllerKind;
  readonly seat: number;
  readonly botStyle?: BotStyle;
  readonly stack: number;
  readonly hole: readonly TexasCard[];
  readonly folded: boolean;
  readonly allIn: boolean;
  readonly acted: boolean;
  readonly streetCommitted: number;
  readonly totalCommitted: number;
}

export type TexasActionKind = "deal" | "fold" | "check" | "call" | "raise" | "street" | "showdown" | "award";

export interface TexasLogEntry {
  readonly id: number;
  readonly actorId: TexasPlayerId | "table";
  readonly kind: TexasActionKind;
  readonly text: string;
}

export type HandCategory =
  | "high-card"
  | "pair"
  | "two-pair"
  | "three-kind"
  | "straight"
  | "flush"
  | "full-house"
  | "four-kind"
  | "straight-flush";

export interface EvaluatedHand {
  readonly category: HandCategory;
  readonly label: string;
  readonly tiebreak: readonly number[];
  readonly bestFive: readonly TexasCard[];
}

export interface TexasPotResult {
  readonly amount: number;
  readonly eligiblePlayerIds: readonly TexasPlayerId[];
  readonly winnerIds: readonly TexasPlayerId[];
}

export interface TexasHandResult {
  readonly reason: "fold" | "showdown";
  readonly pots: readonly TexasPotResult[];
  readonly winnerIds: readonly TexasPlayerId[];
  readonly hands: Readonly<Partial<Record<TexasPlayerId, EvaluatedHand>>>;
  readonly summary: string;
}

export interface TexasState {
  readonly revision: number;
  readonly status: "playing" | "settled";
  readonly street: TexasStreet;
  readonly handNumber: number;
  readonly dealerIndex: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  /** Chips in play for this hand, captured after any automatic reloads. */
  readonly tableChipTotal: number;
  readonly deck: readonly TexasCard[];
  /** Burn cards stay in engine state for exact deck accounting, never in AI observations. */
  readonly burned: readonly TexasCard[];
  readonly board: readonly TexasCard[];
  readonly players: readonly TexasPlayer[];
  readonly activePlayerId?: TexasPlayerId;
  readonly currentBet: number;
  readonly lastFullRaise: number;
  readonly result?: TexasHandResult;
  readonly log: readonly TexasLogEntry[];
  readonly lastAction?: TexasLogEntry;
}

export type TexasPlayerAction =
  | { readonly type: "fold" }
  | { readonly type: "check" }
  | { readonly type: "call" }
  | { readonly type: "raise"; readonly to: number };

export interface TexasLegalActions {
  readonly fold: boolean;
  readonly check: boolean;
  readonly callAmount: number;
  readonly minRaiseTo?: number;
  readonly maxRaiseTo: number;
  readonly raisePresets: readonly number[];
}
