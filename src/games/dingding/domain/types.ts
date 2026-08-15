import type { CardIdentity, ControllerKind, ParticipantIdentity } from "../../../shared/types/game";

export type IdentityId = "lord" | "loyalist" | "rebel" | "renegade";
export type MatchWinner = "lord-side" | "rebel" | "renegade";
export type DingPhase = "prepare" | "draw" | "play" | "discard" | "finished";
export type DingCardKind = "basic" | "trick" | "equipment";
export type DingCardType =
  | "strike"
  | "evade"
  | "salve"
  | "focus"
  | "dismantle"
  | "snatch"
  | "weapon"
  | "minus-horse"
  | "plus-horse";
export type EquipmentSlot = "weapon" | "minusHorse" | "plusHorse";
export type PlayerId = "south" | "east" | "north" | "west";

export interface DingCard extends CardIdentity {
  readonly kind: DingCardKind;
  readonly type: DingCardType;
  readonly symbol: string;
  readonly tone: string;
  readonly description: string;
  readonly range?: number;
  readonly unlimitedStrikes?: boolean;
}

export interface DingPlayer extends ParticipantIdentity {
  readonly id: PlayerId;
  readonly controller: ControllerKind;
  readonly seat: number;
  readonly identity: IdentityId;
  readonly revealed: boolean;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly hand: readonly DingCard[];
  readonly equipment: Readonly<Partial<Record<EquipmentSlot, DingCard>>>;
}

export interface PendingStrike {
  readonly kind: "strike";
  readonly actorId: PlayerId;
  readonly targetId: PlayerId;
  readonly cardUid: string;
  readonly damage: number;
}

export interface PendingDying {
  readonly kind: "dying";
  readonly targetId: PlayerId;
  /** 需要回复到 1 点的疗元数量。 */
  readonly required: number;
  readonly offered: number;
  readonly responders: readonly PlayerId[];
  readonly cursor: number;
  /** 造成本次濒死的角色，用于死亡奖惩。 */
  readonly sourceId?: PlayerId;
}

export type PendingAction = PendingStrike | PendingDying;

export interface DingLogEntry {
  readonly id: number;
  readonly text: string;
}

export interface LastDingAction {
  readonly revision: number;
  readonly actorId: PlayerId | "table";
  readonly text: string;
  readonly cardIds?: readonly string[];
}

export interface DingState {
  readonly revision: number;
  readonly status: "playing" | "finished";
  readonly winner?: MatchWinner;
  readonly phase: DingPhase;
  readonly turnNumber: number;
  readonly activePlayerId: PlayerId;
  readonly players: readonly DingPlayer[];
  readonly deck: readonly DingCard[];
  readonly discard: readonly DingCard[];
  readonly strikeUsed: boolean;
  readonly pending?: PendingAction;
  readonly lastAction?: LastDingAction;
  readonly log: readonly DingLogEntry[];
  /** Advances every time an exhausted deck is reshuffled, keeping the engine pure. */
  readonly rngSeed: number;
}

export interface DingAiMove {
  readonly kind: "play" | "end";
  readonly cardUid?: string;
  readonly targetId?: PlayerId;
}
