import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { GameRuntimeProps } from "../../core/games/types";
import { useSound } from "../../shared/audio/SoundProvider";
import { playbackDelay, usePlaybackSpeed } from "../../shared/settings/usePlaybackSpeed";
import { useModalFocus } from "../../shared/ui/useModalFocus";
import { GuandanCardView } from "./components/GuandanCardView";
import { chooseAiMove } from "./domain/ai";
import {
  GUANDAN_DIFFICULTY_NAMES,
  NUMBER_RANKS,
  canPass,
  changeDifficulty,
  classifyCombo,
  createInitialState,
  getPlayError,
  getPlayer,
  passTurn,
  playCards,
  startNextDeal,
  teamName,
} from "./domain/engine";
import { GUANDAN_SAVE_SCHEMA_VERSION, restoreGuandanState, serializeGuandanState } from "./domain/persistence";
import type { AiMove, GuandanDifficulty, GuandanPlayer, GuandanState, PlayerId } from "./domain/types";
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

function applyMove(state: GuandanState, actorId: PlayerId, move: AiMove | undefined) {
  if (!move) return state;
  return move.kind === "play"
    ? playCards(state, actorId, move.cardIds)
    : passTurn(state, actorId);
}

const DIFFICULTY_OPTIONS: ReadonlyArray<{ id: GuandanDifficulty; description: string }> = [
  { id: "relaxed", description: "AI 偶尔保守，给你留出拆牌与练手的空间。" },
  { id: "standard", description: "按基础牌力出牌，跟最小能压的牌并保留炸弹。" },
  { id: "tactician", description: "保护百搭、规划收尾，只在必要时拆炸弹。" },
];

