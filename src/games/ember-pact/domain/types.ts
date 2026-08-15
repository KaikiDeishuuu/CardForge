import type { CardIdentity, ParticipantIdentity } from "../../../shared/types/game";

export type TeamId = "dawn" | "dusk";
export type MatchWinner = TeamId | "draw";
export type Difficulty = "novice" | "standard" | "tactician";
export type CardKind = "attack" | "guard" | "restore" | "tactic";
export type TargetRule = "enemy" | "ally" | "self";
export type EffectTarget = "chosen" | "self";
export type StatusId = "exposed" | "burning" | "tempered";
export type PassiveId = "furnace-heart" | "afterglow" | "siegebreaker" | "firehunt";
export type TurnPhase = "action" | "response";

export type CardEffect =
  | { readonly kind: "damage"; readonly amount: number; readonly target: EffectTarget }
  | { readonly kind: "block"; readonly amount: number; readonly target: EffectTarget }
  | { readonly kind: "heal"; readonly amount: number; readonly target: EffectTarget; readonly canRevive?: boolean }
  | { readonly kind: "apply-status"; readonly status: StatusId; readonly target: EffectTarget; readonly duration?: number }
  | { readonly kind: "cleanse"; readonly statuses: readonly StatusId[]; readonly target: EffectTarget };

export interface BattleCard extends CardIdentity {
  readonly kind: CardKind;
  readonly symbol: string;
  readonly description: string;
  readonly target: TargetRule;
  readonly tone: string;
  readonly cost: 1 | 2;
  readonly canTargetDefeatedAllies?: boolean;
  readonly respondable?: boolean;
  readonly responsePower?: number;
  readonly effects: readonly CardEffect[];
}

export interface StatusDefinition {
  readonly id: StatusId;
  readonly name: string;
  readonly symbol: string;
  readonly description: string;
  readonly tone: string;
  readonly harmful: boolean;
}

export interface PassiveDefinition {
  readonly id: PassiveId;
  readonly name: string;
  readonly role: string;
  readonly description: string;
}

export interface StatusInstance {
  readonly id: StatusId;
  readonly remainingTurns?: number;
  readonly sourceActorId?: string;
}

export interface CardInstance {
  readonly uid: string;
  readonly definitionId: string;
}

export interface Combatant extends ParticipantIdentity {
  readonly title: string;
  readonly monogram: string;
  readonly team: TeamId;
  readonly passiveId: PassiveId;
  readonly hp: number;
  readonly maxHp: number;
  readonly reviveAvailable: boolean;
  readonly block: number;
  readonly statuses: readonly StatusInstance[];
  readonly hand: readonly CardInstance[];
  readonly deck: readonly CardInstance[];
  readonly discard: readonly CardInstance[];
}

export interface CombatantMetrics {
  readonly cardsPlayed: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly healingDone: number;
  readonly blockGranted: number;
  readonly combos: number;
  readonly defeats: number;
  readonly responses: number;
  readonly biggestHit: number;
}

export interface BattleLogEntry {
  readonly id: number;
  readonly text: string;
}

export type ResolvedEventKind =
  | "damage"
  | "block"
  | "heal"
  | "revive"
  | "response"
  | "status-applied"
  | "status-removed"
  | "defeated"
  | "card-overflow"
  | "overheat";

export interface ResolvedEvent {
  readonly kind: ResolvedEventKind;
  readonly targetId: string;
  readonly actorId?: string;
  readonly source: "card" | "passive" | "response" | "status" | "system";
  readonly amount?: number;
  readonly absorbed?: number;
  readonly prevented?: number;
  readonly statusId?: StatusId;
  readonly combo?: boolean;
  readonly text: string;
}

export interface LastAction {
  readonly revision: number;
  readonly actorId: string;
  readonly cardId?: string;
  readonly events: readonly ResolvedEvent[];
  readonly summary: string;
}

export interface PendingAttack {
  readonly actorId: string;
  readonly targetId: string;
  readonly cardUid: string;
  readonly definitionId: string;
  readonly header: string;
}

export interface EmberPactState {
  readonly revision: number;
  readonly turnNumber: number;
  readonly roundNumber: number;
  readonly activePlayerId: string;
  readonly actionsRemaining: number;
  readonly attackUsed: boolean;
  readonly phase: TurnPhase;
  readonly pendingAttack?: PendingAttack;
  readonly difficulty: Difficulty;
  readonly combatants: readonly Combatant[];
  readonly metrics: Readonly<Record<string, CombatantMetrics>>;
  readonly status: "playing" | "finished";
  readonly winner?: MatchWinner;
  readonly log: readonly BattleLogEntry[];
  readonly lastAction?: LastAction;
  /** Advances every time an exhausted deck is reshuffled, keeping the engine pure. */
  readonly rngSeed: number;
}

export interface AiMove {
  readonly kind: "card";
  readonly cardUid: string;
  readonly targetId: string;
}
