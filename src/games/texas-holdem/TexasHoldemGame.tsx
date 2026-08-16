import { useEffect, useMemo, useRef, useState } from "react";
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
import { PokerCardView } from "./components/PokerCardView";
import { chooseTexasBotAction } from "./domain/ai";
import {
  applyTexasAction,
  createTexasState,
  getTexasLegalActions,
  getTexasPotSize,
  startNextTexasHand,
  streetName,
} from "./domain/engine";
import { evaluateTexasHand } from "./domain/evaluator";
import { buildTexasObservation } from "./domain/observation";
import type {
  TexasLegalActions,
  TexasPlayer,
  TexasPlayerAction,
  TexasState,
} from "./domain/types";
import {
  TEXAS_HOLDEM_SAVE_SCHEMA_VERSION,
  restoreTexasState,
  serializeTexasState,
} from "./persistence";
import "./texas-holdem.css";

const AI_THINKING_MIN_MS = 900;
const AI_THINKING_SPREAD_MS = 601;

interface RaiseDraft {
  readonly revision: number;
  readonly amount: number;
  readonly open: boolean;
}

interface RaisePreset {
  readonly label: string;
  readonly amount: number;
  readonly disabled: boolean;
}

function aiThinkingDuration(state: TexasState): number {
  const mixed = Math.abs(Math.imul(state.revision + 17, 83) + Math.imul(state.handNumber, 137));
  return AI_THINKING_MIN_MS + mixed % AI_THINKING_SPREAD_MS;
}

function roundedToBlind(value: number, blind: number): number {
  return Math.ceil(value / blind) * blind;
}

function raisePresetOptions(state: TexasState, legal: TexasLegalActions): readonly RaisePreset[] {
  if (legal.raisePresets.length === 0) return [];
  if (legal.minRaiseTo === undefined) {
    return [{ label: "全下", amount: legal.maxRaiseTo, disabled: !legal.raisePresets.includes(legal.maxRaiseTo) }];
  }

  const pot = getTexasPotSize(state);
  const minimum = legal.minRaiseTo;
  const halfPot = roundedToBlind(
    Math.max(minimum, state.currentBet + Math.max(state.bigBlind, Math.floor(pot / 2))),
    state.bigBlind,
  );
  const fullPot = roundedToBlind(
    Math.max(minimum, state.currentBet + Math.max(state.bigBlind, pot)),
    state.bigBlind,
  );
  return [
    { label: "最小", amount: minimum, disabled: !legal.raisePresets.includes(minimum) },
    { label: "半池", amount: halfPot, disabled: !legal.raisePresets.includes(halfPot) },
    { label: "满池", amount: fullPot, disabled: !legal.raisePresets.includes(fullPot) },
    { label: "全下", amount: legal.maxRaiseTo, disabled: !legal.raisePresets.includes(legal.maxRaiseTo) },
  ];
}

function clampRaise(value: number, floor: number, ceiling: number): number {
  return Math.max(floor, Math.min(ceiling, Math.round(value)));
}

function blindLabel(player: TexasPlayer, dealerId: TexasPlayer["id"]): string {
  return player.id === dealerId ? "D · 小盲" : "大盲";
}

function TableSeat({
  player,
  dealerId,
  active,
  thinking = false,
  revealHole,
  handLabel,
  winner,
  emphasizedIds,
  opponent = false,
}: {
  readonly player: TexasPlayer;
  readonly dealerId: TexasPlayer["id"];
  readonly active: boolean;
  readonly thinking?: boolean;
  readonly revealHole: boolean;
  readonly handLabel?: string;
  readonly winner: boolean;
  readonly emphasizedIds: ReadonlySet<string>;
  readonly opponent?: boolean;
}) {
  const stateText = player.folded
    ? "已弃牌"
    : player.allIn
      ? "已全下"
      : active
        ? thinking ? "思考中" : "行动中"
        : "等待";
  return (
    <section
      className={`holdem-seat ${opponent ? "holdem-seat--opponent" : "holdem-seat--human"} ${active ? "is-active" : ""} ${winner ? "is-winner" : ""} ${player.folded ? "is-folded" : ""}`}
      aria-label={`${player.displayName}，${blindLabel(player, dealerId)}，筹码 ${player.stack}，本轮投入 ${player.streetCommitted}，${stateText}`}
    >
      <div className="holdem-seat__identity">
        <span className="holdem-seat__avatar" aria-hidden="true">{opponent ? "AI" : "你"}</span>
        <span className="holdem-seat__copy">
          <small>{blindLabel(player, dealerId)}</small>
          <strong>{player.displayName}</strong>
        </span>
        <span className="holdem-seat__chips"><b>{player.stack}</b><small>筹码</small></span>
      </div>

      <div className="holdem-seat__cards" aria-label={`${player.displayName}的两张底牌`}>
        {player.hole.map((card, index) => (
          revealHole
            ? <PokerCardView key={card.id} card={card} compact={opponent} emphasized={emphasizedIds.has(card.id)} />
            : <PokerCardView key={`concealed-${index}`} concealed compact />
        ))}
      </div>

      <div className="holdem-seat__state" aria-live={active ? "polite" : "off"}>
        <span className={thinking ? "is-thinking" : undefined}>
          {stateText}
          {thinking && <i className="holdem-thinking-dots" aria-hidden="true"><b /><b /><b /></i>}
        </span>
        {player.streetCommitted > 0 && <b>桌面 {player.streetCommitted}</b>}
        {handLabel && <em>{handLabel}</em>}
      </div>
    </section>
  );
}