export function GuandanGame({ onExit, persistence }: GameRuntimeProps) {
  const restored = useMemo(
    () => persistence?.restored && persistence.restored.schemaVersion === GUANDAN_SAVE_SCHEMA_VERSION
      ? restoreGuandanState(persistence.restored.data)
      : undefined,
    [persistence],
  );
  const [state, setState] = useState(() => restored ?? createInitialState());
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [showRules, setShowRules] = useState(restored === undefined);
  const [showLog, setShowLog] = useState(false);
  const [autoPilot, setAutoPilot] = useState(false);
  const [hintText, setHintText] = useState<string>();
  const { enabled: soundEnabled, toggle: toggleSound, play: playSound } = useSound();
  const { speed: playbackSpeed, cycle: cyclePlaybackSpeed } = usePlaybackSpeed();

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
  // Derived, not stored: a seat is thinking exactly while its move is pending.
  const automate = state.status === "playing"
    && (active.controller === "ai" || (active.id === "human" && autoPilot));
  const aiThinking = automate && !showRules && !showLog;
  const playError = selectedIds.length > 0 ? getPlayError(state, "human", selectedIds) : undefined;
  const handMidpoint = Math.ceil(human.hand.length / 2);
  const handRows = [human.hand.slice(0, handMidpoint), human.hand.slice(handMidpoint)];

  useEffect(() => {
    if (!aiThinking) return;

    const expectedRevision = state.revision;
    const expectedActor = state.activePlayerId;
    const timer = window.setTimeout(() => {
      // Decided once and reused: scanning a 27-card hand for legal combos is the
      // most expensive thing this table does per turn.
      const move = chooseAiMove(state, expectedActor, state.difficulty);
      setState((current) => {
        if (current.revision !== expectedRevision || current.activePlayerId !== expectedActor) return current;
        return applyMove(current, expectedActor, move);
      });
      playSound(move?.kind === "play" ? "card" : "tap");
      setSelectedIds([]);
      setHintText(undefined);
    }, playbackDelay(460, playbackSpeed));
    return () => window.clearTimeout(timer);
  }, [aiThinking, playSound, playbackSpeed, state]);

  useEffect(() => {
    if (state.status === "finished") playSound(state.winner === human.team ? "win" : "tap");
  }, [human.team, playSound, state.status, state.winner]);

  // 连续升级对局跨刷新存续：下一局、级别与胜负都随状态落盘；
  // 只有整场打过 A（或玩家主动再来一场）才清除旧档。
  useEffect(() => {
    if (!persistence) return;
    if (state.match.champion) {
      persistence.clear();
      return;
    }
    // 没有任何进展（revision 0）且此前没有存档时不落盘：避免把
    // 「进过牌桌但什么都没做」也当作可续玩的对局。下一局与再来一场
    // 产生的新局在有旧档时会在这里直接覆盖它。
    if (state.revision === 0 && !persistence.restored) return;
    persistence.save(GUANDAN_SAVE_SCHEMA_VERSION, state.revision, serializeGuandanState(state));
  }, [persistence, state]);

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
    const suggestion = chooseAiMove(state, "human", "tactician");
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

  function moveHandFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;

    const cards = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button.gd-card"));
    const currentIndex = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (event.key === "ArrowLeft") nextIndex -= 1;
    if (event.key === "ArrowRight") nextIndex += 1;
    if (event.key === "ArrowUp") nextIndex -= handMidpoint;
    if (event.key === "ArrowDown") nextIndex += handMidpoint;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = cards.length - 1;

    nextIndex = Math.max(0, Math.min(cards.length - 1, nextIndex));
    if (nextIndex === currentIndex) return;

    event.preventDefault();
    cards[nextIndex].focus({ preventScroll: true });
  }

  function clearTurnUi() {
    setSelectedIds([]);
    setHintText(undefined);
  }

  function nextDeal() {
    setState((current) => startNextDeal(current));
    clearTurnUi();
    playSound("card");
  }

  function restart() {
    setState(createInitialState(Math.random, state.difficulty));
    setAutoPilot(false);
    clearTurnUi();
    playSound("card");
  }

  function chooseDifficulty(difficulty: GuandanDifficulty) {
    setState((current) => changeDifficulty(current, difficulty));
    playSound("tap");
  }

  const tableMessage = aiThinking
    ? `${active.displayName}正在理牌…`
    : state.lastAction?.text ?? "等待出牌。";
  const opposingPlayers = state.players.filter((player) => player.id === "east" || player.id === "west");
  const partner = getPlayer(state, "partner");
  const match = state.match;
  const dealResult = match.lastResult;
  const champion = match.champion;
  const resultWon = state.winner === human.team;
  const rulesModalRef = useModalFocus({
    active: showRules,
    initialFocus: ".gd-rule-board__enter",
    onDismiss: () => setShowRules(false),
  });
  const resultModalRef = useModalFocus({
    active: state.status === "finished" && Boolean(state.winner) && !showRules,
    initialFocus: ".gd-result-board footer button",
  });

  return (
    <main className="guandan-screen">
      <header className="guandan-topbar">
        <button type="button" className="gd-round-button" onClick={onExit} aria-label="返回游戏大厅">←</button>
        <div className="guandan-title">
          <small>CARDFORGE · TABLE 003</small>
          <strong>掼蛋 · 升级赛</strong>
        </div>
        <div className="guandan-tools">
          <button type="button" onClick={() => setShowRules(true)} aria-label="查看规则">?</button>
          <button type="button" onClick={() => setShowLog((value) => !value)} aria-label="查看牌局记录">≡</button>
          <button type="button" onClick={cyclePlaybackSpeed} aria-label={`AI 速度 ${playbackSpeed}×`} title={`AI 速度 ${playbackSpeed}×`}>{playbackSpeed}×</button>
          <button type="button" onClick={toggleSound} aria-label={soundEnabled ? "关闭声音" : "开启声音"}>{soundEnabled ? "♪" : "×"}</button>
        </div>
      </header>

      <div
        className="gd-level-rail"
        aria-label={`第 ${match.dealNumber} 局，打 ${teamName(match.attackingTeam)}的 ${state.levelRank}。朱雀方 ${match.levels.vermillion} 级，青岳方 ${match.levels.indigo} 级`}
      >
        <span>第 {match.dealNumber} 局 · 逢人配 ♥{state.levelRank}</span>
        <div>{NUMBER_RANKS.map((rank) => <i key={rank} className={rank === state.levelRank ? "is-level" : ""}>{rank}</i>)}</div>
        <strong className="gd-match-score">
          {(["vermillion", "indigo"] as const).map((team) => (
            <b
              key={team}
              className={`gd-match-score__team gd-match-score__team--${team} ${match.attackingTeam === team ? "is-attacking" : ""}`}
            >
              {team === "vermillion" ? "朱" : "青"}<i>{match.levels[team]}</i>
            </b>
          ))}
        </strong>
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

      <section className="gd-hand-dock" aria-label="你的手牌" aria-describedby="gd-hand-keyboard-hint">
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

        <span id="gd-hand-keyboard-hint" className="visually-hidden">使用方向键浏览手牌，按空格键选择。</span>
        <div className="gd-hand-rows" onKeyDown={moveHandFocus}>
          {handRows.map((row, rowIndex) => (
            <div className="gd-hand-row" key={rowIndex}>
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
        <div ref={rulesModalRef} className="gd-modal" role="dialog" aria-modal="true" aria-labelledby="gd-rules-title" tabIndex={-1}>
          <div className="gd-rule-board">
            <button type="button" className="gd-rule-board__close" onClick={() => setShowRules(false)} aria-label="关闭规则">×</button>
            <span className="gd-rule-board__ribbon">升级赛</span>
            <small>四人 · 对家 · 双副牌</small>
            <h2 id="gd-rules-title">不是一个人跑得快，<br />是两个人走得远。</h2>
            <p>你与上方对家同队。轮流打出同型且更大的牌；其余三家都过牌后，由上一手玩家重新领出。</p>
            <div className="gd-rule-types">
              <span><b>单 / 对 / 三</b><i>同牌型比点数</i></span>
              <span><b>三带二 / 五张顺</b><i>按三张或顺子顶张比较</i></span>
              <span><b>四张起炸</b><i>可压普通牌型，张数优先</i></span>
              <span><b>红心 {state.levelRank}</b><i>本局百搭“逢人配”</i></span>
            </div>
            <p>
              升级看头游那一队：队友第 2 名升 3 级，第 3 名升 2 级，第 4 名升 1 级。
              双方各自从 2 起打，先在 A 上再赢一局的一方打过 A，赢下整场。
            </p>
            <p className="gd-rule-board__scope">
              暂不包含进贡还贡、木板/钢板和同花顺炸弹。本局惯例：两张相同的王可作对子；级牌大于 A、小于小王；A2345 是最小顺子。
            </p>
            <div className="gd-difficulty" role="radiogroup" aria-label="对手难度">
              <small>对手难度 · 对当前及后续牌局生效</small>
              <div>
                {DIFFICULTY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={state.difficulty === option.id}
                    className={state.difficulty === option.id ? "is-selected" : ""}
                    onClick={() => chooseDifficulty(option.id)}
                  >
                    <strong>{GUANDAN_DIFFICULTY_NAMES[option.id]}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="gd-rule-board__enter" onClick={() => { setShowRules(false); playSound("card"); }}>入席开牌 <span>→</span></button>
          </div>
        </div>
      )}

      {state.status === "finished" && state.winner && dealResult && !showRules && (
        <div ref={resultModalRef} className="gd-modal gd-modal--result" role="dialog" aria-modal="true" aria-labelledby="gd-result-title" tabIndex={-1}>
          <div className={`gd-result-board gd-result-board--${state.winner}`}>
            <span className="gd-result-board__seal" aria-hidden="true">{resultWon ? "贯" : "再"}</span>
            <small>
              {champion ? "整场结束" : `第 ${match.dealNumber} 局 · ${teamName(state.winner)}获胜`}
            </small>
            <h2 id="gd-result-title">
              {champion
                ? (resultWon ? "打过 A，赢下整场" : "对手先打过了 A")
                : (dealResult.partnerPlace <= 2
                  ? (resultWon ? "双下，直升三级" : "被对手双下")
                  : (resultWon ? "拿下本局" : "本局失守"))}
            </h2>

            <div className="gd-level-gain">
              {champion
                ? <span className="is-target"><small>{teamName(dealResult.winner)}</small><b>打过 A</b></span>
                : <>
                    <span><small>{teamName(dealResult.winner)}</small><b>{dealResult.fromLevel}</b></span>
                    <i aria-hidden="true">→</i>
                    <span className="is-target"><small>升 {dealResult.gained} 级</small><b>{dealResult.toLevel}</b></span>
                  </>}
            </div>

            <p>
              {champion
                ? (resultWon ? "从 2 一路打到 A，这一场收官。" : "对手率先打过 A。再来一场，换个节奏。")
                : `头游${getPlayer(state, dealResult.finishOrder[0]).displayName}，队友第 ${dealResult.partnerPlace} 名。下一局由头游先领出。`}
            </p>

            <div className="gd-finish-order">
              {state.finishOrder.map((id, index) => <span key={id}><b>{index + 1}</b>{getPlayer(state, id).displayName}</span>)}
            </div>

            <footer>
              {champion
                ? <button type="button" onClick={restart}>再来一场</button>
                : <button type="button" onClick={nextDeal}>下一局 <span aria-hidden="true">→</span></button>}
              <button type="button" onClick={onExit}>返回大厅</button>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}
