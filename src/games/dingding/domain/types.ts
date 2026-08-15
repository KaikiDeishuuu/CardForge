import type { CardIdentity, ControllerKind, ParticipantIdentity } from "../../../shared/types/game";

export type IdentityId = "lord" | "loyalist" | "rebel" | "renegade";
export type MatchWinner = "lord-side" | "rebel" | "renegade";
export type DingPhase = "prepare" | "judge" | "draw" | "play" | "discard" | "finished";
export type DingDifficulty = "relaxed" | "standard" | "tactician";
export type DingCardKind = "basic" | "trick" | "equipment";
export type DingCardType =
  | "strike"
  | "evade"
  | "salve"
  | "focus"
  | "dismantle"
  | "snatch"
  | "nullify"
  | "duel"
  | "horde"
  | "volley"
  | "grove"
  | "aid"
  | "probe"
  | "weapon"
  | "armor"
  | "minus-horse"
  | "plus-horse"
  | "delay-play"
  | "delay-draw"
  | "delay-burn";
/** 会进入结算栈、可被「无懈可击」响应的锦囊类型。 */
export type TrickCardType = "focus" | "dismantle" | "snatch" | "nullify" | "duel" | "horde" | "volley" | "grove" | "aid" | "probe";
export type EquipmentSlot = "weapon" | "armor" | "minusHorse" | "plusHorse";
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
  /** 武将 id，索引 HERO_CATALOG；空字符串表示测试状态没有武将。 */
  readonly heroId: string;
  /** 技能触发/增益标记；回合结束时清空，`buff:next-damage-reduction`（坚壁）持续到拥有者下个回合开始。 */
  readonly skillFlags: Readonly<Record<string, boolean>>;
}

/**
 * 结算帧：栈中的一段待处理结算。
 *
 * - `strike`：刺击等待目标响应闪避；
 * - `dying`：濒死角色按座位顺序求疗元；
 * - `trick`：锦囊等待无懈可击响应；`nullify` 帧代表一张「无懈可击」本身，
 *   它可以被另一张「无懈可击」反制，形成可插入的嵌套链；
 * - `duel`：约斗双方轮流打刺击，先打不出的一方受到伤害；
 * - `horde` / `volley`：群体锦囊逐个求刺击/闪避，期间触发的濒死帧压在其上，救回后继续；
 * - `protect`：主君被刺击且未闪避时，由存活辅臣决定是否弃 1 张手牌护主；
 * - `probe`：刺探生效后，由使用者猜测目标身份。
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
  /** 由武将技能造成的必中刺击，不能被「闪避」响应。 */
  readonly unavoidable?: boolean;
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

/**
 * 可选武将技能：与锦囊/濒死一样进入结算栈，由技能拥有者选择消耗与目标，
 * 或放弃发动。多数武将各提供一个主动技。
 */
export interface PendingSkill {
  readonly kind: "skill";
  readonly ownerId: PlayerId;
  readonly skillId: string;
  readonly prompt: string;
  /** 当前可选的合法目标；至少一名，否则技能不会进入栈。 */
  readonly targetIds: readonly PlayerId[];
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

export interface DelayedTrickInstance {
  readonly card: DingCard;
  /** 延时牌的使用者，用于焚营等伤害来源。 */
  readonly sourceActorId: PlayerId;
}

export interface PendingDelayed {
  readonly kind: "delayed";
  /** 判定区所有者，也是当前回合角色。 */
  readonly ownerId: PlayerId;
  readonly cardUid: string;
  /** 延时牌的使用者，用于焚营等伤害来源。 */
  readonly sourceActorId: PlayerId;
}

export interface PendingDuel {
  readonly kind: "duel";
  /** 约斗发起者，也是无懈链结清后先出方以外的伤害判定方。 */
  readonly actorId: PlayerId;
  readonly targetId: PlayerId;
  /** 当前应当打出「刺击」的一方。 */
  readonly turnId: PlayerId;
  readonly cardUid: string;
}

export interface PendingHorde {
  readonly kind: "horde";
  /** 群体锦囊的使用者，未响应者的伤害来源。 */
  readonly actorId: PlayerId;
  readonly cardUid: string;
  /** 需要依次响应「刺击」的其他角色。 */
  readonly responders: readonly PlayerId[];
  readonly cursor: number;
}

export interface PendingVolley {
  readonly kind: "volley";
  /** 群体锦囊的使用者，未响应者的伤害来源。 */
  readonly actorId: PlayerId;
  readonly cardUid: string;
  /** 需要依次响应「闪避」的其他角色。 */
  readonly responders: readonly PlayerId[];
  readonly cursor: number;
}

/**
 * 辅臣护主决策帧：主君没有闪避刺击时压入，由存活辅臣选择
 * 弃置任意 1 张手牌抵挡 1 点伤害，或放弃（不公开身份）。
 */
/**
 * 刺探身份决策帧：刺探未被无懈抵消后，由使用者猜测目标身份。
 * 猜对会公开目标身份并摸两张牌；猜错由使用者随机弃置一张手牌。
 */
export interface PendingProbe {
  readonly kind: "probe";
  readonly actorId: PlayerId;
  readonly targetId: PlayerId;
  readonly cardUid: string;
}

export interface PendingProtect {
  readonly kind: "protect";
  /** 刺击来源，护主成功时仍作为后续伤害来源。 */
  readonly actorId: PlayerId;
  /** 受到刺击的主君。 */
  readonly targetId: PlayerId;
  /** 当前唯一可决定是否护主的存活辅臣；不能是刺击来源本人。 */
  readonly protectorId: PlayerId;
  /** 待结算的刺击牌 id。 */
  readonly cardUid: string;
  /** 原刺击伤害。 */
  readonly damage: number;
}

export type ResolutionFrame = PendingStrike | PendingDying | PendingSkill | PendingTrick | PendingDuel | PendingHorde | PendingVolley | PendingDelayed | PendingProtect | PendingProbe;

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
  readonly difficulty: DingDifficulty;
  readonly phase: DingPhase;
  readonly turnNumber: number;
  readonly activePlayerId: PlayerId;
  readonly players: readonly DingPlayer[];
  readonly deck: readonly DingCard[];
  readonly discard: readonly DingCard[];
  /** 各角色判定区中的延时锦囊；判定结算后进入弃牌堆。 */
  readonly delayedTricks: Readonly<Record<PlayerId, readonly DelayedTrickInstance[]>>;
  readonly strikeUsed: boolean;
  /** 结算栈：栈顶是当前等待响应的结算，空栈表示没有待处理结算。 */
  readonly stack: readonly ResolutionFrame[];
  readonly lastAction?: LastDingAction;
  readonly log: readonly DingLogEntry[];
  /** Advances every time an exhausted deck is reshuffled, keeping the engine pure. */
  readonly rngSeed: number;
}

export type DingAiMove =
  | { readonly kind: "play"; readonly cardUid: string; readonly targetId?: PlayerId }
  | { readonly kind: "skill"; readonly skillId: string }
  | { readonly kind: "end" };
