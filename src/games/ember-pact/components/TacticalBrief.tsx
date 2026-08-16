import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Dialog } from "../../../shared/ui/GameShell";
import type { Combatant, Difficulty } from "../domain/types";
import { PASSIVE_CATALOG, STATUS_CATALOG } from "../domain/data";

const DIFFICULTY_OPTIONS: ReadonlyArray<{
  id: Difficulty;
  name: string;
  description: string;
}> = [
  { id: "novice", name: "见习", description: "AI 会在较优行动中留出失误空间。" },
  { id: "standard", name: "标准", description: "AI 稳定判断局势，并谨慎使用卸力。" },
  { id: "tactician", name: "战术", description: "AI 更会集火、铺设破绽并积极卸力。" },
];

const DIFFICULTY_IDS = DIFFICULTY_OPTIONS.map((option) => option.id);

function handleRadioKey<T extends string>(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  values: readonly T[],
  current: T,
  onChange: (value: T) => void,
) {
  const currentIndex = values.indexOf(current);
  if (currentIndex < 0) return;

  let nextIndex: number | undefined;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    nextIndex = (currentIndex + 1) % values.length;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + values.length) % values.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = values.length - 1;
  }

  if (nextIndex === undefined) return;
  event.preventDefault();
  const radios = event.currentTarget
    .closest('[role="radiogroup"]')
    ?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)');
  onChange(values[nextIndex]);
  radios?.[nextIndex]?.focus({ preventScroll: true });
}

interface TacticalBriefProps {
  combatants: readonly Combatant[];
  selectedId: string;
  selectionLocked: boolean;
  difficulty: Difficulty;
  guideEnabled: boolean;
  saveWarning?: string;
  onResetSave?: () => void;
  onSelect: (id: string) => void;
  onDifficultyChange: (difficulty: Difficulty) => void;
  onGuideChange: (enabled: boolean) => void;
  onCommit: () => void;
  onClose: () => void;
}

