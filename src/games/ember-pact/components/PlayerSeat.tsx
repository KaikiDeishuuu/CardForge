import type { CSSProperties } from "react";
import { STATUS_CATALOG } from "../domain/data";
import type { Combatant, LastAction, ResolvedEvent } from "../domain/types";

interface PlayerSeatProps {
  combatant: Combatant;
  active: boolean;
  targetable: boolean;
  lastAction?: LastAction;
  revision: number;
  onTarget: (id: string) => void;
  onInspect: (id: string) => void;
}

function eventLabel(event: ResolvedEvent): string | undefined {
  if (event.kind === "damage" || event.kind === "overheat") {
    if ((event.amount ?? 0) > 0) return `−${event.amount}`;
    if ((event.absorbed ?? 0) > 0) return `盾 −${event.absorbed}`;
  }
  if (event.kind === "block") return `+${event.amount} 盾`;
  if (event.kind === "heal") return event.amount ? `+${event.amount}` : undefined;
  if (event.kind === "status-applied" && event.statusId) return `+${STATUS_CATALOG[event.statusId].name}`;
  if (event.kind === "defeated") return "退场";
  return undefined;
}

export function PlayerSeat({
  combatant,
  active,
  targetable,
  lastAction,
  revision,
  onTarget,
  onInspect,
}: PlayerSeatProps) {
  const defeated = combatant.hp <= 0;
  const healthPercent = Math.max(0, (combatant.hp / combatant.maxHp) * 100);
  const targetEvents = lastAction?.events.filter((event) => event.targetId === combatant.id) ?? [];
  const labels = targetEvents.map(eventLabel).filter((label): label is string => Boolean(label)).slice(0, 2);
  const isTarget = labels.length > 0;
  const effectTone = targetEvents.some((event) => event.kind === "damage" || event.kind === "overheat" || event.kind === "defeated")
    ? "attack"
    : targetEvents.some((event) => event.kind === "heal")
      ? "restore"
      : targetEvents.some((event) => event.kind === "block")
        ? "guard"
        : "tactic";

  return (
    <button
      type="button"
      className={`player-seat team-${combatant.team} ${active ? "is-active" : ""} ${targetable ? "is-targetable" : ""} ${defeated ? "is-defeated" : ""}`}
      onClick={() => targetable ? onTarget(combatant.id) : onInspect(combatant.id)}
      aria-label={`${combatant.displayName}，生命 ${combatant.hp}/${combatant.maxHp}${targetable ? "，可选为目标" : "，查看详情"}`}
    >
      <span className="player-seat__portrait" aria-hidden="true">
        <span>{combatant.monogram}</span>
      </span>
      <span className="player-seat__info">
        <span className="player-seat__identity">
          <span>
            <strong>{combatant.displayName}</strong>
            <small>{combatant.title}</small>
          </span>
          {combatant.controller === "ai" && <em>AI</em>}
        </span>
        <span className="health-row">
          <span className="health-track" aria-hidden="true">
            <span style={{ width: `${healthPercent}%` }} />
          </span>
          <b>{combatant.hp}/{combatant.maxHp}</b>
        </span>
        <span className="player-seat__meta">
          <span>{combatant.block > 0 ? `◇ ${combatant.block} 护盾` : "无护盾"}</span>
          <span>{combatant.hand.length} 手牌</span>
        </span>
        <span className="player-seat__statuses" aria-label={combatant.statuses.length ? "当前状态" : "无持续状态"}>
          {combatant.statuses.map((status) => {
            const definition = STATUS_CATALOG[status.id];
            return (
              <i
                key={status.id}
                title={`${definition.name}：${definition.description}`}
                style={{ "--status-tone": definition.tone } as CSSProperties}
              >
                {definition.symbol}{status.remainingTurns ? <small>{status.remainingTurns}</small> : null}
              </i>
            );
          })}
        </span>
      </span>
      {active && <span className="turn-pin">行动</span>}
      {targetable && <span className="target-pin">选择</span>}
      {isTarget && (
        <span key={`${revision}-${combatant.id}`} className={`effect-pop effect-pop--${effectTone}`}>
          {labels.join(" · ")}
        </span>
      )}
    </button>
  );
}
