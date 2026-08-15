import { ACTIONS_PER_TURN, INITIATIVE_ORDER, OVERHEAT_START_ROUND } from "../domain/engine";
import type { Combatant, TurnPhase } from "../domain/types";

export interface TurnTrackProps {
  readonly combatants: readonly Combatant[];
  readonly activePlayerId: string;
  readonly actionsRemaining: number;
  readonly roundNumber: number;
  readonly phase: TurnPhase;
  readonly summary?: string;
}

export function TurnTrack({
  combatants,
  activePlayerId,
  actionsRemaining,
  roundNumber,
  phase,
  summary,
}: TurnTrackProps) {
  const active = combatants.find((combatant) => combatant.id === activePlayerId);
  const overheat = roundNumber >= OVERHEAT_START_ROUND
    ? roundNumber - OVERHEAT_START_ROUND + 1
    : 0;
  const phaseLabel = phase === "response" ? "卸力响应" : "当前行动";
  const fallbackSummary = phase === "response"
    ? "攻击已经亮明，目标可选择卸力或承受伤害。"
    : `${active?.displayName ?? "当前角色"}还有 ${actionsRemaining} 点行动力。`;

  return (
    <section className={`turn-track ${phase === "response" ? "is-response" : ""} ${overheat > 0 ? "is-overheating" : ""}`} aria-label="四席行动顺序">
      <div className="turn-track__readout">
        <span><small>{phaseLabel}</small><strong>{active?.displayName ?? "等待行动"}</strong></span>
        <span className="turn-track__actions"><small>剩余行动力</small><strong>{actionsRemaining}<i>/{ACTIONS_PER_TURN}</i></strong></span>
      </div>

      <ol className="turn-track__order">
        {INITIATIVE_ORDER.map((id, index) => {
          const combatant = combatants.find((entry) => entry.id === id);
          const current = id === activePlayerId;
          const defeated = !combatant || combatant.hp <= 0;
          return (
            <li
              key={id}
              className={`${current ? "is-current" : ""} ${defeated ? "is-defeated" : ""}`}
              aria-current={current ? "step" : undefined}
              aria-label={`${combatant?.displayName ?? id}${combatant?.controller === "human" ? "，你" : ""}${current ? "，当前行动" : ""}${defeated ? "，已退场" : ""}`}
            >
              <span className={`turn-track__seal team-${combatant?.team ?? "dawn"}`}>{combatant?.monogram ?? "·"}</span>
              <small>{combatant?.displayName ?? id}</small>
              {combatant?.controller === "human" && <b>你</b>}
              {index < INITIATIVE_ORDER.length - 1 && <i className="turn-track__arrow" aria-hidden="true">→</i>}
            </li>
          );
        })}
      </ol>

      <div className="turn-track__footer">
        <p className="turn-track__summary" role="status" aria-live="polite">{summary ?? fallbackSummary}</p>
        <span className="turn-track__round">
          {overheat > 0 ? <><small>全场过载</small><strong>{overheat}</strong></> : <><small>轮次</small><strong>{roundNumber}</strong></>}
        </span>
      </div>
    </section>
  );
}
