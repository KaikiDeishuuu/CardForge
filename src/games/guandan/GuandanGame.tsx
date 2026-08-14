import { useEffect, useMemo, useState } from "react";
import type { GameRuntimeProps } from "../../core/games/types";
import { useSound } from "../../shared/audio/SoundProvider";
import { GuandanCardView } from "./components/GuandanCardView";
import { chooseAiMove } from "./domain/ai";
import {
  NUMBER_RANKS,
  canPass,
  classifyCombo,
  createInitialState,
  getPlayError,
  getPlayer,
  passTurn,
  playCards,
  teamName,
} from "./domain/engine";
import type { GuandanPlayer, GuandanState, PlayerId } from "./domain/types";
import "./guandan.css";

function Seat({ player, active, lastActorId }: { player: GuandanPlayer; active: boolean; lastActorId?: PlayerId }) {
  return (
    <div className={`gd-seat gd-seat--${player.id} gd-seat--${player.team} ${active ? "is-active" : ""}`}>
      <span className="gd-seat__avatar" aria-hidden="true">{player.displayName.slice(0, 1)}</span>
      <span className="gd-seat__copy">
        <small>{player.team === "vermillion" ? "朱雀方" : "青岳方"}</small>
        <strong>{player.displayName}</strong>
      </span>
      <span className="gd-seat__count">{player.hand.length}<small>张</small></span>
      {player.finishedPlace && <b className="gd-seat__place">第 {player.finishedPlace} 名</b>}
      {lastActorId === player.id && <i className="gd-seat__pulse" />}
    </div>
  );
}

function applyMove(state: GuandanState, actorId: PlayerId) {
  const move = chooseAiMove(state, actorId);
  if (!move) return state;
  return move.kind === "play"
    ? playCards(state, actorId, move.cardIds)
    : passTurn(state, actorId);
}