export function TacticalBrief({
  combatants,
  selectedId,
  selectionLocked,
  difficulty,
  guideEnabled,
  saveWarning,
  onResetSave,
  onSelect,
  onDifficultyChange,
  onGuideChange,
  onCommit,
  onClose,
}: TacticalBriefProps) {
  const chosen = combatants.find((combatant) => combatant.id === selectedId);
  const combatantIds = combatants.map((combatant) => combatant.id);

  return (
    <Dialog
      open
      title={(
        <span className="pact-dialog-title">
          <span className="ledger-seal" aria-hidden="true">谱</span>
          <span>
            <small aria-hidden="true">争焰 · 开局设置</small>
            <span>选择执火者与规则</span>
          </span>
        </span>
      )}
      className="pact-dialog pact-dialog--brief forge-ledger forge-ledger--brief"
      backdropClassName="pact-dialog-backdrop pact-dialog-backdrop--brief"
      initialFocus=".cf-dialog__header h2"
      restoreFocus=".cf-game-topbar__more"
      onClose={onClose}
      closeLabel={selectionLocked ? "关闭角色与规则" : "返回游戏大厅"}
    >

      {saveWarning && (
        <div className="pact-save-warning pact-save-warning--inline" role="alert">
          <span>{saveWarning}</span>
          {onResetSave && <button type="button" onClick={onResetSave}>重置旧存档并启用保存</button>}
        </div>
      )}

      <p className="ledger-intro">
        选择一名执火者，其余三席由 AI 接管。每席拥有两点行动力；安排攻防次序，并与队友完成配合。
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
                tabIndex={isChosen ? 0 : -1}
                className={`passive-note team-${combatant.team} ${isChosen ? "is-chosen" : ""}`}
                disabled={selectionLocked}
                onClick={() => onSelect(combatant.id)}
                onKeyDown={(event) => handleRadioKey(event, combatantIds, combatant.id, onSelect)}
              >
                <span>{combatant.monogram}</span>
                <div>
                  <small>{combatant.displayName} · {combatant.title}</small>
                  <strong>{passive.name}</strong>
                  <em className="passive-note__role">{passive.role}</em>
                  <p>{passive.description}</p>
                </div>
                {isChosen && <b className="passive-note__pick">{selectionLocked ? "本局出战" : "出战"}</b>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="ledger-section">
        <h3>对手难度</h3>
        <div className="difficulty-grid" role="radiogroup" aria-label="对手难度">
          {DIFFICULTY_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={difficulty === option.id}
              tabIndex={difficulty === option.id ? 0 : -1}
              className={difficulty === option.id ? "is-selected" : ""}
              disabled={selectionLocked}
              onClick={() => onDifficultyChange(option.id)}
              onKeyDown={(event) => handleRadioKey(event, DIFFICULTY_IDS, option.id, onDifficultyChange)}
            >
              <strong>{option.name}</strong>
              <small>{option.description}</small>
            </button>
          ))}
        </div>
        {selectionLocked && <p className="ledger-lock-note">本局难度已锁定，重新开局后可以调整。</p>}
      </div>

      <label className="guide-toggle">
        <input
          type="checkbox"
          checked={guideEnabled}
          disabled={selectionLocked}
          onChange={(event) => onGuideChange(event.target.checked)}
        />
        <span>
          <strong>显示对局引导</strong>
          <small>在选牌、选目标和卸力窗口给出简短提示，不会替你行动。</small>
        </span>
      </label>

      <div className="ledger-section">
        <h3>持续状态</h3>
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
        <span><b>抽牌</b>首席以 4 张先行；此后每席行动开始抽 2 张，手牌上限 7</span>
        <span><b>行动力</b>每席获得 2 点，卡牌消耗 1 或 2 点</span>
        <span><b>攻击</b>每席最多打出 1 张攻击牌</span>
        <span><b>护盾</b>上限 6，跨回合保留</span>
        <span><b>卸力</b>被可响应攻击命中前，可弃牌减伤</span>
        <span><b>援护</b>每名角色每局首次退场可归队一次</span>
        <span><b>过载</b>第 18 轮起压低全场生命，但不会直接令角色退场</span>
      </div>

      <div className="ledger-enter-dock">
        <button type="button" className="ledger-enter" onClick={onCommit}>
          {selectionLocked
            ? "返回争焰对局"
            : `让${chosen?.displayName ?? "初焰"}执火，开始争焰`}
        </button>
      </div>
    </Dialog>
  );
}

interface CombatantSheetProps {
  combatant: Combatant;
  onClose: () => void;
}

export function CombatantSheet({ combatant, onClose }: CombatantSheetProps) {
  const passive = PASSIVE_CATALOG[combatant.passiveId];

  return (
    <Dialog
      open
      title={(
        <span className="pact-dialog-title">
          <span className={`ledger-seal team-${combatant.team}`} aria-hidden="true">{combatant.monogram}</span>
          <span>
            <small aria-hidden="true">{combatant.title}</small>
            <span>{combatant.displayName}</span>
          </span>
        </span>
      )}
      className="pact-dialog pact-dialog--sheet forge-ledger combatant-sheet"
      backdropClassName="pact-dialog-backdrop pact-dialog-backdrop--sheet"
      initialFocus=".cf-dialog__close"
      onClose={onClose}
      closeLabel="关闭角色详情"
    >

      <div className="sheet-vitals">
        <span><small>生命</small><b>{combatant.hp} / {combatant.maxHp}</b></span>
        <span><small>护盾</small><b>{combatant.block}</b></span>
        <span><small>手牌</small><b>{combatant.hand.length}</b></span>
      </div>

      <article className="sheet-passive">
        <small>角色被动</small>
        <strong>{passive.name}</strong>
        <i>{passive.role}</i>
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
    </Dialog>
  );
}
