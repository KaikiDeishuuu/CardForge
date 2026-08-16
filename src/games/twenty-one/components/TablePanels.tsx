import { useState } from "react";
import {
  CHALLENGES,
  RULE_PRESETS,
  STANDARD_SIX_RULES,
  identifyRulesPreset,
  type ChallengeId,
  type RulesPresetId,
  type TwentyOneRootState,
} from "../domain/session";
import type { TwentyOneRules } from "../domain/types";

type SetupChoice = "classic" | ChallengeId;
export type LedgerTab = "rules" | "house" | "archive" | "history";

const PRESET_COPY: Readonly<Record<Exclude<RulesPresetId, "custom">, { name: string; note: string }>> = {
  "standard-six": { name: "六副标准", note: "S17 · 3:2 · 最多四手" },
  "single-deck": { name: "单副牌", note: "H17 · 3:2 · 最多三手" },
  "high-pressure-eight": { name: "八副高压", note: "H17 · 6:5 · 最多两手" },
};

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function RulesSummary({ rules }: { rules: TwentyOneRules }) {
  return (
    <dl className="tw-rules-summary">
      <div><dt>牌靴</dt><dd>{rules.deckCount} 副</dd></div>
      <div><dt>庄家软 17</dt><dd>{rules.dealerSoft17 === "stand" ? "停牌" : "要牌"}</dd></div>
      <div><dt>Blackjack</dt><dd>{rules.blackjackPayout}</dd></div>
      <div><dt>分牌上限</dt><dd>{rules.maxPlayerHands === 1 ? "关闭" : `${rules.maxPlayerHands} 手`}</dd></div>
      <div><dt>分后加倍</dt><dd>{rules.doubleAfterSplit ? "允许" : "关闭"}</dd></div>
      <div><dt>保险 / 投降</dt><dd>{rules.allowInsurance ? "保险" : "无保险"} · {rules.allowLateSurrender ? "迟投降" : "无投降"}</dd></div>
    </dl>
  );
}

function RulesForm({ rules, onChange }: { rules: TwentyOneRules; onChange: (rules: TwentyOneRules) => void }) {
  const preset = identifyRulesPreset(rules);
  function patch(next: Partial<TwentyOneRules>) {
    onChange({ ...rules, ...next });
  }

  return (
    <div className="tw-rules-form">
      <div className="tw-preset-grid" role="radiogroup" aria-label="房规预设">
        {(Object.keys(RULE_PRESETS) as Exclude<RulesPresetId, "custom">[]).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={preset === id}
            className={preset === id ? "is-selected" : ""}
            onClick={() => onChange(RULE_PRESETS[id])}
          >
            <strong>{PRESET_COPY[id].name}</strong>
            <small>{PRESET_COPY[id].note}</small>
          </button>
        ))}
      </div>
      {preset === "custom" && <p className="tw-custom-note">当前为自定义房规</p>}
      <div className="tw-setting-grid">
        <label>
          <span>牌靴副数</span>
          <select value={rules.deckCount} onChange={(event) => patch({ deckCount: Number(event.target.value) as TwentyOneRules["deckCount"] })}>
            <option value={1}>1 副</option><option value={2}>2 副</option><option value={6}>6 副</option><option value={8}>8 副</option>
          </select>
        </label>
        <label>
          <span>庄家软 17</span>
          <select value={rules.dealerSoft17} onChange={(event) => patch({ dealerSoft17: event.target.value as TwentyOneRules["dealerSoft17"] })}>
            <option value="stand">停牌（S17）</option><option value="hit">要牌（H17）</option>
          </select>
        </label>
        <label>
          <span>Blackjack 赔付</span>
          <select value={rules.blackjackPayout} onChange={(event) => patch({ blackjackPayout: event.target.value as TwentyOneRules["blackjackPayout"] })}>
            <option value="3:2">3:2</option><option value="6:5">6:5</option>
          </select>
        </label>
        <label>
          <span>最多玩家手数</span>
          <select value={rules.maxPlayerHands} onChange={(event) => patch({ maxPlayerHands: Number(event.target.value) as TwentyOneRules["maxPlayerHands"] })}>
            <option value={1}>关闭分牌</option><option value={2}>2 手</option><option value={3}>3 手</option><option value={4}>4 手</option>
          </select>
        </label>
      </div>
      <details className="tw-advanced-rules">
        <summary>分牌与边注细则</summary>
        <div className="tw-toggle-list">
          <label><input type="checkbox" checked={rules.doubleAfterSplit} disabled={rules.maxPlayerHands === 1} onChange={(event) => patch({ doubleAfterSplit: event.target.checked })} /><span>分牌后允许加倍</span></label>
          <label><input type="checkbox" checked={rules.resplitAces} disabled={rules.maxPlayerHands === 1} onChange={(event) => patch({ resplitAces: event.target.checked })} /><span>允许再次分 A</span></label>
          <label><input type="checkbox" checked={rules.hitSplitAces} disabled={rules.maxPlayerHands === 1} onChange={(event) => patch({ hitSplitAces: event.target.checked })} /><span>分 A 后允许继续要牌</span></label>
          <label><input type="checkbox" checked={rules.allowInsurance} onChange={(event) => patch({ allowInsurance: event.target.checked })} /><span>庄家 A 明牌时允许保险</span></label>
          <label><input type="checkbox" checked={rules.allowLateSurrender} onChange={(event) => patch({ allowLateSurrender: event.target.checked })} /><span>允许迟投降</span></label>
        </div>
      </details>
    </div>
  );
}

