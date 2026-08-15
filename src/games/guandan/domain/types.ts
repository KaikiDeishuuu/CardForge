import type { CardIdentity, ControllerKind } from "../../../shared/types/game";

export type Suit = "spades" | "hearts" | "diamonds" | "clubs" | "joker";
export type NumberRank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";
export type CardRank = NumberRank | "small-joker" | "big-joker";
export type PlayerId = "human" | "east" | "partner" | "west";
export type TeamId = "vermillion" | "indigo";
export type ComboType = "single" | "pair" | "triple" | "full-house" | "straight" | "bomb";
export type GuandanDifficulty = "relaxed" | "standard" | "tactician";

export interface GuandanCard extends CardIdentity {
  readonly suit: Suit;
  readonly rank: CardRank;
  readonly deckIndex: 0 | 1;
}

export interface GuandanPlayer {
  readonly id: PlayerId;
  readonly displayName: string;
  readonly controller: ControllerKind;
  readonly team: TeamId;
  readonly hand: readonly GuandanCard[];
  readonly finishedPlace?: number;
}

export interface CardCombo {
  readonly type: ComboType;
  readonly label: string;
  readonly power: number;
  readonly cards: readonly GuandanCard[];
  readonly bombSize?: number;
}

export interface TrickState {
  readonly actorId: PlayerId;
  readonly combo: CardCombo;
}

export interface GuandanAction {
  readonly id: number;
  readonly actorId: PlayerId | "table";
  readonly type: "deal" | "play" | "pass" | "clear" | "finish" | "settle" | "settings";
  readonly text: string;
  readonly cards?: readonly GuandanCard[];
  readonly combo?: CardCombo;
}

/** 一局结束后的升级结算，供战报与结果弹层展示。 */
export interface DealResult {
  readonly winner: TeamId;
  /** 头游队友的名次：2 为双下，3、4 依次递减。 */
  readonly partnerPlace: number;
  readonly gained: number;
  readonly fromLevel: NumberRank;
  readonly toLevel: NumberRank;
  readonly finishOrder: readonly PlayerId[];
}

/** 跨局存在的比赛状态。刻意留在游戏层，不进入平台 Core。 */
export interface MatchState {
  readonly levels: Readonly<Record<TeamId, NumberRank>>;
  readonly dealNumber: number;
  /** 本局打谁的级：级牌取自该队当前级别。 */
  readonly attackingTeam: TeamId;
  readonly champion?: TeamId;
  readonly lastResult?: DealResult;
}

export interface GuandanState {
  readonly revision: number;
  readonly status: "playing" | "finished";
  readonly levelRank: NumberRank;
  readonly players: readonly GuandanPlayer[];
  readonly activePlayerId: PlayerId;
  readonly trick?: TrickState;
  readonly consecutivePasses: number;
  readonly finishOrder: readonly PlayerId[];
  readonly winner?: TeamId;
  readonly match: MatchState;
  readonly difficulty: GuandanDifficulty;
  readonly lastAction?: GuandanAction;
  readonly log: readonly GuandanAction[];
}

export type AiMove =
  | { readonly kind: "play"; readonly cardIds: readonly string[] }
  | { readonly kind: "pass" };
