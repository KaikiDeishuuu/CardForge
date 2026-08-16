import { getTexasLegalActions, getTexasPotSize } from "./engine";
import type {
  TexasCard,
  TexasLegalActions,
  TexasPlayerId,
  TexasState,
  TexasStreet,
} from "./types";

export interface TexasPublicPlayer {
  readonly id: TexasPlayerId;
  readonly displayName: string;
  readonly stack: number;
  readonly folded: boolean;
  readonly allIn: boolean;
  readonly streetCommitted: number;
  readonly totalCommitted: number;
}

export interface TexasObservation {
  readonly actorId: TexasPlayerId;
  readonly revision: number;
  readonly handNumber: number;
  readonly street: TexasStreet;
  readonly dealerIndex: number;
  readonly bigBlind: number;
  readonly hole: readonly TexasCard[];
  readonly board: readonly TexasCard[];
  readonly pot: number;
  readonly players: readonly TexasPublicPlayer[];
  readonly legal: TexasLegalActions;
}

/** AI 只接收自己的暗牌与公共事实，永远拿不到牌堆或对手底牌。 */
export function buildTexasObservation(state: TexasState, actorId: TexasPlayerId): TexasObservation {
  const actor = state.players.find((player) => player.id === actorId);
  if (!actor) throw new Error(`Unknown Texas player: ${actorId}`);
  return {
    actorId,
    revision: state.revision,
    handNumber: state.handNumber,
    street: state.street,
    dealerIndex: state.dealerIndex,
    bigBlind: state.bigBlind,
    hole: actor.hole,
    board: state.board,
    pot: getTexasPotSize(state),
    players: state.players.map((player) => ({
      id: player.id,
      displayName: player.displayName,
      stack: player.stack,
      folded: player.folded,
      allIn: player.allIn,
      streetCommitted: player.streetCommitted,
      totalCommitted: player.totalCommitted,
    })),
    legal: getTexasLegalActions(state, actorId),
  };
}
