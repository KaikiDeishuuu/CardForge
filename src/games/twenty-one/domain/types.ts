import type { CardIdentity } from "../../../shared/types/game";

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export type DeckCount = 1 | 2 | 6 | 8;
export type DealerSoft17Rule = "stand" | "hit";
export type BlackjackPayout = "3:2" | "6:5";
export type MaxPlayerHands = 1 | 2 | 3 | 4;

export type TwentyOnePhase = "betting" | "insurance" | "player-turn" | "dealer-turn" | "settled";
export type TwentyOneOutcome = "player" | "dealer" | "push";
export type PlayerHandStatus = "playing" | "stood" | "busted" | "surrendered";
export type HandOutcome = "win" | "loss" | "push" | "blackjack" | "surrender";
export type InsuranceStatus = "not-offered" | "offered" | "declined" | "won" | "lost";

export interface PlayingCard extends CardIdentity {
  readonly suit: Suit;
  readonly rank: Rank;
}

export interface HandValue {
  readonly total: number;
  readonly soft: boolean;
  /** 仅表示两张牌合计 21；是否为可获 Blackjack 赔率的 natural 还要排除分牌手。 */
  readonly blackjack: boolean;
  readonly busted: boolean;
}

export interface TwentyOneRules {
  readonly deckCount: DeckCount;
  readonly dealerSoft17: DealerSoft17Rule;
  readonly blackjackPayout: BlackjackPayout;
  /** 同时存在的最大玩家手数；1 表示不允许分牌。 */
  readonly maxPlayerHands: MaxPlayerHands;
  readonly doubleAfterSplit: boolean;
  readonly resplitAces: boolean;
  readonly hitSplitAces: boolean;
  readonly allowInsurance: boolean;
  readonly allowLateSurrender: boolean;
}

export interface PlayerHandState {
  readonly id: string;
  readonly cards: readonly PlayingCard[];
  /** 该手已托管的完整主注；加倍后为原注的两倍。 */
  readonly wager: number;
  readonly status: PlayerHandStatus;
  readonly fromSplit: boolean;
  /** 该手由一对 A 分出，用于限制补牌。 */
  readonly splitAces: boolean;
  readonly doubled: boolean;
}

export interface InsuranceState {
  readonly status: InsuranceStatus;
  readonly wager: number;
}

export interface HandSettlement {
  readonly handId: string;
  readonly outcome: HandOutcome;
  readonly wager: number;
  /** 连本带利退回的筹码。 */
  readonly returned: number;
  /** 相对该手下注的净输赢。 */
  readonly net: number;
  readonly reason: string;
}

export interface InsuranceSettlement {
  readonly status: Exclude<InsuranceStatus, "offered">;
  readonly wager: number;
  readonly returned: number;
  readonly net: number;
}

/**
 * 一轮唯一、完整的结算事实。长期统计或挑战会话只消费这个对象，
 * 不从 UI 文案、音效或 React effect 推断结果。
 */
export interface TwentyOneSettlement {
  readonly outcome: TwentyOneOutcome;
  readonly handResults: readonly HandSettlement[];
  readonly insurance: InsuranceSettlement;
  readonly totalWagered: number;
  readonly returned: number;
  readonly net: number;
  readonly reason: string;
}

export interface TableEvent {
  readonly id: number;
  readonly actor: "player" | "dealer" | "table";
  readonly type:
    | "deal"
    | "hit"
    | "stand"
    | "reveal"
    | "settle"
    | "bet"
    | "double"
    | "split"
    | "insurance"
    | "surrender"
    | "rules";
  readonly handId?: string;
  readonly card?: PlayingCard;
  readonly text: string;
}

export interface TwentyOneState {
  readonly revision: number;
  readonly phase: TwentyOnePhase;
  readonly rules: TwentyOneRules;
  readonly deck: readonly PlayingCard[];
  readonly dealerHand: readonly PlayingCard[];
  readonly dealerRevealed: boolean;
  readonly hands: readonly PlayerHandState[];
  readonly activeHandIndex: number | null;
  /** 初始主注，用于保险上限；各分牌手的真实下注看 hand.wager。 */
  readonly baseBet: number;
  readonly insurance: InsuranceState;
  readonly settlement?: TwentyOneSettlement;
  /** 未被主注、分牌、加倍或保险托管的余额。 */
  readonly chips: number;
  readonly handNumber: number;
  readonly log: readonly TableEvent[];
  readonly lastEvent?: TableEvent;
}

export type TwentyOneAction =
  | { readonly type: "place-bet"; readonly amount: number }
  | { readonly type: "take-insurance" }
  | { readonly type: "decline-insurance" }
  | { readonly type: "hit" }
  | { readonly type: "stand" }
  | { readonly type: "double" }
  | { readonly type: "split" }
  | { readonly type: "surrender" }
  | { readonly type: "dealer-step" }
  | { readonly type: "next-hand" }
  | { readonly type: "configure-rules"; readonly rules: TwentyOneRules };

export interface TwentyOneLegalActions {
  readonly bets: readonly number[];
  readonly takeInsurance: boolean;
  readonly declineInsurance: boolean;
  readonly hit: boolean;
  readonly stand: boolean;
  readonly double: boolean;
  readonly split: boolean;
  readonly surrender: boolean;
  readonly dealerStep: boolean;
  readonly nextHand: boolean;
  readonly configureRules: boolean;
}
