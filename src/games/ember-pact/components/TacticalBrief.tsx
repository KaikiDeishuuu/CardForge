import type { CSSProperties } from "react";
import type { Combatant } from "../domain/types";
import { PASSIVE_CATALOG, STATUS_CATALOG } from "../domain/data";
import { useModalFocus } from "../../../shared/ui/useModalFocus";

interface TacticalBriefProps {
  combatants: readonly Combatant[];
  selectedId: string;
  selectionLocked: boolean;
  onSelect: (id: string) => void;
  onCommit: () => void;
  onClose: () => void;
}

export function TacticalBrief({ combatants, selectedId, selectionLocked, onSelect, onCommit, onClose }: TacticalBriefProps) {
  const modalRef = useModalFocus({ active: true, initialFocus: ".ledger-enter", onDismiss: onClose });
  const chosen = combatants.find((combatant) => combatant.id === selectedId);

  return (
    <div ref={modalRef} className="ledger-overlay" role="dialog" aria-modal="true" aria-labelledby="brief-title" tabIndex={-1}>
      <section className="forge-ledger forge-ledger--brief">
        <header className="forge-ledger__header">
          <span className="ledger-seal" aria-hidden="true">谱</span>
          <span>
            <small>战术炉谱</small>
            <h2 id="brief-title">先看炉火，再决定落牌</h2>
          </span>
          <button type="button" onClick={onClose} aria-label="关闭战术炉谱">×</button>
        </header>

        <p className="ledger-intro">
          四名角色各自携带一套牌与一项被动。选一个出战，其余三人交给 AI；每回合只能打出一张牌，状态和行动顺序比单次伤害更重要。
        </p>

        <div className="ledger-section">
          <h3>{selectionLocked ? "本局出战角色" : "选择出战角色"}</h3>
          <div
            className="passive-grid"
            role="radiogroup"
            aria-label={selectionLocked ? "本局出战角色，对局中不可更换" : "选择出战角色"}
          >
            {combatants.map((combatant) => {
              const passive = PASSIVE_CATALOG[combatant.passiveId];
              const isChosen = combatant.id === selectedId;
              return (
                <button
                  type="button"
                  key={combatant.id}
                  role="radio"
                  aria-checked={isChosen}
                  className={`passive-note team-${combatant.team} ${isChosen ? "is-chosen" : ""}`}
                  disabled={selectionLocked}
                  onClick={() => onSelect(combatant.id)}
                >
                  <span>{combatant.monogram}</span>
                  <div>
                    <small>{combatant.displayName} · {combatant.title}</small>
                    <strong>{passive.name}</strong>
                    <p>{passive.description}</p>
                  </div>
                  {isChosen && <b className="passive-note__pick">{selectionLocked ? "本局出战" : "出战"}</b>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="ledger-section">
          <h3>状态炉印</h3>
          <div className="status-glossary">
            {Object.values(STATUS_CATALOG).map((status) => (
              <article key={status.id} style={{ "--status-tone": status.tone } as CSSProperties}>
                <span>{status.symbol}</span>
                <div><strong>{status.name}</strong><p>{status.description}</p></div>
              </article>
            ))}
          </div>
        </div>

        <div className="ledger-rules">
          <span><b>护盾</b>在角色下一次行动开始时清空</span>
          <span><b>满手</b>达到 6 张后，新抽牌进入弃牌堆</span>
          <span><b>过载</b>第 13 轮起，行动结束承受递增真实伤害</span>
        </div>

        <button type="button" className="ledger-enter" onClick={onCommit}>
          {selectionLocked
            ? "返回战场"
            : `以${chosen?.displayName ?? "晨铸先锋"}的身份点亮熔炉`}
        </button>
      </section>
    </div>
  );
}

interface CombatantSheetProps {
  combatant: Combatant;
  onClose: () => void;
}

export function CombatantSheet({ combatant, onClose }: CombatantSheetProps) {
  const passive = PASSIVE_CATALOG[combatant.passiveId];
  const modalRef = useModalFocus({ active: true, initialFocus: "button", onDismiss: onClose });

  return (
    <div ref={modalRef} className="ledger-overlay ledger-overlay--sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabIndex={-1} onClick={onClose}>
      <section className="forge-ledger combatant-sheet" onClick={(event) => event.stopPropagation()}>
        <header className="forge-ledger__header">
          <span className={`ledger-seal team-${combatant.team}`} aria-hidden="true">{combatant.monogram}</span>
          <span>
            <small>{combatant.title}</small>
            <h2 id="sheet-title">{combatant.displayName}</h2>
          </span>
          <button type="button" onClick={onClose} aria-label="关闭角色详情">×</button>
        </header>

        <div className="sheet-vitals">
          <span><small>生命</small><b>{combatant.hp} / {combatant.maxHp}</b></span>
          <span><small>护盾</small><b>{combatant.block}</b></span>
          <span><small>手牌</small><b>{combatant.hand.length}</b></span>
        </div>

        <article className="sheet-passive">
          <small>角色被动</small>
          <strong>{passive.name}</strong>
          <p>{passive.description}</p>
        </article>

        <div className="sheet-statuses">
          <small>当前状态</small>
          {combatant.statuses.length === 0 ? (
            <p>没有持续状态。</p>
          ) : combatant.statuses.map((status) => {
            const definition = STATUS_CATALOG[status.id];
            return (
              <article key={status.id} style={{ "--status-tone": definition.tone } as CSSProperties}>
                <span>{definition.symbol}</span>
                <div>
                  <strong>{definition.name}{status.remainingTurns ? ` · ${status.remainingTurns} 回合` : ""}</strong>
                  <p>{definition.description}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
