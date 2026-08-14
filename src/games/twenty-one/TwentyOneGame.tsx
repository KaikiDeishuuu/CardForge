import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { GameRuntimeProps } from "../../core/games/types";
import { useSound } from "../../shared/audio/SoundProvider";
import { PlayingCard } from "./components/PlayingCard";
import { createInitialState, dealerStep, evaluateHand, playerHit, playerStand } from "./domain/engine";
import type { TwentyOneOutcome } from "./domain/types";
import "./twenty-one.css";

const OUTCOME_COPY: Record<TwentyOneOutcome, { eyebrow: string; title: string; mark: string }> = {
  player: { eyebrow: "判断成立", title: "此刻属于你", mark: "胜" },
  dealer: { eyebrow: "风险兑现", title: "庄家守住牌桌", mark: "负" },
  push: { eyebrow: "刻度重合", title: "本局和牌", mark: "和" },
};

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

export function TwentyOneGame({ onExit }: GameRuntimeProps) {
  const [state, setState] = useState(createInitialState);
  const [showRules, setShowRules] = useState(true);
  const [dealerThinking, setDealerThinking] = useState(false);
  const { enabled: soundEnabled, toggle: toggleSound, play: playSound } = useSound();

  const playerValue = useMemo(() => evaluateHand(state.playerHand), [state.playerHand]);
  const dealerValue = useMemo(() => evaluateHand(state.dealerHand), [state.dealerHand]);
  const visibleDealerValue = state.dealerRevealed
    ? dealerValue
    : evaluateHand(state.dealerHand.slice(0, 1));
  const latestCardId = state.lastEvent?.card?.id;
  const canAct = state.phase === "player-turn" && !showRules;

  useEffect(() => {
    if (state.phase !== "dealer-turn" || showRules) {
      setDealerThinking(false);
      return;
    }

    setDealerThinking(true);
    const expectedRevision = state.revision;
    const timer = window.setTimeout(() => {
      setState((current) => {
        if (current.phase !== "dealer-turn" || current.revision !== expectedRevision) return current;
        return dealerStep(current);
      });
      playSound(dealerValue.total < 17 ? "card" : "tap");
    }, 760);

    return () => window.clearTimeout(timer);
  }, [dealerValue.total, playSound, showRules, state.phase, state.revision]);

  useEffect(() => {
    if (state.phase === "settled") {
      setDealerThinking(false);
      playSound(state.outcome === "player" ? "win" : "tap");
    }
  }, [playSound, state.outcome, state.phase]);

  function hit() {
    if (!canAct) return;
    setState((current) => playerHit(current));
    playSound("card");
  }

  function stand() {
    if (!canAct) return;
    setState((current) => playerStand(current));
    playSound("tap");
  }

  function restart() {
    setState(createInitialState());
    setDealerThinking(false);
    playSound("card");
  }

  const tableMessage = state.phase === "settled"
    ? state.lastEvent?.text
    : dealerThinking
      ? dealerValue.busted
        ? "庄家越过二十一点，正在结算…"
        : dealerValue.total < 17
          ? "庄家正在权衡，并从牌靴取牌…"
          : "庄家停牌，正在核对刻度…"
      : state.lastEvent?.text ?? state.log.at(-1)?.text;

  return (
    <main className="twenty-one-screen">
      <header className="twenty-one-topbar">
        <button type="button" className="twenty-one-topbar__button" onClick={onExit} aria-label="返回游戏大厅">←</button>
        <div className="twenty-one-title">
          <small>CARDFORGE · TABLE 002</small>
          <strong>二十一刻</strong>
        </div>
        <div className="twenty-one-tools">
          <button type="button" onClick={() => setShowRules(true)} aria-label="查看规则">?</button>
          <button type="button" onClick={toggleSound} aria-label={soundEnabled ? "关闭声音" : "开启声音"}>{soundEnabled ? "♪" : "×"}</button>
        </div>
      </header>

      <section className="twenty-one-table" aria-label="二十一刻牌桌">
        <div className="twenty-one-table__arc" aria-hidden="true" />

        <section className="dealer-zone" aria-label="庄家手牌">
          <div className="hand-heading">
            <span><small>THE HOUSE</small><strong>庄家</strong></span>
            <span className="hand-heading__score">
              {state.dealerRevealed ? visibleDealerValue.total : `${visibleDealerValue.total} + ?`}
            </span>
          </div>
          <div className="playing-hand playing-hand--dealer">
            {state.dealerHand.map((card, index) => (
              <PlayingCard
                key={card.id}
                card={card}
                index={index}
                hidden={!state.dealerRevealed && index === 1}
                fresh={latestCardId === card.id}
              />
            ))}
          </div>
        </section>

        <section className="table-center" aria-live="polite">
          <div className="deck-stack" aria-label={`牌靴剩余 ${state.deck.length} 张`}>
            <i /><i /><b>CF</b><span>{state.deck.length}</span>
          </div>
          <ScoreDial value={playerValue.total} label={playerValue.soft ? "软点数" : "你的点数"} />
          <div className="table-status" key={state.revision}>
            <small>{state.phase === "player-turn" ? "YOUR DECISION" : state.phase === "dealer-turn" ? "HOUSE MOVE" : "TABLE CLOSED"}</small>
            <p>{tableMessage}</p>
          </div>
        </section>

        <section className="player-zone" aria-label="你的手牌">
          <div className="hand-heading">
            <span><small>THE SEEKER</small><strong>你</strong></span>
            <span className="hand-heading__score">{playerValue.total}</span>
          </div>
          <div className="playing-hand playing-hand--player">
            {state.playerHand.map((card, index) => (
              <PlayingCard key={card.id} card={card} index={index} fresh={latestCardId === card.id} />
            ))}
          </div>
        </section>
      </section>

      <footer className="decision-dock">
        <div className="decision-dock__copy">
          <small>{canAct ? "轮到你判断" : dealerThinking ? "庄家行动中" : "本局已落定"}</small>
          <strong>{canAct ? (playerValue.total < 17 ? "继续接近，还是就此停下？" : "风险正在升高。") : "牌桌会自动推进"}</strong>
        </div>
        <div className="decision-actions">
          <button type="button" className="decision-button decision-button--stand" onClick={stand} disabled={!canAct}>
            <span>停牌</span><small>STAND</small>
          </button>
          <button type="button" className="decision-button decision-button--hit" onClick={hit} disabled={!canAct}>
            <span>要牌</span><small>HIT</small>
          </button>
        </div>
      </footer>

      {showRules && (
        <div className="twenty-one-modal" role="dialog" aria-modal="true" aria-labelledby="twenty-one-rules-title">
          <div className="rule-ledger">
            <button type="button" className="rule-ledger__close" onClick={() => setShowRules(false)} aria-label="关闭规则">×</button>
            <small>TABLE NOTE · 002</small>
            <h2 id="twenty-one-rules-title">在第二十一格<br />之前停下。</h2>
            <p>让手中点数尽量接近 21，但不要超过。这里没有战斗、HP 或阵营，只有一次清晰的风险判断。</p>
            <ol>
              <li><b>01</b><span><strong>要牌</strong>再取一张；超过 21 立即落败。</span></li>
              <li><b>02</b><span><strong>停牌</strong>把选择交给庄家；庄家不足 17 必须继续取牌。</span></li>
              <li><b>03</b><span><strong>A</strong>可计为 1 或 11；两张牌恰好 21 即为 Blackjack。</span></li>
            </ol>
            <button type="button" className="rule-ledger__enter" onClick={() => { setShowRules(false); playSound("card"); }}>开始判断 <span>→</span></button>
          </div>
        </div>
      )}

      {state.phase === "settled" && state.outcome && !showRules && (
        <div className="twenty-one-modal twenty-one-modal--result" role="dialog" aria-modal="true" aria-labelledby="twenty-one-result-title">
          <div className={`outcome-ticket outcome-ticket--${state.outcome}`}>
            <span className="outcome-ticket__mark" aria-hidden="true">{OUTCOME_COPY[state.outcome].mark}</span>
            <small>{OUTCOME_COPY[state.outcome].eyebrow}</small>
            <h2 id="twenty-one-result-title">{OUTCOME_COPY[state.outcome].title}</h2>
            <p>{state.reason}</p>
            <div className="outcome-ticket__scores">
              <span><small>你的点数</small><strong>{playerValue.total}</strong></span>
              <i />
              <span><small>庄家点数</small><strong>{dealerValue.total}</strong></span>
            </div>
            <div className="outcome-ticket__actions">
              <button type="button" onClick={restart}>再来一局</button>
              <button type="button" onClick={onExit}>返回大厅</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
