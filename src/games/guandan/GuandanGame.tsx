import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { GameRuntimeProps } from "../../core/games/types";
import { useSound } from "../../shared/audio/SoundProvider";
import { playbackDelay, usePlaybackSpeed } from "../../shared/settings/usePlaybackSpeed";
import {
  Dialog,
  GameShell,
  GameTopBar,
  ToolMenu,
  type GameToolAction,
} from "../../shared/ui/GameShell";
import { GuandanCardView } from "./components/GuandanCardView";
import { chooseAiMove, getAiThinkingDuration } from "./domain/ai";
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

const MIN_AI_PRESENTATION_MS = 600;

function Seat({ player, active, lastActorId }: { player: GuandanPlayer; active: boolean; lastActorId?: PlayerId }) {
  const seatStatus = player.finishedPlace
    ? `第 ${player.finishedPlace} 名完成`
    : active
      ? "正在行动"
      : "等待行动";

  return (
    <div
      className={`gd-seat gd-seat--${player.id} gd-seat--${player.team} ${active ? "is-active" : ""}`}
      role="group"
      aria-label={`${player.displayName}，${player.team === "vermillion" ? "朱雀方" : "青岳方"}，剩余 ${player.hand.length} 张，${seatStatus}`}
    >
      <span className="gd-seat__avatar" aria-hidden="true">{player.displayName.slice(0, 1)}</span>
      <span className="gd-seat__copy">
        <small>{player.team === "vermillion" ? "朱雀方" : "青岳方"}</small>
        <strong>{player.displayName}</strong>
      </span>
      <span className="gd-seat__count">{player.hand.length}<small>张</small></span>
      {player.finishedPlace && <b className="gd-seat__place">第 {player.finishedPlace} 名</b>}
      {lastActorId === player.id && <i className="gd-seat__pulse" aria-hidden="true" />}
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
  const unreadableRestoredSave = Boolean(persistence?.restored && !restored);
  const [state, setState] = useState(() => restored ?? createInitialState());
  const [saveBlocked, setSaveBlocked] = useState(unreadableRestoredSave);
  const [saveUnavailable, setSaveUnavailable] = useState(false);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [preferredHandTabStopId, setPreferredHandTabStopId] = useState<string>();
  const [showRules, setShowRules] = useState(restored === undefined);
  const [showLog, setShowLog] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [autoPilot, setAutoPilot] = useState(false);
  const [hintText, setHintText] = useState<string>();
  const stateRef = useRef(state);
  const handRowsRef = useRef<HTMLDivElement>(null);
  const restoreHandFocus = useRef(false);
  const automationGeneration = useRef(0);
  const { enabled: soundEnabled, toggle: toggleSound, play: playSound } = useSound();
  const { speed: playbackSpeed, cycle: cyclePlaybackSpeed } = usePlaybackSpeed();

  const human = getPlayer(state, "human");
  const active = getPlayer(state, state.activePlayerId);
  const handTabStopId = human.hand.some((card) => card.id === preferredHandTabStopId)
    ? preferredHandTabStopId
    : human.hand[0]?.id;
  const selectedCards = useMemo(
    () => human.hand.filter((card) => selectedIds.includes(card.id)),
    [human.hand, selectedIds],
  );
  const selectedCombo = useMemo(
    () => classifyCombo(selectedCards, state.levelRank),
    [selectedCards, state.levelRank],
  );
  const informationOpen = showRules || showLog || showTools;
  const humanCanAct = state.status === "playing"
    && state.activePlayerId === "human"
    && !autoPilot
    && !informationOpen;
  const automate = state.status === "playing"
    && (active.controller === "ai" || (active.id === "human" && autoPilot));
  const aiThinking = automate && !informationOpen;
  const playError = selectedIds.length > 0 ? getPlayError(state, "human", selectedIds) : undefined;
  const handMidpoint = Math.ceil(human.hand.length / 2);
  const handRows = [human.hand.slice(0, handMidpoint), human.hand.slice(handMidpoint)];

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!hintText || selectedIds.length === 0) return;
    const firstSelected = handRowsRef.current?.querySelector<HTMLElement>('button.gd-card[aria-pressed="true"]');
    firstSelected?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [hintText, selectedIds]);

  useEffect(() => {
    if (state.status === "finished") {
      restoreHandFocus.current = false;
      return;
    }
    if (!humanCanAct || !restoreHandFocus.current) return;
    const focused = document.activeElement;
    const focusWasLost = focused === document.body
      || focused === document.documentElement
      || (focused instanceof HTMLButtonElement && focused.disabled);
    if (focusWasLost) {
      handRowsRef.current?.querySelector<HTMLButtonElement>("button.gd-card:not(:disabled)")?.focus();
    }
    restoreHandFocus.current = false;
  }, [humanCanAct, state.status]);

  useEffect(() => {
    if (!aiThinking) return;

    const scheduledState = state;
    const expectedActor = state.activePlayerId;
    const generation = automationGeneration.current + 1;
    automationGeneration.current = generation;
    const thinkingDelay = Math.max(
      MIN_AI_PRESENTATION_MS,
      playbackDelay(getAiThinkingDuration(state, expectedActor), playbackSpeed),
    );
    const timer = window.setTimeout(() => {
      if (automationGeneration.current !== generation || stateRef.current !== scheduledState) return;
      const move = chooseAiMove(scheduledState, expectedActor, scheduledState.difficulty);
      if (automationGeneration.current !== generation || stateRef.current !== scheduledState) return;
      const nextState = applyMove(scheduledState, expectedActor, move);
      if (nextState === scheduledState) return;
      stateRef.current = nextState;
      setState(nextState);
      playSound(move?.kind === "play" ? "card" : "tap");
      setSelectedIds([]);
      setHintText(undefined);
    }, thinkingDelay);
    return () => {
      window.clearTimeout(timer);
      if (automationGeneration.current === generation) automationGeneration.current += 1;
    };
  }, [aiThinking, playSound, playbackSpeed, state]);

  useEffect(() => {
    if (state.status === "finished") playSound(state.winner === human.team ? "win" : "tap");
  }, [human.team, playSound, state.status, state.winner]);

  useEffect(() => {
    if (!persistence || saveBlocked) return;
    if (state.match.champion) {
      persistence.clear();
      return;
    }
    if (state.revision === 0 && !persistence.restored) return;
    const saved = persistence.save(GUANDAN_SAVE_SCHEMA_VERSION, state.revision, serializeGuandanState(state));
    if (saved) {
      const timer = window.setTimeout(() => setSaveUnavailable(false), 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setSaveUnavailable(true), 0);
    return () => window.clearTimeout(timer);
  }, [persistence, saveBlocked, state]);

  function resetUnreadableSave() {
    persistence?.clear();
    setSaveBlocked(false);
    setSaveUnavailable(false);
    playSound("tap");
  }

  function toggleCard(id: string) {
    if (!humanCanAct) return;
    setPreferredHandTabStopId(id);
    setSelectedIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
    setHintText(undefined);
    playSound("tap");
  }

  function playSelection() {
    if (!humanCanAct || playError || selectedIds.length === 0) return;
    restoreHandFocus.current = Boolean((document.activeElement as HTMLElement | null)?.closest(".gd-hand-dock"));
    setPreferredHandTabStopId(undefined);
    setState((current) => playCards(current, "human", selectedIds));
    setSelectedIds([]);
    setHintText(undefined);
    playSound(selectedCombo?.type === "bomb" ? "hit" : "card");
  }

  function pass() {
    if (!humanCanAct || !canPass(state, "human")) return;
    restoreHandFocus.current = Boolean((document.activeElement as HTMLElement | null)?.closest(".gd-hand-dock"));
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

    const cards = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button.gd-card:not(:disabled)"));
    const currentIndex = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (event.key === "ArrowLeft") nextIndex -= 1;
    if (event.key === "ArrowRight") nextIndex += 1;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const currentCard = cards[currentIndex];
      const currentRow = currentCard.closest<HTMLElement>(".gd-hand-row");
      const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(".gd-hand-row"));
      if (!currentRow) return;

      const rowCenter = (row: HTMLElement) => {
        const rect = row.getBoundingClientRect();
        return rect.top + rect.height / 2;
      };
      const currentRowCenter = rowCenter(currentRow);
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const targetRow = rows
        .filter((row) => (rowCenter(row) - currentRowCenter) * direction > 4)
        .sort((left, right) => (
          Math.abs(rowCenter(left) - currentRowCenter) - Math.abs(rowCenter(right) - currentRowCenter)
        ))[0];
      if (!targetRow) return;

      const currentRect = currentCard.getBoundingClientRect();
      const currentCenter = currentRect.left + currentRect.width / 2;
      const targetCards = cards.filter((card) => card.closest(".gd-hand-row") === targetRow);
      const targetCard = targetCards.sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return Math.abs(leftRect.left + leftRect.width / 2 - currentCenter)
          - Math.abs(rightRect.left + rightRect.width / 2 - currentCenter);
      })[0];
      nextIndex = targetCard ? cards.indexOf(targetCard) : currentIndex;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = cards.length - 1;

    nextIndex = Math.max(0, Math.min(cards.length - 1, nextIndex));
    if (nextIndex === currentIndex) return;

    event.preventDefault();
    setPreferredHandTabStopId(cards[nextIndex].dataset.cardId);
    cards[nextIndex].focus();
  }

  function clearTurnUi() {
    setSelectedIds([]);
    setHintText(undefined);
  }

  function nextDeal() {
    setPreferredHandTabStopId(undefined);
    setState((current) => startNextDeal(current));
    clearTurnUi();
    playSound("card");
  }

  function restart() {
    setPreferredHandTabStopId(undefined);
    setState(createInitialState(Math.random, state.difficulty));
    setAutoPilot(false);
    clearTurnUi();
    playSound("card");
  }

  function chooseDifficulty(difficulty: GuandanDifficulty) {
    setState((current) => changeDifficulty(current, difficulty));
    playSound("tap");
  }

  const saveWarning = saveBlocked
    ? "现有存档无法安全读取，本次不会覆盖它。"
    : saveUnavailable
      ? "本机存档不可用，本次进度只在当前页面保留。"
      : undefined;
  const tableMessage = aiThinking
    ? active.id === "human" && autoPilot ? "托管正在替你出牌" : `${active.displayName}思考中`
    : state.lastAction?.text ?? "等待出牌。";
  const opposingPlayers = state.players.filter((player) => player.id === "east" || player.id === "west");
  const partner = getPlayer(state, "partner");
  const match = state.match;
  const dealResult = match.lastResult;
  const champion = match.champion;
  const resultWon = state.winner === human.team;
  const resultOpen = state.status === "finished" && Boolean(state.winner) && Boolean(dealResult) && !showRules;
  const overlayOpen = informationOpen || resultOpen;
  const canClearSelection = humanCanAct && selectedIds.length > 0;
  const playActionLabel = selectedCombo ? `出${selectedCombo.label} · ${selectedIds.length} 张` : "出牌";
  const gameStatus = state.status === "finished"
    ? "本局已结束"
    : informationOpen
      ? "牌局已暂停 · 关闭面板继续"
      : aiThinking
        ? active.id === "human" && autoPilot ? "托管正在替你思考" : `${active.displayName}思考中`
        : state.activePlayerId === "human"
          ? "轮到你出牌"
          : `${active.displayName}的行动`;
  const statusText = saveBlocked
    ? `旧存档未读取 · ${gameStatus}`
    : saveUnavailable
      ? `本机存档不可用 · ${gameStatus}`
      : gameStatus;

  const toolActions: readonly GameToolAction[] = [
    {
      id: "log",
      label: "查看牌局记录",
      description: "查看本局最近行动",
      icon: "≡",
      onSelect: () => setShowLog(true),
    },
    {
      id: "rules",
      label: "查看规则",
      description: "牌型、升级与本桌惯例",
      icon: "?",
      onSelect: () => setShowRules(true),
    },
    {
      id: "speed",
      label: `AI 节奏 · ${playbackSpeed}×`,
      description: "切换行动演出速度",
      icon: `${playbackSpeed}×`,
      onSelect: cyclePlaybackSpeed,
    },
    {
      id: "sound",
      label: soundEnabled ? "声音 · 开" : "声音 · 关",
      description: soundEnabled ? "点击关闭牌桌声音" : "点击开启牌桌声音",
      icon: soundEnabled ? "♪" : "静",
      pressed: soundEnabled,
      onSelect: toggleSound,
    },
  ];

  const gameOverlay = (
    <>
      <ToolMenu open={showTools} title="牌桌选项" actions={toolActions} onClose={() => setShowTools(false)}>
        {saveWarning && (
          <div className="gd-save-warning gd-save-warning--menu" role="alert">
            <span>{saveWarning}</span>
            {saveBlocked && <button type="button" onClick={resetUnreadableSave}>重置旧存档并启用保存</button>}
          </div>
        )}
      </ToolMenu>

      <Dialog
        open={showLog}
        title="牌局记录"
        className="gd-log-dialog"
        onClose={() => setShowLog(false)}
        closeLabel="关闭牌局记录"
        restoreFocus=".cf-game-topbar__more"
      >
        <ol className="gd-log-list">
          {[...state.log].reverse().map((entry) => (
            <li key={entry.id}><small>#{String(entry.id).padStart(2, "0")}</small><span>{entry.text}</span></li>
          ))}
        </ol>
      </Dialog>

      <Dialog
        open={showRules}
        title="掼蛋 · 升级赛"
        className="gd-rule-dialog"
        onClose={() => setShowRules(false)}
        closeLabel="关闭规则"
        initialFocus=".gd-rule-board__enter"
        restoreFocus=".cf-game-topbar__more"
        footer={(
          <button
            type="button"
            className="gd-rule-board__enter"
            onClick={() => { setShowRules(false); playSound("card"); }}
          >
            入席开牌
          </button>
        )}
      >
        <div className="gd-rule-board">
          <p className="gd-rule-board__lead">你与上方对家同队。轮流打出同型且更大的牌；其余三家都过牌后，由上一手玩家重新领出。</p>
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
          {saveWarning && (
            <div className="gd-save-warning gd-save-warning--inline" role="alert">
              <span>{saveWarning}</span>
              {saveBlocked && <button type="button" onClick={resetUnreadableSave}>重置旧存档并启用保存</button>}
            </div>
          )}
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
        </div>
      </Dialog>

      {state.winner && dealResult && (
        <Dialog
          open={resultOpen}
          title={champion
            ? (resultWon ? "打过 A，赢下整场" : "对手先打过了 A")
            : (dealResult.partnerPlace <= 2
              ? (resultWon ? "双下，直升三级" : "被对手双下")
              : (resultWon ? "拿下本局" : "本局失守"))}
          className="gd-result-dialog"
          role="alertdialog"
          dismissOnBackdrop={false}
          initialFocus=".gd-result-actions button"
          footer={(
            <div className="gd-result-actions">
              {champion
                ? <button type="button" onClick={restart}>再来一场</button>
                : <button type="button" onClick={nextDeal}>下一局</button>}
              <button type="button" className="is-secondary" onClick={onExit}>返回大厅</button>
            </div>
          )}
        >
          <div className="gd-result-board">
            <small>{champion ? "整场结束" : `第 ${match.dealNumber} 局 · ${teamName(state.winner)}获胜`}</small>
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
          </div>
        </Dialog>
      )}
    </>
  );

  return (
    <GameShell
      className="guandan-screen"
      contentClassName="gd-table-content"
      topBar={(
        <GameTopBar
          className="guandan-topbar"
          title="掼蛋"
          subtitle={`升级赛 · 第 ${match.dealNumber} 局 · 打 ${state.levelRank}`}
          onBack={onExit}
          backLabel="返回游戏大厅"
          actions={toolActions.slice(0, 2)}
          onMore={() => setShowTools(true)}
          moreOpen={showTools}
          moreLabel="更多选项"
        />
      )}
      status={<span className={informationOpen ? "gd-game-status is-paused" : "gd-game-status"}>{statusText}</span>}
      overlayActive={overlayOpen}
      overlay={gameOverlay}
      actionDockClassName="gd-hand-dock"
      actionDockLabel="你的手牌"
      actionDock={(
        <>
          <header className="gd-hand-heading">
            <span><strong>你的手牌 <i>{human.hand.length}</i></strong><small>朱雀方 · 南座</small></span>
            <span
              className={`gd-selection-status ${playError ? "is-error" : ""}`}
              aria-live="polite"
              aria-atomic="true"
            >
              {hintText ?? (selectedIds.length === 0 ? "点选牌面组成牌型" : playError ?? `${selectedCombo?.label ?? "已选"} · ${selectedIds.length} 张`)}
            </span>
            <button
              type="button"
              className={`gd-autoplay ${autoPilot ? "is-on" : ""}`}
              aria-pressed={autoPilot}
              onClick={() => {
                setAutoPilot((value) => !value);
                clearTurnUi();
                playSound("tap");
              }}
            >
              {autoPilot ? "停止托管" : "托管"}
            </button>
          </header>

          <span id="gd-hand-keyboard-hint" className="visually-hidden">使用方向键浏览手牌，按空格键选择。每排手牌可以横向滚动。</span>
          <div ref={handRowsRef} className="gd-hand-rows" onKeyDown={moveHandFocus} aria-describedby="gd-hand-keyboard-hint">
            {handRows.map((row, rowIndex) => (
              <div className="gd-hand-row" key={rowIndex} role="group" aria-label={`第 ${rowIndex + 1} 排手牌`}>
                {row.map((card) => (
                  <GuandanCardView
                    key={card.id}
                    card={card}
                    levelRank={state.levelRank}
                    selectable
                    disabled={!humanCanAct}
                    tabIndex={card.id === handTabStopId ? 0 : -1}
                    selected={selectedIds.includes(card.id)}
                    onSelect={toggleCard}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="gd-actions">
            <button type="button" className="gd-action" onClick={suggest} disabled={!humanCanAct}>提示</button>
            <button
              type="button"
              className="gd-action"
              onClick={() => { clearTurnUi(); playSound("tap"); }}
              disabled={!canClearSelection}
            >
              清空
            </button>
            <button type="button" className="gd-action" onClick={pass} disabled={!humanCanAct || !canPass(state, "human")}>过牌</button>
            <button type="button" className="gd-action gd-action--play" onClick={playSelection} disabled={!humanCanAct || Boolean(playError) || selectedIds.length === 0}>
              {playActionLabel}
            </button>
          </div>
        </>
      )}
    >
      <div
        className="gd-level-rail"
        role="group"
        aria-label={`第 ${match.dealNumber} 局，打 ${teamName(match.attackingTeam)}的 ${state.levelRank}。朱雀方 ${match.levels.vermillion} 级，青岳方 ${match.levels.indigo} 级`}
      >
        <span>第 {match.dealNumber} 局 · 逢人配 ♥{state.levelRank}</span>
        <div className="gd-level-track" aria-hidden="true">
          {NUMBER_RANKS.map((rank) => <i key={rank} className={rank === state.levelRank ? "is-level" : ""}>{rank}</i>)}
        </div>
        <strong className="gd-match-score">
          {(["vermillion", "indigo"] as const).map((team) => (
            <b
              key={team}
              className={`gd-match-score__team gd-match-score__team--${team} ${match.attackingTeam === team ? "is-attacking" : ""}`}
            >
              {team === "vermillion" ? "朱雀" : "青岳"}<i>{match.levels[team]}</i>
            </b>
          ))}
        </strong>
      </div>

      <section className="gd-arena" aria-label="四人掼蛋牌桌">
        <Seat
          player={partner}
          active={state.activePlayerId === partner.id}
          lastActorId={state.lastAction?.actorId === "table" ? undefined : state.lastAction?.actorId}
        />
        {opposingPlayers.map((player) => (
          <Seat
            key={player.id}
            player={player}
            active={state.activePlayerId === player.id}
            lastActorId={state.lastAction?.actorId === "table" ? undefined : state.lastAction?.actorId}
          />
        ))}

        <div
          className={`gd-trick ${state.trick?.combo.type === "bomb" ? "is-bomb" : ""}`}
          role="group"
          aria-label="当前牌墩"
          aria-busy={aiThinking}
        >
          <header>
            <span><small>当前牌墩</small><strong>{state.trick?.combo.label ?? "等待领出"}</strong></span>
            {state.trick && <b>{getPlayer(state, state.trick.actorId).displayName} · {state.trick.combo.cards.length} 张</b>}
          </header>
          <div className="gd-trick__cards">
            {state.trick ? state.trick.combo.cards.map((card) => (
              <GuandanCardView key={card.id} card={card} levelRank={state.levelRank} compact />
            )) : <span className="gd-trick__empty">暂无出牌</span>}
          </div>
          <p key={state.revision} className={aiThinking ? "is-thinking" : undefined}>
            {tableMessage}
            {aiThinking && <span className="gd-thinking-dots" aria-hidden="true"><i /><i /><i /></span>}
          </p>
        </div>

        <div className={`gd-turn-flag gd-turn-flag--${active.team}`}>
          <i aria-hidden="true" />
          <span>{state.status === "finished" ? "牌局结束" : `${active.displayName}的行动`}</span>
        </div>
      </section>
    </GameShell>
  );
}