interface SetupLedgerProps {
  root: TwentyOneRootState;
  onExit: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onStartClassic: (rules: TwentyOneRules, assistEnabled: boolean) => void;
  onStartChallenge: (challengeId: ChallengeId, assistEnabled: boolean) => void;
  onResetArchive: () => void;
  /** 存档无法安全读取时显示，并允许玩家显式清除旧档后重新启用保存。 */
  saveWarning?: string;
  onResetSave?: () => void;
}

export function SetupLedger({
  root,
  onExit,
  soundEnabled,
  onToggleSound,
  onStartClassic,
  onStartChallenge,
  onResetArchive,
  saveWarning,
  onResetSave,
}: SetupLedgerProps) {
  const [choice, setChoice] = useState<SetupChoice>("classic");
  const [rules, setRules] = useState(root.preferences.rules);
  const [assistEnabled, setAssistEnabled] = useState(root.preferences.assistEnabled);
  const [confirmReset, setConfirmReset] = useState(false);
  const challenge = choice === "classic" ? undefined : CHALLENGES[choice];
  const selectedPreset = identifyRulesPreset(rules);
  const selectedRulesCopy = selectedPreset === "custom"
    ? { name: "自定义房规", note: `${rules.deckCount} 副 · ${rules.dealerSoft17 === "stand" ? "S17" : "H17"} · ${rules.blackjackPayout}` }
    : PRESET_COPY[selectedPreset];

  return (
    <article className="rule-ledger setup-ledger">
      <button type="button" className="rule-ledger__close" onClick={onExit} aria-label="返回游戏大厅">×</button>
      <button type="button" className="rule-ledger__sound" onClick={onToggleSound} aria-label={soundEnabled ? "关闭声音" : "开启声音"}>{soundEnabled ? "♪" : "×"}</button>
      <div className="setup-ledger__scroll">
        <small>TABLE 002 · ENTRY</small>
        <h2 id="twenty-one-setup-title">选择玩法</h2>
        <p>经典牌桌适合连续游玩；挑战模式有明确的目标与手数上限。</p>
        <div className="tw-mode-grid" role="radiogroup" aria-label="牌局模式">
          <button type="button" role="radio" aria-checked={choice === "classic"} className={choice === "classic" ? "is-selected" : ""} onClick={() => setChoice("classic")}>
            <small>CLASSIC</small><strong>经典牌桌</strong><span>500 筹码 · 不限手数</span>
          </button>
          {(Object.values(CHALLENGES)).map((entry) => {
            const record = root.challengeRecords[entry.id];
            return (
              <button key={entry.id} type="button" role="radio" aria-checked={choice === entry.id} className={choice === entry.id ? "is-selected" : ""} onClick={() => setChoice(entry.id)}>
                <small>{entry.eyebrow}</small><strong>{entry.name}</strong><span>{entry.description}</span>
                <em className="tw-challenge-record">
                  无辅助 {record.unassisted.clears}/{record.unassisted.runs} · 辅助 {record.assisted.clears}/{record.assisted.runs}
                  {record.unassisted.bestFinalChips !== undefined && <i>最佳 {record.unassisted.bestFinalChips}</i>}
                </em>
              </button>
            );
          })}
        </div>

        <section className="tw-setup-detail">
          <h3>{challenge ? "挑战条件" : "经典房规"}</h3>
          {challenge ? (
            <>
              <div className="tw-challenge-goal"><strong>{challenge.targetChips}</strong><span>目标筹码</span><i>{challenge.roundLimit} 手上限</i></div>
              <RulesSummary rules={STANDARD_SIX_RULES} />
            </>
          ) : (
            <details className="tw-classic-rules">
              <summary>
                <span><strong>{selectedRulesCopy.name}</strong><small>{selectedRulesCopy.note}</small></span>
                <b>调整房规</b>
              </summary>
              <RulesForm rules={rules} onChange={setRules} />
            </details>
          )}
        </section>

        <label className="tw-assist-toggle">
          <input type="checkbox" checked={assistEnabled} onChange={(event) => setAssistEnabled(event.target.checked)} />
          <span><strong>可选策略提示</strong><small>只高亮建议，不会替你行动；挑战会标记辅助记录。</small></span>
        </label>
        <div className="tw-setup-archive">
          <span>本机档案 · {root.lifetimeStats.roundsPlayed} 局</span>
          {confirmReset ? (
            <span className="tw-confirm-row">
              <button type="button" onClick={() => { onResetArchive(); setConfirmReset(false); }}>确认清空</button>
              <button type="button" onClick={() => setConfirmReset(false)}>取消</button>
            </span>
          ) : <button type="button" onClick={() => setConfirmReset(true)}>清空统计</button>}
        </div>
        {saveWarning && (
          <div className="tw-save-warning" role="alert">
            <span>{saveWarning}</span>
            {onResetSave && <button type="button" onClick={onResetSave}>重置旧存档并启用保存</button>}
          </div>
        )}
      </div>
      <div className="setup-ledger__footer">
        <span>{challenge ? `${challenge.roundLimit} 手 · 目标 ${challenge.targetChips}` : selectedRulesCopy.name}</span>
        <button
          type="button"
          className="rule-ledger__enter"
          onClick={() => choice === "classic" ? onStartClassic(rules, assistEnabled) : onStartChallenge(choice, assistEnabled)}
        >
          {challenge ? `开始「${challenge.name}」` : "入座经典牌桌"}<span aria-hidden="true">→</span>
        </button>
      </div>
    </article>
  );
}