export function GuandanGame({ onExit }: GameRuntimeProps) {
  const [state, setState] = useState(createInitialState);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [showRules, setShowRules] = useState(true);
  const [showLog, setShowLog] = useState(false);
  const [autoPilot, setAutoPilot] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [hintText, setHintText] = useState<string>();
  const { enabled: soundEnabled, toggle: toggleSound, play: playSound } = useSound();

  const human = getPlayer(state, "human");
  const active = getPlayer(state, state.activePlayerId);
  const selectedCards = useMemo(
    () => human.hand.filter((card) => selectedIds.includes(card.id)),
    [human.hand, selectedIds],
  );
  const selectedCombo = useMemo(
    () => classifyCombo(selectedCards, state.levelRank),
    [selectedCards, state.levelRank],
  );
  const humanCanAct = state.status === "playing" && state.activePlayerId === "human" && !autoPilot && !showRules && !showLog;
  const playError = selectedIds.length > 0 ? getPlayError(state, "human", selectedIds) : undefined;
  const handMidpoint = Math.ceil(human.hand.length / 2);
  const handRows = [human.hand.slice(0, handMidpoint), human.hand.slice(handMidpoint)];

  useEffect(() => {
    const automate = state.status === "playing"
      && (active.controller === "ai" || (active.id === "human" && autoPilot));
    if (!automate || showRules || showLog) {
      setAiThinking(false);
      return;
    }

    setAiThinking(true);
    const expectedRevision = state.revision;
    const expectedActor = state.activePlayerId;
    const timer = window.setTimeout(() => {
      const move = chooseAiMove(state, expectedActor);
      setState((current) => {
        if (current.revision !== expectedRevision || current.activePlayerId !== expectedActor) return current;
        return applyMove(current, expectedActor);
      });
      if (move?.kind === "play") playSound("card");
      else playSound("tap");
      setSelectedIds([]);
      setHintText(undefined);
    }, 460);
    return () => window.clearTimeout(timer);
  }, [active.controller, active.id, autoPilot, playSound, showLog, showRules, state]);

  useEffect(() => {
    if (state.status === "finished") playSound(state.winner === human.team ? "win" : "tap");
  }, [human.team, playSound, state.status, state.winner]);

  function toggleCard(id: string) {
    if (!humanCanAct) return;
    setSelectedIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
    setHintText(undefined);
    playSound("tap");
  }

  function playSelection() {
    if (!humanCanAct || playError || selectedIds.length === 0) return;
    setState((current) => playCards(current, "human", selectedIds));
    setSelectedIds([]);
    setHintText(undefined);
    playSound(selectedCombo?.type === "bomb" ? "hit" : "card");
  }

  function pass() {
    if (!humanCanAct || !canPass(state, "human")) return;
    setState((current) => passTurn(current, "human"));
    setSelectedIds([]);
    setHintText(undefined);
    playSound("tap");
  }

  function suggest() {
    if (!humanCanAct) return;
    const suggestion = chooseAiMove(state, "human");
    if (suggestion?.kind === "play") {
      const cards = human.hand.filter((card) => suggestion.cardIds.includes(card.id));
      setSelectedIds(suggestion.cardIds);
      setHintText(`建议：${classifyCombo(cards, state.levelRank)?.label ?? "出牌"}`);
    } else {
      setSelectedIds([]);
      setHintText("建议过牌，让对家守住牌墩。");
    }
    playSound("tap");
  }

  function restart() {
    setState(createInitialState());
    setSelectedIds([]);
    setAutoPilot(false);
    setHintText(undefined);
    playSound("card");
  }

  const tableMessage = aiThinking
    ? `${active.displayName}正在理牌…`
    : state.lastAction?.text ?? "等待出牌。";
  const opposingPlayers = state.players.filter((player) => player.id === "east" || player.id === "west");
  const partner = getPlayer(state, "partner");
  const resultWon = state.winner === human.team;

  return (
    <main className="guandan-screen">
      <header className="guandan-topbar">
        <button type="button" className="gd-round-button" onClick={onExit} aria-label="返回游戏大厅">←</button>
        <div className="guandan-title">
          <small>CARDFORGE · TABLE 003</small>
          <strong>掼蛋 · 入门局</strong>
        </div>
        <div className="guandan-tools">
          <button type="button" onClick={() => setShowRules(true)} aria-label="查看规则">?</button>
          <button type="button" onClick={() => setShowLog((value) => !value)} aria-label="查看牌局记录">≡</button>
          <button type="button" onClick={toggleSound} aria-label={soundEnabled ? "关闭声音" : "开启声音"}>{soundEnabled ? "♪" : "×"}</button>
        </div>
      </header>

      <div className="gd-level-rail" aria-label={`本局级牌为 ${state.levelRank}`}>
        <span>本局级牌</span>
        <div>{NUMBER_RANKS.map((rank) => <i key={rank} className={rank === state.levelRank ? "is-level" : ""}>{rank}</i>)}</div>
        <strong>逢人配 · ♥{state.levelRank}</strong>
      </div>

      <section className="gd-arena" aria-label="四人掼蛋牌桌">
        <div className="gd-partner-axis" aria-hidden="true"><span>对 家 轴</span></div>
        <Seat player={partner} active={state.activePlayerId === partner.id} lastActorId={state.lastAction?.actorId === "table" ? undefined : state.lastAction?.actorId} />
        {opposingPlayers.map((player) => (
          <Seat key={player.id} player={player} active={state.activePlayerId === player.id} lastActorId={state.lastAction?.actorId === "table" ? undefined : state.lastAction?.actorId} />
        ))}

        <div className={`gd-trick ${state.trick?.combo.type === "bomb" ? "is-bomb" : ""}`} aria-live="polite">
          <header>
            <span><small>当前牌墩</small><strong>{state.trick?.combo.label ?? "等待领出"}</strong></span>
            {state.trick && <b>{getPlayer(state, state.trick.actorId).displayName} · {state.trick.combo.cards.length} 张</b>}
          </header>
          <div className="gd-trick__cards">
            {state.trick ? state.trick.combo.cards.map((card) => (
              <GuandanCardView key={card.id} card={card} levelRank={state.levelRank} compact />
            )) : <span className="gd-trick__empty">贯</span>}
          </div>
          <p key={state.revision}>{tableMessage}</p>
        </div>

        <div className={`gd-turn-flag gd-turn-flag--${active.team}`}>
          <i />
          <span>{state.status === "finished" ? "牌局结束" : `${active.displayName}的行动`}</span>
        </div>
      </section>

      <section className="gd-hand-dock" aria-label="你的手牌">
        <header className="gd-hand-heading">
          <span><small>朱雀方 · 南座</small><strong>你的手牌 <i>{human.hand.length}</i></strong></span>
          <span className="gd-selection-status">
            {hintText ?? (selectedIds.length === 0 ? "点选同型牌" : playError ?? `${selectedCombo?.label ?? "已选"} · ${selectedIds.length} 张`)}
          </span>
          <button
            type="button"
            className={`gd-autoplay ${autoPilot ? "is-on" : ""}`}
            onClick={() => { setAutoPilot((value) => !value); setSelectedIds([]); }}
          >
            {autoPilot ? "接管" : "托管"}
          </button>
        </header>

        <div className="gd-hand-rows">
          {handRows.map((row, rowIndex) => (
            <div className="gd-hand-row" key={`${rowIndex}-${human.hand.length}`}>
              {row.map((card) => (
                <GuandanCardView
                  key={card.id}
                  card={card}
                  levelRank={state.levelRank}
                  selectable
                  selected={selectedIds.includes(card.id)}
                  onSelect={toggleCard}
                />
              ))}
            </div>
          ))}
        </div>

        <footer className="gd-actions">
          <button type="button" className="gd-action gd-action--hint" onClick={suggest} disabled={!humanCanAct}>提示</button>
          <button type="button" className="gd-action gd-action--pass" onClick={pass} disabled={!humanCanAct || !canPass(state, "human")}>过牌</button>
          <button type="button" className="gd-action gd-action--play" onClick={playSelection} disabled={!humanCanAct || Boolean(playError) || selectedIds.length === 0}>
            出牌 <span>→</span>
          </button>
        </footer>
      </section>

      {showLog && (
        <aside className="gd-log" aria-label="牌局记录">
          <header><strong>牌桌记录</strong><button type="button" onClick={() => setShowLog(false)} aria-label="关闭牌局记录">×</button></header>
          <ol>{[...state.log].reverse().map((entry) => <li key={entry.id}><small>{String(entry.id).padStart(2, "0")}</small><span>{entry.text}</span></li>)}</ol>
        </aside>
      )}

      {showRules && (
        <div className="gd-modal" role="dialog" aria-modal="true" aria-labelledby="gd-rules-title">
          <div className="gd-rule-board">
            <button type="button" className="gd-rule-board__close" onClick={() => setShowRules(false)} aria-label="关闭规则">×</button>
            <span className="gd-rule-board__ribbon">入门局</span>
            <small>四人 · 对家 · 双副牌</small>
            <h2 id="gd-rules-title">不是一个人跑得快，<br />是两个人走得远。</h2>
            <p>你与上方对家同队。轮流打出同型且更大的牌；其余三家都过牌后，由上一手玩家重新领出。</p>
            <div className="gd-rule-types">
              <span><b>单 / 对 / 三</b><i>同牌型比点数</i></span>
              <span><b>三带二 / 五张顺</b><i>按三张或顺子顶张比较</i></span>
              <span><b>四张起炸</b><i>可压普通牌型，张数优先</i></span>
              <span><b>红心 2</b><i>本局百搭“逢人配”</i></span>
            </div>
            <p className="gd-rule-board__scope">首版暂不包含进贡还贡、连续升级、木板/钢板和同花顺炸弹。</p>
            <button type="button" className="gd-rule-board__enter" onClick={() => { setShowRules(false); playSound("card"); }}>入席开牌 <span>→</span></button>
          </div>
        </div>
      )}

      {state.status === "finished" && state.winner && !showRules && (
        <div className="gd-modal gd-modal--result" role="dialog" aria-modal="true" aria-labelledby="gd-result-title">
          <div className={`gd-result-board gd-result-board--${state.winner}`}>
            <span className="gd-result-board__seal" aria-hidden="true">{resultWon ? "贯" : "再"}</span>
            <small>{teamName(state.winner)}完成牌局</small>
            <h2 id="gd-result-title">{resultWon ? "对家同心，先行收官" : "青岳方抢先收官"}</h2>
            <p>{resultWon ? "你和对家都已出完手牌。配合比一手大牌更重要。" : "这一局对手的接力更顺。用提示或托管观察下一次节奏。"}</p>
            <div className="gd-finish-order">
              {state.finishOrder.map((id, index) => <span key={id}><b>{index + 1}</b>{getPlayer(state, id).displayName}</span>)}
            </div>
            <footer><button type="button" onClick={restart}>再开一局</button><button type="button" onClick={onExit}>返回大厅</button></footer>
          </div>
        </div>
      )}
    </main>
  );
}
