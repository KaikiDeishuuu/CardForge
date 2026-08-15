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
  | "nullify"
  | "weapon"
  | "minus-horse"
  | "plus-horse";
/** 会进入结算栈、可被「无懈可击」响应的锦囊类型。 */
export type TrickCardType = "focus" | "dismantle" | "snatch" | "nullify";
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

/**
 * 结算帧：栈中的一段待处理结算。
 *
 * - `strike`：刺击等待目标响应闪避；
 * - `dying`：濒死角色按座位顺序求疗元；
 * - `trick`：锦囊等待无懈可击响应；`nullify` 帧代表一张「无懈可击」本身，
 *   它可以被另一张「无懈可击」反制，形成可插入的嵌套链。
 *
 * 栈顶（数组最后一项）是当前等待响应的结算；新帧只会压入栈顶，
 * 结算完成后从栈顶弹出，露出下一段待处理结算。
 */
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

export interface PendingTrick {
  readonly kind: "trick";
  /** 在本次牌局内唯一，无懈可击用它指向被反制的帧。 */
  readonly frameId: number;
  readonly actorId: PlayerId;
  readonly cardUid: string;
  readonly cardType: TrickCardType;
  /** 拆解/牵袭的效果目标。 */
  readonly targetId?: PlayerId;
  /** 仅 nullify 帧：被它反制的锦囊帧 id。 */
  readonly counterFrameId?: number;
  /** 按座位顺序询问的无懈可击响应者。 */
  readonly responders: readonly PlayerId[];
  readonly cursor: number;
  /** false 表示询问被反制链挂起，轮到它时应直接结算而不再询问。 */
  readonly awaitingResponse: boolean;
  /** 被另一张无懈可击抵消的帧，结算时只弹出、不生效。 */
  readonly negated?: boolean;
}

export type ResolutionFrame = PendingStrike | PendingDying | PendingTrick;

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
  /** 结算栈：栈顶是当前等待响应的结算，空栈表示没有待处理结算。 */
  readonly stack: readonly ResolutionFrame[];
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