interface TableLedgerProps {
  root: TwentyOneRootState;
  tab: LedgerTab;
  onTabChange: (tab: LedgerTab) => void;
  onClose: () => void;
  onAssistChange: (enabled: boolean) => void;
  onFinishClassic: () => void;
  onAbandonChallenge: () => void;
}

export function TableLedger({
  root,
  tab,
  onTabChange,
  onClose,
  onAssistChange,
  onFinishClassic,
  onAbandonChallenge,
}: TableLedgerProps) {
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const session = root.activeSession;
  if (!session) return null;
  const rules = session.table.rules;
  const stats = root.lifetimeStats;
  const resolvedHands = stats.handsWon + stats.handsLost + stats.handsPushed;
  const winRate = resolvedHands === 0 ? "—" : `${Math.round((stats.handsWon / resolvedHands) * 100)}%`;

  return (
    <article className="rule-ledger table-ledger">
      <button type="button" className="rule-ledger__close" onClick={onClose} aria-label="关闭牌桌册">×</button>
      <small>TABLE LEDGER · 002</small>
      <h2 id="twenty-one-ledger-title">牌桌册</h2>
      <div className="tw-ledger-tabs" role="tablist" aria-label="牌桌册栏目">
        {(["rules", "house", "archive", "history"] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTabChange(id)}>
            {id === "rules" ? "规则" : id === "house" ? "房规" : id === "archive" ? "档案" : "记录"}
          </button>
        ))}
      </div>

      {tab === "rules" && (
        <section className="tw-ledger-panel" role="tabpanel">
          <p>目标是让每手尽量接近 21 而不超过。A 自动按 1 或 11 计点；分牌后的每手独立结算。</p>
          <ol>
            <li><b>01</b><span><strong>要牌 / 停牌</strong>继续接近，或锁定当前点数。</span></li>
            <li><b>02</b><span><strong>加倍 / 分牌</strong>用更多筹码换取更强的开局选择。</span></li>
            <li><b>03</b><span><strong>保险 / 迟投降</strong>只在合法的开局窗口出现。</span></li>
            <li><b>04</b><span><strong>庄家</strong>按本桌软 17 规则自动完成行动。</span></li>
          </ol>
        </section>
      )}

      {tab === "house" && (
        <section className="tw-ledger-panel" role="tabpanel">
          <p className="tw-readonly-note">本次会话房规已经锁定。返回模式选择后可建立另一张牌桌。</p>
          <RulesSummary rules={rules} />
          <label className="tw-assist-toggle">
            <input type="checkbox" checked={root.preferences.assistEnabled} onChange={(event) => onAssistChange(event.target.checked)} />
            <span><strong>显示策略提示按钮</strong><small>真正请求提示后，当前挑战才会标记为辅助。</small></span>
          </label>
          {session.mode === "classic" ? (
            <>
              {session.table.phase !== "betting" && <p className="tw-readonly-note">完成当前手牌后，才可生成不丢失下注的离桌总结。</p>}
              <button type="button" className="tw-ledger-danger" onClick={onFinishClassic} disabled={session.table.phase !== "betting"}>生成离桌总结</button>
            </>
          ) : confirmAbandon ? (
            <div className="tw-confirm-row" role="group" aria-label="确认放弃挑战">
              <button type="button" onClick={onAbandonChallenge}>确认放弃</button>
              <button type="button" onClick={() => setConfirmAbandon(false)}>继续挑战</button>
            </div>
          ) : <button type="button" className="tw-ledger-danger" onClick={() => setConfirmAbandon(true)}>放弃当前挑战</button>}
        </section>
      )}

      {tab === "archive" && (
        <section className="tw-ledger-panel" role="tabpanel">
          <div className="tw-stat-grid">
            <span><small>完成局数</small><strong>{stats.roundsPlayed}</strong></span>
            <span><small>手牌胜率</small><strong>{winRate}</strong></span>
            <span><small>生涯净筹码</small><strong>{signed(stats.netChips)}</strong></span>
            <span><small>Blackjack</small><strong>{stats.blackjacks}</strong></span>
            <span><small>胜 / 负 / 和</small><strong>{stats.handsWon}/{stats.handsLost}/{stats.handsPushed}</strong></span>
            <span><small>最佳连胜</small><strong>{stats.bestWinStreak}</strong></span>
            <span><small>最高余额</small><strong>{stats.peakChips || "—"}</strong></span>
            <span><small>最大单局</small><strong>{signed(stats.biggestRoundWin)}</strong></span>
          </div>
          <details className="tw-archive-details">
            <summary>保险与挑战记录</summary>
            <p>保险 {stats.insurancePurchases} 次 · 净值 {signed(stats.insuranceNet)} · 爆牌 {stats.playerBusts} · 投降 {stats.surrenders}</p>
            {Object.values(CHALLENGES).map((challenge) => {
              const record = root.challengeRecords[challenge.id];
              return <p key={challenge.id}><strong>{challenge.name}</strong> 无辅助 {record.unassisted.clears}/{record.unassisted.runs} · 辅助 {record.assisted.clears}/{record.assisted.runs}</p>;
            })}
          </details>
          <p className="tw-readonly-note">清空档案会影响长期记录，请先结束或放弃当前会话，再在模式选择页操作。</p>
          <button type="button" className="tw-ledger-danger" disabled>清空本机统计</button>
        </section>
      )}

      {tab === "history" && (
        <section className="tw-ledger-panel" role="tabpanel">
          <p>按时间倒序的本手记录；最近 20 条会随存档保留。</p>
          <ol className="tw-history-list">
            {[...session.table.log].reverse().map((event) => (
              <li key={event.id}>
                <small>{event.actor === "player" ? "你" : event.actor === "dealer" ? "庄家" : "牌桌"} · #{event.id}</small>
                <span>{event.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