export function TexasHoldemGame({ onExit, persistence }: GameRuntimeProps) {
  const restored = useMemo(
    () => persistence?.restored
      ? restoreTexasState(persistence.restored.schemaVersion, persistence.restored.data)
      : undefined,
    [persistence],
  );
  const unreadableRestoredSave = Boolean(persistence?.restored && !restored);
  const [state, setState] = useState(() => restored ?? createTexasState());
  const [saveBlocked, setSaveBlocked] = useState(unreadableRestoredSave);
  const [saveUnavailable, setSaveUnavailable] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showRestart, setShowRestart] = useState(false);
  const [raiseDraft, setRaiseDraft] = useState<RaiseDraft>({ revision: -1, amount: 0, open: false });
  const stateRef = useRef(state);
  const { enabled: soundEnabled, toggle: toggleSound, play: playSound } = useSound();
  const { speed: playbackSpeed, cycle: cyclePlaybackSpeed } = usePlaybackSpeed();

  const human = state.players.find((player) => player.id === "human")!;
  const opponent = state.players.find((player) => player.id === "east")!;
  const dealerId = state.players[state.dealerIndex].id;
  const pot = getTexasPotSize(state);
  const overlayOpen = showTools || showRules || showLog || showRestart;
  const aiTurn = state.status === "playing" && state.activePlayerId === "east";
  const aiThinking = aiTurn && !overlayOpen;
  const humanCanAct = state.status === "playing" && state.activePlayerId === "human" && !overlayOpen;
  const legal = useMemo(() => getTexasLegalActions(state, "human"), [state]);
  const presets = useMemo(() => raisePresetOptions(state, legal), [legal, state]);
  const canRaise = humanCanAct && legal.raisePresets.length > 0;
  const raiseFloor = legal.minRaiseTo ?? legal.raisePresets[0] ?? legal.maxRaiseTo;
  const raiseTo = raiseDraft.revision === state.revision
    ? clampRaise(raiseDraft.amount, raiseFloor, legal.maxRaiseTo)
    : raiseFloor;
  const raiseOpen = canRaise && raiseDraft.revision === state.revision && raiseDraft.open;
  const opponentRevealed = state.status === "settled" && state.result?.reason === "showdown";
  const winningIds = useMemo(() => new Set(
    state.result?.winnerIds.flatMap((id) => state.result?.hands[id]?.bestFive.map((card) => card.id) ?? []) ?? [],
  ), [state.result]);
  const humanHandLabel = useMemo(() => {
    const settled = state.result?.hands.human?.label;
    if (settled) return settled;
    const cards = [...human.hole, ...state.board];
    return cards.length >= 5 ? evaluateTexasHand(cards).label : undefined;
  }, [human.hole, state.board, state.result]);
  const opponentHandLabel = opponentRevealed ? state.result?.hands.east?.label : undefined;
  const humanWon = Boolean(state.result?.winnerIds.includes("human"));
  const opponentWon = Boolean(state.result?.winnerIds.includes("east"));

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!aiThinking || state.activePlayerId !== "east") return;
    const expectedRevision = state.revision;
    const observation = buildTexasObservation(state, "east");
    const action = chooseTexasBotAction(observation);
    const timer = window.setTimeout(() => {
      const current = stateRef.current;
      if (current.revision !== expectedRevision
        || current.status !== "playing"
        || current.activePlayerId !== "east") return;
      const next = applyTexasAction(current, "east", action);
      if (next === current) return;
      stateRef.current = next;
      setState(next);
      playSound(action.type === "raise" ? "hit" : action.type === "fold" ? "tap" : "card");
    }, playbackDelay(aiThinkingDuration(state), playbackSpeed));
    return () => window.clearTimeout(timer);
  }, [aiThinking, playSound, playbackSpeed, state]);

  useEffect(() => {
    if (state.status !== "settled") return;
    playSound(humanWon ? "win" : "tap");
  }, [humanWon, playSound, state.handNumber, state.status]);

  useEffect(() => {
    if (!persistence || saveBlocked) return;
    const saved = persistence.save(
      TEXAS_HOLDEM_SAVE_SCHEMA_VERSION,
      state.revision,
      serializeTexasState(state),
    );
    const timer = window.setTimeout(() => setSaveUnavailable(!saved), 0);
    return () => window.clearTimeout(timer);
  }, [persistence, saveBlocked, state]);

  function replaceState(next: TexasState) {
    stateRef.current = next;
    setState(next);
  }

  function performHumanAction(action: TexasPlayerAction) {
    const current = stateRef.current;
    if (overlayOpen || current.status !== "playing" || current.activePlayerId !== "human") return;
    const next = applyTexasAction(current, "human", action);
    if (next === current) return;
    replaceState(next);
    setRaiseDraft({ revision: next.revision, amount: 0, open: false });
    playSound(action.type === "raise" ? "hit" : action.type === "fold" ? "tap" : "card");
  }

  function chooseRaiseAmount(amount: number) {
    setRaiseDraft({ revision: state.revision, amount, open: true });
    playSound("tap");
  }

  function openRaiseEditor() {
    setRaiseDraft({ revision: state.revision, amount: raiseFloor, open: true });
    playSound("tap");
  }

  function startNextHand() {
    const next = startNextTexasHand(stateRef.current);
    if (next === stateRef.current) return;
    replaceState(next);
    setRaiseDraft({ revision: next.revision, amount: 0, open: false });
    playSound("card");
  }

  function restartTable() {
    persistence?.clear();
    const next = createTexasState();
    replaceState(next);
    setSaveBlocked(false);
    setSaveUnavailable(false);
    setShowRestart(false);
    setRaiseDraft({ revision: next.revision, amount: 0, open: false });
    playSound("card");
  }

  function resetUnreadableSave() {
    persistence?.clear();
    setSaveBlocked(false);
    setSaveUnavailable(false);
    playSound("tap");
  }

  const normalStatus = overlayOpen
    ? "牌局已暂停 · 关闭面板继续"
    : state.status === "settled"
      ? state.result?.summary ?? "本手牌已结束"
      : aiThinking
        ? "对手思考中"
        : state.activePlayerId === "human"
          ? legal.callAmount > 0 ? `轮到你 · 跟注 ${legal.callAmount} 或重新加注` : "轮到你 · 可以过牌或加注"
          : state.lastAction?.text ?? "等待行动";
  const statusText = saveBlocked
    ? `旧存档未读取 · ${normalStatus}`
    : saveUnavailable
      ? `本机存档不可用 · ${normalStatus}`
      : normalStatus;

  const toolActions: readonly GameToolAction[] = [
    {
      id: "log",
      label: "牌局记录",
      description: "查看最近 40 条行动",
      icon: "≡",
      onSelect: () => setShowLog(true),
    },
    {
      id: "rules",
      label: "规则说明",
      description: "盲注、行动顺序与牌型",
      icon: "?",
      onSelect: () => setShowRules(true),
    },
    {
      id: "speed",
      label: `AI 节奏 · ${playbackSpeed}×`,
      description: "切换 AI 思考与演出节奏",
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
    {
      id: "restart",
      label: "重开快速桌",
      description: "双方恢复 500 筹码并重新洗牌",
      icon: "↻",
      tone: "danger",
      onSelect: () => setShowRestart(true),
    },
  ];

  const overlay = (
    <>
      <ToolMenu open={showTools} title="牌桌选项" actions={toolActions} onClose={() => setShowTools(false)}>
        {(saveBlocked || saveUnavailable) && (
          <div className="holdem-save-panel" role="alert">
            <p>{saveBlocked
              ? "现有存档版本或内容无法安全读取，本次不会覆盖它。"
              : "浏览器暂时无法写入存档，本次进度仅保留在页面中。"}</p>
            {saveBlocked && <button type="button" onClick={resetUnreadableSave}>重置旧存档并启用保存</button>}
          </div>
        )}
      </ToolMenu>

      <Dialog
        open={showLog}
        title="牌局记录"
        className="holdem-log-dialog"
        onClose={() => setShowLog(false)}
        closeLabel="关闭牌局记录"
        restoreFocus=".cf-game-topbar__more"
      >
        <ol className="holdem-log-list">
          {[...state.log].reverse().map((entry) => (
            <li key={entry.id}>
              <small>#{String(entry.id).padStart(2, "0")}</small>
              <span>{entry.text}</span>
            </li>
          ))}
        </ol>
      </Dialog>

      <Dialog
        open={showRules}
        title="德州扑克 · 双人快速桌"
        className="holdem-rules-dialog"
        onClose={() => setShowRules(false)}
        closeLabel="关闭规则说明"
        restoreFocus=".cf-game-topbar__more"
        footer={<button type="button" className="holdem-dialog-primary" onClick={() => setShowRules(false)}>知道了</button>}
      >
        <div className="holdem-rules">
          <p>每人两张底牌，与五张公共牌组合成最大的五张牌。双方起始 500 筹码，盲注固定为 5 / 10。</p>
          <section>
            <h3>行动顺序</h3>
            <p>按钮位同时是小盲：翻牌前先行动；翻牌、转牌、河牌由大盲先行动。每手结束后按钮轮换。</p>
          </section>
          <section>
            <h3>可用操作</h3>
            <p>可以弃牌、过牌、跟注、加注到指定总额或全下。全下后会自动发完公共牌并摊牌。</p>
          </section>
          <section>
            <h3>牌型大小</h3>
            <p>同花顺 ＞ 四条 ＞ 满堂红 ＞ 同花 ＞ 顺子 ＞ 三条 ＞ 两对 ＞ 一对 ＞ 高牌；同型依次比较关键点数与踢脚。</p>
          </section>
          <p className="holdem-rules__note">这是单挑无限注快速桌，不包含现金兑换、多人边池操作或联网对战。</p>
        </div>
      </Dialog>

      <Dialog
        open={showRestart}
        title="重开快速桌？"
        role="alertdialog"
        className="holdem-restart-dialog"
        onClose={() => setShowRestart(false)}
        closeLabel="取消重开"
        dismissOnBackdrop={false}
        footer={(
          <div className="holdem-dialog-actions">
            <button type="button" className="holdem-dialog-secondary" onClick={() => setShowRestart(false)}>取消</button>
            <button type="button" className="holdem-dialog-danger" onClick={restartTable}>确认重开</button>
          </div>
        )}
      >
        <p className="holdem-restart-copy">当前牌桌进度会被替换。双方恢复到 500 筹码，按钮回到你这一侧。</p>
      </Dialog>
    </>
  );

  const actionDock = state.status === "settled" ? (
    <div className="holdem-finished-actions">
      <span>
        <small>第 {state.handNumber} 手牌结束</small>
        <strong>{humanWon && opponentWon ? "平分底池" : humanWon ? "你赢下这手牌" : "对手赢下这手牌"}</strong>
      </span>
      <button type="button" onClick={startNextHand}>下一手</button>
    </div>
  ) : !humanCanAct ? (
    <div className="holdem-waiting-actions" aria-live="polite" aria-busy={aiThinking}>
      <span className={aiThinking ? "is-thinking" : undefined}>
        {overlayOpen ? "牌局暂停中" : aiThinking ? "对手正在评估牌面" : "等待对手行动"}
        {aiThinking && <i className="holdem-thinking-dots" aria-hidden="true"><b /><b /><b /></i>}
      </span>
      <small>你可以随时查看规则和行动记录</small>
    </div>
  ) : (
    <div className={`holdem-action-panel ${raiseOpen ? "is-raising" : ""}`}>
      {raiseOpen && (
        <div className="holdem-raise-editor">
          <div className="holdem-raise-editor__amount">
            <label htmlFor="holdem-raise-range">加注到</label>
            <output htmlFor="holdem-raise-range">{raiseTo}</output>
            <button
              type="button"
              onClick={() => setRaiseDraft({ revision: state.revision, amount: raiseTo, open: false })}
              aria-label="取消加注"
            >×</button>
          </div>
          {legal.minRaiseTo !== undefined && (
            <input
              id="holdem-raise-range"
              type="range"
              min={raiseFloor}
              max={legal.maxRaiseTo}
              step="1"
              value={raiseTo}
              onChange={(event) => chooseRaiseAmount(Number(event.currentTarget.value))}
              aria-valuetext={`加注到 ${raiseTo}`}
            />
          )}
          <div className="holdem-raise-presets" role="group" aria-label="快捷加注金额">
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={preset.disabled}
                className={raiseTo === preset.amount ? "is-selected" : ""}
                aria-pressed={raiseTo === preset.amount}
                onClick={() => chooseRaiseAmount(preset.amount)}
              >
                <span>{preset.label}</span><small>{preset.amount}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="holdem-primary-actions" role="group" aria-label="本轮操作">
        <button
          type="button"
          className="holdem-action holdem-action--fold"
          disabled={!legal.fold}
          onClick={() => performHumanAction({ type: "fold" })}
        >弃牌</button>
        <button
          type="button"
          className="holdem-action"
          disabled={!legal.check && legal.callAmount === 0}
          onClick={() => performHumanAction(legal.check ? { type: "check" } : { type: "call" })}
        >
          {legal.check ? "过牌" : legal.callAmount === human.stack ? `跟注全下 · ${legal.callAmount}` : `跟注 · ${legal.callAmount}`}
        </button>
        <button
          type="button"
          className="holdem-action holdem-action--raise"
          disabled={!canRaise}
          aria-expanded={raiseOpen}
          onClick={() => raiseOpen
            ? performHumanAction({ type: "raise", to: raiseTo })
            : openRaiseEditor()}
        >
          {raiseOpen ? `加注到 ${raiseTo}` : legal.minRaiseTo === undefined && canRaise ? "全下" : "加注"}
        </button>
      </div>
    </div>
  );

  return (
    <GameShell
      className={`texas-holdem-screen ${raiseOpen ? "is-raising" : ""}`}
      contentClassName="holdem-table-content"
      actionDockClassName="holdem-action-dock"
      contentLabel="德州扑克游戏区"
      actionDockLabel="德州扑克操作"
      topBar={(
        <GameTopBar
          className="holdem-topbar"
          title="德州扑克"
          subtitle={`双人无限注 · ${state.smallBlind}/${state.bigBlind}`}
          onBack={onExit}
          backLabel="返回游戏大厅"
          actions={toolActions.slice(0, 2)}
          onMore={() => setShowTools(true)}
          moreOpen={showTools}
          moreLabel="更多牌桌选项"
        />
      )}
      status={<span className={overlayOpen ? "holdem-game-status is-paused" : "holdem-game-status"}>{statusText}</span>}
      overlayActive={overlayOpen}
      overlay={overlay}
      actionDock={actionDock}
    >
      <section className="holdem-table" aria-label="双人德州扑克牌桌" aria-busy={aiThinking}>
        <TableSeat
          opponent
          player={opponent}
          dealerId={dealerId}
          active={state.activePlayerId === "east"}
          thinking={aiThinking}
          revealHole={opponentRevealed}
          handLabel={opponentHandLabel}
          winner={opponentWon}
          emphasizedIds={winningIds}
        />

        <div className="holdem-board-zone">
          <header className="holdem-pot">
            <span><small>底池</small><strong>{pot}</strong></span>
            <i>{state.status === "settled" && state.result?.reason === "fold" ? "本手结束" : streetName(state.street)} · 第 {state.handNumber} 手</i>
          </header>
          <div className="holdem-board" aria-label={`公共牌，共 ${state.board.length} 张`}>
            {Array.from({ length: 5 }, (_, index) => {
              const card = state.board[index];
              return card
                ? <PokerCardView key={card.id} card={card} emphasized={winningIds.has(card.id)} />
                : <PokerCardView key={`board-slot-${index}`} placeholder />;
            })}
          </div>
          <p className="holdem-table-message" key={state.revision}>
            {state.status === "settled" ? state.result?.summary : state.lastAction?.text}
          </p>
        </div>

        <TableSeat
          player={human}
          dealerId={dealerId}
          active={state.activePlayerId === "human"}
          revealHole
          handLabel={humanHandLabel}
          winner={humanWon}
          emphasizedIds={winningIds}
        />
      </section>
    </GameShell>
  );
}
