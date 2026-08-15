import { useEffect, useMemo, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import type { GameRuntimeProps } from "../../../core/games/types";
import { useSound } from "../../../shared/audio/SoundProvider";
import { playbackDelay, usePlaybackSpeed } from "../../../shared/settings/usePlaybackSpeed";
import { useModalFocus } from "../../../shared/ui/useModalFocus";
import {
  createInitialState,
  evaluateHand,
  getActiveHand,
  legalActions,
  transition,
} from "../domain/engine";
import {
  TWENTY_ONE_SAVE_SCHEMA_VERSION,
  restoreTwentyOneRootState,
  serializeTwentyOneRootState,
} from "../domain/persistence";
import {
  CHALLENGES,
  STANDARD_SIX_RULES,
  abandonSession,
  createDefaultRootState,
  finishClassicSession,
  markHintUsed,
  rememberBet,
  resetArchive,
  retryActiveSession,
  returnToModeSelect,
  setAssistEnabled,
  startChallengeSession,
  startClassicSession,
  updateActiveTable,
  updatePreferences,
  type ChallengeId,
  type TwentyOneRootState,
} from "../domain/session";
import { getStrategyHint, type StrategyHint } from "../domain/strategy";
import type { TwentyOneAction, TwentyOneRules, TwentyOneState } from "../domain/types";
import { OutcomeTicket, SessionSummary } from "./ResultPanels";
import { PlayerHands } from "./PlayerHands";
import { SetupLedger, TableLedger, type LedgerTab } from "./TablePanels";
import { PlayingCard } from "./PlayingCard";

function ScoreDial({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(value, 21);
  const style = {
    "--dial-progress": `${(clamped / 21) * 360}deg`,
    "--dial-angle": `${(clamped / 21) * 360 - 90}deg`,
  } as CSSProperties;

  return (
    <div className={`score-dial ${value > 21 ? "is-busted" : ""}`} style={style} aria-label={`${label} ${value} 点`}>
      <span className="score-dial__ticks" aria-hidden="true" />
      <span className="score-dial__hand" aria-hidden="true"><i /></span>
      <span className="score-dial__value"><small>{label}</small><strong>{value}</strong><i>/ 21</i></span>
    </div>
  );
}

function phaseLabel(state: TwentyOneState): string {
  switch (state.phase) {
    case "betting": return "PLACE YOUR BET";
    case "insurance": return "INSURANCE OFFER";
    case "player-turn": return "YOUR DECISION";
    case "dealer-turn": return "HOUSE MOVE";
    case "settled": return "TABLE CLOSED";
  }
}

function decisionUnavailableReason(
  state: TwentyOneState,
  action: "hit" | "stand" | "double" | "split" | "surrender",
): string | undefined {
  const hand = getActiveHand(state);
  if (state.phase !== "player-turn") return "现在不是你的行动阶段";
  if (!hand || hand.status !== "playing") {
    if (hand?.status === "busted") return "本手已经爆牌";
    if (hand?.status === "surrendered") return "本手已经投降";
    if (hand?.status === "stood") return "本手已经停牌";
    return "本手已经完成";
  }

  if (action === "hit" && hand.splitAces && !state.rules.hitSplitAces) {
    return "本桌房规禁止分 A 后继续要牌";
  }
  if (action === "double") {
    if (hand.cards.length !== 2) return "只有最初两张牌时才能加倍";
    if (hand.doubled) return "本手已经加倍";
    if (state.chips < hand.wager) return "筹码不足，无法再托一等额注";
    if (hand.fromSplit && !state.rules.doubleAfterSplit) return "本桌房规禁止分牌后加倍";
    if (hand.splitAces && !state.rules.hitSplitAces) return "本桌房规禁止分 A 后加倍";
  }
  if (action === "split") {
    if (state.hands.length >= state.rules.maxPlayerHands) return "已经达到分牌手数上限";
    if (state.chips < hand.wager) return "筹码不足，无法追加等额注";
    if (hand.cards.length !== 2) return "只有两张点值相同的牌才能分牌";
    const values = hand.cards.map((card) => card.rank === "A" ? 11 : ["J", "Q", "K"].includes(card.rank) ? 10 : Number(card.rank));
    if (values[0] !== values[1]) return "两张牌点值不同，不能分牌";
    if (hand.cards[0].rank === "A" && hand.fromSplit && !state.rules.resplitAces) return "本桌房规禁止再次分 A";
  }
  if (action === "surrender") {
    if (!state.rules.allowLateSurrender) return "本桌房规未开启迟投降";
    if (state.hands.length > 1 || hand.fromSplit) return "分牌或多手局面不能迟投降";
    if (hand.doubled) return "加倍后不能迟投降";
    if (hand.cards.length !== 2) return "只有最初两张牌时才能迟投降";
  }
  return undefined;
}

interface ActiveTableProps {
  root: TwentyOneRootState;
  setRoot: Dispatch<SetStateAction<TwentyOneRootState>>;
  onExit: () => void;
  restoredNotice: boolean;
  saveUnavailable: boolean;
}

function ActiveTable({ root, setRoot, onExit, restoredNotice, saveUnavailable }: ActiveTableProps) {
  const session = root.activeSession!;
  const state = session.table;
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>("rules");
  const [hint, setHint] = useState<(StrategyHint & { revision: number }) | undefined>();
  const { enabled: soundEnabled, toggle: toggleSound, play: playSound } = useSound();
  const { speed: playbackSpeed, cycle: cyclePlaybackSpeed } = usePlaybackSpeed();
  const activeHand = getActiveHand(state) ?? state.hands.at(-1);
  const playerValue = evaluateHand(activeHand?.cards ?? []);
  const dealerValue = evaluateHand(state.dealerHand);
  const visibleDealerValue = state.dealerRevealed ? dealerValue : evaluateHand(state.dealerHand.slice(0, 1));
  const legal = legalActions(state);
  const latestCardId = state.lastEvent?.card?.id;
  const dealerThinking = state.phase === "dealer-turn" && !ledgerOpen && session.status === "playing";
  const totalOnTable = state.hands.reduce((sum, hand) => sum + hand.wager, 0) + state.insurance.wager;
  const challenge = session.mode === "challenge" && session.challengeId ? CHALLENGES[session.challengeId] : undefined;
  const lastBet = root.preferences.lastBet ?? 25;
  const repeatBetAvailable = state.phase === "betting" && legal.bets.includes(lastBet);

  useEffect(() => {
    if (!dealerThinking) return;
    const expectedRevision = state.revision;
    const preview = transition(state, { type: "dealer-step" });
    const timer = window.setTimeout(() => {
      setRoot((current) => {
        const currentSession = current.activeSession;
        if (!currentSession
          || currentSession.status !== "playing"
          || currentSession.table.phase !== "dealer-turn"
          || currentSession.table.revision !== expectedRevision) return current;
        return updateActiveTable(current, transition(currentSession.table, { type: "dealer-step" }));
      });
      if (preview.phase !== "settled") playSound("card");
    }, playbackDelay(680, playbackSpeed));
    return () => window.clearTimeout(timer);
  }, [dealerThinking, playSound, playbackSpeed, setRoot, state]);

  useEffect(() => {
    if (state.phase === "settled") playSound(state.settlement?.outcome === "player" ? "win" : "tap");
  }, [playSound, state.phase, state.settlement?.outcome]);

  const ledgerRef = useModalFocus({
    active: ledgerOpen,
    initialFocus: ".tw-ledger-tabs button",
    onDismiss: () => setLedgerOpen(false),
  });
  const resultVisible = state.phase === "settled" && Boolean(state.settlement) && session.status === "playing" && !ledgerOpen;
  const resultRef = useModalFocus({ active: resultVisible, initialFocus: ".outcome-ticket__actions button" });
  const summaryVisible = session.status === "summary" && !ledgerOpen;
  const summaryRef = useModalFocus({ active: summaryVisible, initialFocus: ".outcome-ticket__actions button" });

  function applyAction(action: TwentyOneAction, cue: "tap" | "card" | "hit" = "tap") {
    setHint(undefined);
    setRoot((current) => {
      const currentSession = current.activeSession;
      if (!currentSession || currentSession.status !== "playing") return current;
      const next = updateActiveTable(current, transition(currentSession.table, action));
      return action.type === "place-bet" ? rememberBet(next, action.amount) : next;
    });
    playSound(cue);
  }

  function requestHint() {
    const nextHint = getStrategyHint(state);
    if (!nextHint) return;
    setHint({ ...nextHint, revision: state.revision });
    setRoot((current) => markHintUsed(current));
    playSound("tap");
  }

  function openLedger(tab: LedgerTab = "rules") {
    setLedgerTab(tab);
    setLedgerOpen(true);
  }

  const tableMessage = hint?.revision === state.revision
    ? hint.reason
    : dealerThinking
      ? dealerValue.total < 17 || (dealerValue.total === 17 && dealerValue.soft && state.rules.dealerSoft17 === "hit")
        ? "庄家按本桌房规从牌靴取牌…"
        : "庄家停牌，正在核对多手结算…"
      : state.lastEvent?.text ?? state.log.at(-1)?.text;

  const actionClass = (action: StrategyHint["action"], base: string) => (
    `${base} ${hint?.revision === state.revision && hint.action === action ? "is-recommended" : ""}`
  );

  return (
    <main className="twenty-one-screen">
      <header className="twenty-one-topbar">
        <button type="button" className="twenty-one-topbar__button" onClick={onExit} aria-label="返回游戏大厅">←</button>
        <div className="twenty-one-title">
          <small>{challenge ? `${challenge.eyebrow} · ${session.roundsCompleted}/${challenge.roundLimit}` : `CLASSIC · 第 ${state.handNumber} 手`}</small>
          <strong>二十一刻</strong>
        </div>
        <div className="twenty-one-tools">
          <button type="button" onClick={() => openLedger("rules")} aria-label="打开牌桌册">☷</button>
          <button type="button" onClick={cyclePlaybackSpeed} aria-label={`AI 速度 ${playbackSpeed}×`} title={`AI 速度 ${playbackSpeed}×`}>{playbackSpeed}×</button>
          <button type="button" onClick={toggleSound} aria-label={soundEnabled ? "关闭声音" : "开启声音"}>{soundEnabled ? "♪" : "×"}</button>
        </div>
      </header>

      {restoredNotice && <div className="tw-restore-notice" role="status">已恢复{challenge ? `${challenge.name} ${session.roundsCompleted}/${challenge.roundLimit}` : `经典牌桌第 ${state.handNumber} 手`}</div>}
      {saveUnavailable && <div className="tw-save-warning tw-save-warning--banner" role="alert">本机存档不可用，本次进度只在当前页面保留。</div>}

      <section className="twenty-one-table" aria-label="二十一刻牌桌">
        <div className="twenty-one-table__arc" aria-hidden="true" />
        <section className="dealer-zone" aria-label="庄家手牌">
          <div className="hand-heading">
            <span><small>THE HOUSE</small><strong>庄家</strong></span>
            <span className="hand-heading__score">{state.dealerRevealed ? visibleDealerValue.total : state.dealerHand.length ? `${visibleDealerValue.total} + ?` : "—"}</span>
          </div>
          <div className="playing-hand playing-hand--dealer">
            {state.dealerHand.map((card, index) => (
              <PlayingCard
                key={card.id}
                card={card}
                index={index}
                hidden={!state.dealerRevealed && index === 1}
                fresh={latestCardId === card.id}
                revealed={state.dealerRevealed && index === 1 && state.lastEvent?.type === "reveal"}
              />
            ))}
          </div>
        </section>

        <section className="table-center">
          <div className="deck-stack" aria-label={`牌靴剩余 ${state.deck.length} 张`}><i /><i /><b>CF</b><span>{state.deck.length}</span></div>
          <div className={`chip-stack ${state.phase === "settled" ? state.settlement && state.settlement.net >= 0 ? "is-gain" : "is-loss" : ""}`} aria-label={`筹码 ${state.chips}，桌上押注 ${totalOnTable}`}>
            <small>筹码</small><b>{state.chips}</b>{totalOnTable > 0 && <em>押 {totalOnTable}</em>}
          </div>
          <ScoreDial value={playerValue.total} label={activeHand ? playerValue.soft ? "软点数" : `手牌 ${(state.activeHandIndex ?? state.hands.length - 1) + 1}` : "你的点数"} />
          <div className="table-status" key={`${state.revision}-${hint?.revision ?? "none"}`} role="status" aria-live="polite">
            <small>{phaseLabel(state)}</small><p>{tableMessage}</p>
          </div>
        </section>

        <section className="player-zone" aria-label="你的手牌">
          <div className="hand-heading">
            <span><small>THE SEEKER</small><strong>你</strong></span>
            <span className="hand-heading__score">{state.hands.length > 1 ? `${state.hands.length} 手牌` : activeHand ? `${playerValue.total} 点` : "—"}</span>
          </div>
          <PlayerHands hands={state.hands} activeHandIndex={state.activeHandIndex} latestCardId={latestCardId} />
        </section>
      </section>

      <footer className="decision-dock">
        <div className="decision-dock__copy">
          <small>{state.phase === "betting" ? `第 ${state.handNumber} 手 · 下注` : state.phase === "insurance" ? "边注窗口" : state.phase === "player-turn" ? `手牌 ${(state.activeHandIndex ?? 0) + 1} · 你的判断` : state.phase === "dealer-turn" ? "庄家行动中" : "本轮已落定"}</small>
          <strong>{tableMessage}</strong>
        </div>

        {state.phase === "betting" ? (
          <div className="bet-actions">
            {legal.bets.map((amount) => <button key={amount} type="button" className="bet-chip" onClick={() => applyAction({ type: "place-bet", amount }, "card")} aria-label={`压 ${amount} 枚筹码`}>{amount}</button>)}
            {repeatBetAvailable && (
              <button
                type="button"
                className="bet-chip bet-chip--repeat"
                onClick={() => applyAction({ type: "place-bet", amount: lastBet }, "card")}
                aria-label={`重复上一注 ${lastBet}`}
              >
                重复 {lastBet}
              </button>
            )}
          </div>
        ) : state.phase === "insurance" ? (
          <div className="insurance-actions">
            <button type="button" className={actionClass("decline-insurance", "decision-button decision-button--stand")} onClick={() => applyAction({ type: "decline-insurance" })} disabled={!legal.declineInsurance}><span>不买保险</span><small>DECLINE</small></button>
            <button type="button" className={actionClass("take-insurance", "decision-button decision-button--double")} onClick={() => applyAction({ type: "take-insurance" }, "card")} disabled={!legal.takeInsurance}><span>买保险 {state.baseBet / 2}</span><small>INSURE</small></button>
            {root.preferences.assistEnabled && <button type="button" className="tw-hint-button" onClick={requestHint}>提示</button>}
          </div>
        ) : (
          <div className="decision-actions decision-actions--expanded">
            <div className="decision-actions__primary">
              <button type="button" className={actionClass("stand", "decision-button decision-button--stand")} onClick={() => applyAction({ type: "stand" })} disabled={!legal.stand} title={legal.stand ? undefined : decisionUnavailableReason(state, "stand")}><span>停牌</span><small>STAND</small></button>
              <button type="button" className={actionClass("hit", "decision-button decision-button--hit")} onClick={() => applyAction({ type: "hit" }, "card")} disabled={!legal.hit} title={legal.hit ? undefined : decisionUnavailableReason(state, "hit")}><span>要牌</span><small>HIT</small></button>
            </div>
            <div className={`decision-actions__secondary ${root.preferences.assistEnabled ? "has-hint" : ""}`}>
              <button type="button" className={actionClass("double", "tw-secondary-action")} onClick={() => applyAction({ type: "double" }, "hit")} disabled={!legal.double} title={legal.double ? undefined : decisionUnavailableReason(state, "double")}>加倍</button>
              <button type="button" className={actionClass("split", "tw-secondary-action")} onClick={() => applyAction({ type: "split" }, "card")} disabled={!legal.split} title={legal.split ? undefined : decisionUnavailableReason(state, "split")}>分牌</button>
              <button type="button" className={actionClass("surrender", "tw-secondary-action")} onClick={() => applyAction({ type: "surrender" })} disabled={!legal.surrender} title={legal.surrender ? undefined : decisionUnavailableReason(state, "surrender")}>投降</button>
              {root.preferences.assistEnabled && <button type="button" className="tw-secondary-action" onClick={requestHint} disabled={state.phase !== "player-turn"}>提示</button>}
            </div>
          </div>
        )}
      </footer>

      {ledgerOpen && (
        <div ref={ledgerRef} className="twenty-one-modal" role="dialog" aria-modal="true" aria-labelledby="twenty-one-ledger-title" tabIndex={-1}>
          <TableLedger
            root={root}
            tab={ledgerTab}
            onTabChange={setLedgerTab}
            onClose={() => setLedgerOpen(false)}
            onAssistChange={(enabled) => setRoot((current) => setAssistEnabled(current, enabled))}
            onFinishClassic={() => {
              setRoot((current) => finishClassicSession(current));
              setLedgerOpen(false);
            }}
            onAbandonChallenge={() => {
              setRoot((current) => abandonSession(current));
              setLedgerOpen(false);
            }}
          />
        </div>
      )}

      {resultVisible && (
        <div ref={resultRef} className="twenty-one-modal twenty-one-modal--result" role="dialog" aria-modal="true" aria-labelledby="twenty-one-result-title" tabIndex={-1}>
          <OutcomeTicket session={session} onNext={() => applyAction({ type: "next-hand" })} onExit={onExit} />
        </div>
      )}

      {summaryVisible && (
        <div ref={summaryRef} className="twenty-one-modal twenty-one-modal--result" role="dialog" aria-modal="true" aria-labelledby="twenty-one-summary-title" tabIndex={-1}>
          <SessionSummary
            root={root}
            onRetry={() => {
              setRoot((current) => {
                const currentSession = current.activeSession;
                if (!currentSession) return current;
                const rules = currentSession.mode === "challenge" ? STANDARD_SIX_RULES : currentSession.table.rules;
                return retryActiveSession(current, createInitialState(Math.random, rules));
              });
            }}
            onModeSelect={() => setRoot((current) => returnToModeSelect(current))}
          />
        </div>
      )}
    </main>
  );
}

export function TwentyOneExperience({ onExit, persistence }: GameRuntimeProps) {
  const restored = useMemo(
    () => persistence?.restored
      ? restoreTwentyOneRootState(persistence.restored.schemaVersion, persistence.restored.data)
      : undefined,
    [persistence],
  );
  const unreadableRestoredSave = Boolean(persistence?.restored && !restored);
  const [root, setRoot] = useState<TwentyOneRootState>(() => restored ?? createDefaultRootState());
  const [restoredNotice, setRestoredNotice] = useState(Boolean(restored?.activeSession));
  const [saveBlocked, setSaveBlocked] = useState(unreadableRestoredSave);
  const [saveUnavailable, setSaveUnavailable] = useState(false);
  const { enabled: soundEnabled, toggle: toggleSound, play: playSound } = useSound();
  const setupVisible = root.activeSession === undefined;
  const setupRef = useModalFocus({
    active: setupVisible,
    initialFocus: ".tw-mode-grid button",
    onDismiss: onExit,
  });

  useEffect(() => {
    if (!persistence || saveBlocked || (root.revision === 0 && !persistence.restored)) return;
    const saved = persistence.save(TWENTY_ONE_SAVE_SCHEMA_VERSION, root.revision, serializeTwentyOneRootState(root));
    if (saved) return;
    const timer = window.setTimeout(() => setSaveUnavailable(true), 0);
    return () => window.clearTimeout(timer);
  }, [persistence, root, saveBlocked]);

  useEffect(() => {
    if (!restoredNotice) return;
    const timer = window.setTimeout(() => setRestoredNotice(false), 2800);
    return () => window.clearTimeout(timer);
  }, [restoredNotice]);

  function resetUnreadableSave() {
    persistence?.clear();
    setSaveBlocked(false);
    setSaveUnavailable(false);
  }

  function startClassic(rules: TwentyOneRules, assistEnabled: boolean) {
    setRoot((current) => {
      const configured = updatePreferences(current, { rules, assistEnabled });
      return startClassicSession(configured, createInitialState(Math.random, rules));
    });
    setRestoredNotice(false);
    playSound("card");
  }

  function startChallenge(challengeId: ChallengeId, assistEnabled: boolean) {
    setRoot((current) => {
      const configured = updatePreferences(current, { ...current.preferences, assistEnabled });
      return startChallengeSession(configured, challengeId, createInitialState(Math.random, STANDARD_SIX_RULES));
    });
    setRestoredNotice(false);
    playSound("card");
  }

  if (root.activeSession) {
    return <ActiveTable root={root} setRoot={setRoot} onExit={onExit} restoredNotice={restoredNotice} saveUnavailable={saveUnavailable} />;
  }

  return (
    <main className="twenty-one-screen twenty-one-screen--setup">
      <header className="twenty-one-topbar">
        <button type="button" className="twenty-one-topbar__button" onClick={onExit} aria-label="返回游戏大厅">←</button>
        <div className="twenty-one-title"><small>CARDFORGE · TABLE 002</small><strong>二十一刻</strong></div>
        <div />
      </header>
      <section className="twenty-one-table tw-setup-backdrop" aria-hidden="true"><div className="twenty-one-table__arc" /><ScoreDial value={21} label="目标刻度" /></section>
      <div ref={setupRef} className="twenty-one-modal" role="dialog" aria-modal="true" aria-labelledby="twenty-one-setup-title" tabIndex={-1}>
        <SetupLedger
          root={root}
          onExit={onExit}
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
          onStartClassic={startClassic}
          onStartChallenge={startChallenge}
          onResetArchive={() => setRoot((current) => resetArchive(current))}
          saveWarning={saveBlocked
            ? "现有存档无法安全读取，本次不会覆盖它。"
            : saveUnavailable
              ? "本机存档不可用，本次进度只在当前页面保留。"
              : undefined}
          onResetSave={saveBlocked ? resetUnreadableSave : undefined}
        />
      </div>
    </main>
  );
}
