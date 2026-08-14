export type ControllerKind = "human" | "ai" | "remote";

export interface ParticipantIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly controller: ControllerKind;
}

export interface CardIdentity {
  readonly id: string;
  readonly name: string;
}

export interface GameSnapshot<TState = unknown> {
  readonly gameId: string;
  readonly revision: number;
  readonly data: TState;
}
