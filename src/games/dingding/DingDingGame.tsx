import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { GameRuntimeProps } from "../../core/games/types";
import { useSound } from "../../shared/audio/SoundProvider";
import { playbackDelay, usePlaybackSpeed } from "../../shared/settings/usePlaybackSpeed";
import { useModalFocus } from "../../shared/ui/useModalFocus";
import {
  advancePhase,
  createInitialState,
  discardCards,
  distanceBetween,
  endTurn,
  getPlayableCards,
  getTargetOptions,
  playCard,
  requiredDiscards,
  respondToDying,
  respondToStrike,
} from "./domain/engine";
import { chooseAiDiscards, chooseAiDyingResponse, chooseAiMove, chooseAiStrikeResponse } from "./domain/ai";
import { IDENTITY_NAMES, WINNER_COPY } from "./domain/data";
import { DING_SAVE_SCHEMA_VERSION, restoreDingState, serializeDingState } from "./domain/persistence";
import type { DingCard, DingPlayer, DingState, PlayerId } from "./domain/types";
import "./dingding.css";

const SEAT_LAYOUT: Readonly<Record<PlayerId, string>> = {
  north: "north",
  east: "east",
  west: "west",
  south: "south",
};

function phaseLabel(phase: DingState["phase"]): string {
  switch (phase) {
    case "prepare": return "准备";
    case "draw": return "摸牌";
    case "play": return "出牌";
    case "discard": return "弃牌";
    case "finished": return "结束";
  }
}

function Seat({ player, active, targetable, onTarget, onInspect, selectionActive }: {
  player: DingPlayer;
  active: boolean;
  targetable: boolean;
  selectionActive: boolean;
  onTarget: (id: PlayerId) => void;
  onInspect: (id: PlayerId) => void;
}) {
  const identity = player.revealed ? IDENTITY_NAMES[player.identity] : "？";
  const equipment = [
    player.equipment.weapon,
    player.equipment.minusHorse,
    player.equipment.plusHorse,
  ].filter((card): card is DingCard => Boolean(card));

  return (
    <button
      type="button"
      className={`ding-seat ding-seat--${SEAT_LAYOUT[player.id]} ${active ? "is-active" : ""} ${targetable ? "is-targetable" : ""} ${selectionActive && !targetable ? "is-invalid" : ""} ${!player.alive ? "is-dead" : ""}`}
      onClick={() => targetable ? onTarget(player.id) : onInspect(player.id)}
      aria-label={`${player.displayName}，${identity}，体力 ${player.hp}/${player.maxHp}，${player.hand.length} 张手牌${targetable ? "，可选为目标" : ""}`}
    >
      <span className="ding-seat__mark" aria-hidden="true">{player.revealed ? IDENTITY_NAMES[player.identity].slice(0, 1) : "隐"}</span>
      <span className="ding-seat__copy">
        <small>{player.revealed ? IDENTITY_NAMES[player.identity] : "身份隐藏"}</small>
        <strong>{player.displayName}</strong>
        <i className="ding-hp"><b style={{ width: `${Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100))}%` }} /></i>
        <em>{player.alive ? `${player.hp}/${player.maxHp} · ${player.hand.length} 张` : "已退场"}</em>
      </span>
      <span className="ding-seat__equipment" aria-hidden="true">
        {equipment.map((card) => <b key={card.id} title={`${card.name}：${card.description}`}>{card.symbol}</b>)}
      </span>
      {active && <span className="ding-seat__turn">行动</span>}
      {targetable && <span className="ding-seat__target">可选</span>}
    </button>
  );
}

export function DingDingGame({ onExit, persistence }: GameRuntimeProps) {
  const restored = useMemo(
    () => persistence?.restored && persistence.restored.schemaVersion === DING_SAVE_SCHEMA_VERSION
      ? restoreDingState(persistence.restored.data)
      : undefined,
    [persistence],
  );
  const [state, setState] = useState<DingState>(() => restored ?? createInitialState());
  const [showRules, setShowRules] = useState(restored === undefined);
  const [showLog, setShowLog] = useState(false);
  const [selectedCardUid, setSelectedCardUid] = useState<string>();
  const [selectedTargetId, setSelectedTargetId] = useState<PlayerId>();
  const [discardSelection, setDiscardSelection] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string>();
  const [saveBlocked, setSaveBlocked] = useState(Boolean(persistence?.restored && !restored));
  const [restoredNotice, setRestoredNotice] = useState(Boolean(restored));
  const { enabled: soundEnabled, toggle: toggleSound, play: playSound } = useSound();
  const { speed: playbackSpeed, cycle: cyclePlaybackSpeed } = usePlaybackSpeed();
  const rulesRef = useModalFocus({
    active: showRules,
    initialFocus: ".ding-rules__enter",
    onDismiss: () => setShowRules(false),
  });
  const resultRef = useModalFocus({
    active: state.status === "finished" && !showRules,
    initialFocus: ".ding-result__actions button",
  });

  const human = state.players.find((player) => player.controller === "human")!;
  const active = state.players.find((player) => player.id === state.activePlayerId)!;
  const selectedCard = selectedCardUid ? human.hand.find((card) => card.id === selectedCardUid) : undefined;
  const playableCards = state.status === "playing" && state.phase === "play" && !state.pending && active.id === human.id
    ? getPlayableCards(state, human.id)
    : [];
  const targetOptions = selectedCard ? getTargetOptions(state, human.id, selectedCard) : [];
  const pendingStrike = state.pending?.kind === "strike" ? state.pending : undefined;
  const pendingDying = state.pending?.kind === "dying" ? state.pending : undefined;
  const dyingResponder = pendingDying ? pendingDying.responders[pendingDying.cursor] : undefined;
  const humanCanPlay = playableCards.length > 0 && state.phase === "play" && active.id === human.id && !state.pending;
  const humanDiscarding = state.phase === "discard" && active.id === human.id && requiredDiscards(state, human.id) > 0 && !state.pending;
  const humanRespondingStrike = pendingStrike?.targetId === human.id;
  const humanRespondingDying = dyingResponder === human.id;
  const overlayOpen = showRules || showLog || state.status === "finished";
  const pendingHumanResponse = humanRespondingStrike || humanRespondingDying;

  const shouldAutomate = state.status === "playing"
    && !overlayOpen
    && !pendingHumanResponse
    && (
      state.pending !== undefined
      || active.controller === "ai"
      || (active.id === human.id && state.phase !== "play" && !humanDiscarding)
    );

  useEffect(() => {
    if (!shouldAutomate) return;
    const expectedRevision = state.revision;
    const actorId = state.activePlayerId;

    if (pendingStrike) {
      const responder = state.players.find((player) => player.id === pendingStrike.targetId)!;
      const evadeUid = chooseAiStrikeResponse(state, responder.id);
      const timer = window.setTimeout(() => {
        playSound(evadeUid ? "card" : "hit");
        setState((current) => {
          if (current.revision !== expectedRevision || current.pending?.kind !== "strike") return current;
          return respondToStrike(current, responder.id, evadeUid);
        });
      }, playbackDelay(560, playbackSpeed));
      return () => window.clearTimeout(timer);
    }

    if (pendingDying && dyingResponder) {
      const salveUid = chooseAiDyingResponse(state, dyingResponder);
      const timer = window.setTimeout(() => {
        playSound(salveUid ? "heal" : "tap");
        setState((current) => {
          const pending = current.pending;
          if (current.revision !== expectedRevision || pending?.kind !== "dying") return current;
          const responder = pending.responders[pending.cursor];
          return respondToDying(current, responder, salveUid);
        });
      }, playbackDelay(560, playbackSpeed));
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(() => {
      setState((current) => {
        if (current.revision !== expectedRevision || current.status !== "playing") return current;
        if (current.phase === "play" && current.activePlayerId === actorId && current.pending === undefined) {
          const move = chooseAiMove(current, actorId);
          if (move.kind === "play" && move.cardUid) {
            playSound("card");
            return playCard(current, actorId, move.cardUid, move.targetId);
          }
          playSound("tap");
          return endTurn(current, actorId);
        }
        if (current.phase === "discard" && current.activePlayerId === actorId) {
          const toDiscard = chooseAiDiscards(current, actorId);
          return toDiscard.length > 0 ? discardCards(current, actorId, toDiscard) : advancePhase(current);
        }
        playSound("tap");
        return advancePhase(current);
      });
    }, playbackDelay(420, playbackSpeed));
    return () => window.clearTimeout(timer);
  }, [dyingResponder, pendingDying, pendingStrike, playSound, playbackSpeed, shouldAutomate, state]);

  useEffect(() => {
    if (!persistence || saveBlocked || (state.revision === 0 && !persistence.restored)) return;
    const saved = persistence.save(DING_SAVE_SCHEMA_VERSION, state.revision, serializeDingState(state));
    if (saved) return;
    const timer = window.setTimeout(() => setNotice("本机存档不可用，本次进度只在当前页面保留。"), 0);
    return () => window.clearTimeout(timer);
  }, [persistence, saveBlocked, state]);

  useEffect(() => {
    if (!restoredNotice) return;
    const timer = window.setTimeout(() => setRestoredNotice(false), 2600);
    return () => window.clearTimeout(timer);
  }, [restoredNotice]);

  function resetUnreadableSave() {
    persistence?.clear();
    setSaveBlocked(false);
    setNotice(undefined);
  }

  function selectCard(cardUid: string) {
    if (!humanCanPlay && !humanDiscarding) return;
    if (humanDiscarding) {
      setDiscardSelection((current) => current.includes(cardUid)
        ? current.filter((id) => id !== cardUid)
        : [...current, cardUid]);
      playSound("tap");
      return;
    }
    if (!playableCards.some((card) => card.id === cardUid)) return;
    setSelectedCardUid((current) => current === cardUid ? undefined : cardUid);
    setSelectedTargetId(undefined);
    setNotice(undefined);
    playSound("tap");
  }

  function selectTarget(id: PlayerId) {
    if (!selectedCard || !humanCanPlay) return;
    if (!targetOptions.includes(id)) {
      setNotice("这名角色不是当前卡牌的合法目标。");
      playSound("tap");
      return;
    }
    setSelectedTargetId(id);
    setNotice(undefined);
    playSound("tap");
  }

  function playSelection() {
    if (!selectedCardUid || !humanCanPlay) return;
    const targetId = targetOptions.length === 1 ? targetOptions[0] : selectedTargetId;
    if (!targetId || !targetOptions.includes(targetId)) {
      setNotice("请先选择一名金色高亮的角色。");
      return;
    }
    setState((current) => playCard(current, human.id, selectedCardUid, targetId));
    setSelectedCardUid(undefined);
    setSelectedTargetId(undefined);
    setNotice(undefined);
    playSound("card");
  }

  function confirmDiscard() {
    if (!humanDiscarding) return;
    setState((current) => discardCards(current, human.id, discardSelection));
    setDiscardSelection([]);
    setNotice(undefined);
    playSound("tap");
  }

  function restart() {
    setState(createInitialState());
    setSelectedCardUid(undefined);
    setSelectedTargetId(undefined);
    setDiscardSelection([]);
    setShowRules(false);
    setNotice(undefined);
    playSound("card");
  }

  const tableMessage = pendingStrike
    ? `${state.players.find((player) => player.id === pendingStrike.actorId)?.displayName}的「刺击」等待响应。`
    : pendingDying
      ? `${state.players.find((player) => player.id === pendingDying.targetId)?.displayName}正在濒死求援。`
      : state.lastAction?.text ?? "等待行动。";
  const required = humanDiscarding ? requiredDiscards(state, human.id) : 0;
  const discardReady = humanDiscarding && discardSelection.length === required;

  return (
    <main className="ding-screen">
      <header className="ding-topbar">
        <button type="button" onClick={onExit} aria-label="返回游戏大厅">←</button>
        <div className="ding-title"><small>CARDFORGE · TABLE 004</small><strong>定鼎 · 身份局</strong></div>
        <div className="ding-tools">
          <button type="button" onClick={() => setShowRules(true)} aria-label="查看规则">?</button>
          <button type="button" onClick={() => setShowLog((value) => !value)} aria-label="查看牌局记录">≡</button>
          <button type="button" onClick={cyclePlaybackSpeed} aria-label={`AI 速度 ${playbackSpeed}×`} title={`AI 速度 ${playbackSpeed}×`}>{playbackSpeed}×</button>
          <button type="button" onClick={toggleSound} aria-label={soundEnabled ? "关闭声音" : "开启声音"}>{soundEnabled ? "♪" : "×"}</button>
        </div>
      </header>

      {restoredNotice && <div className="ding-restore-notice" role="status">已恢复定鼎牌局</div>}
      {saveBlocked && (
        <div className="ding-save-warning" role="alert">
          <span>现有存档无法安全读取，本次不会覆盖它。</span>
          <button type="button" onClick={resetUnreadableSave}>重置旧存档并启用保存</button>
        </div>
      )}

      <section className="ding-table" aria-label="四席定鼎牌桌">
        <div className="ding-board">
          {(["north", "east", "west", "south"] as const).map((layout) => {
            const player = state.players.find((entry) => SEAT_LAYOUT[entry.id] === layout)!;
            return (
              <Seat
                key={player.id}
                player={player}
                active={state.activePlayerId === player.id && state.status === "playing"}
                targetable={targetOptions.includes(player.id)}
                selectionActive={Boolean(selectedCardUid)}
                onTarget={selectTarget}
                onInspect={() => setNotice(`${player.displayName} · ${player.revealed ? IDENTITY_NAMES[player.identity] : "身份隐藏"} · 体力 ${player.hp}/${player.maxHp} · 距离你 ${distanceBetween(state.players, human.id, player.id)}`)}
              />
            );
          })}

          <div className="ding-center" aria-live="polite">
            <span className="ding-center__phase">{phaseLabel(state.phase)} · 第 {state.turnNumber} 回合</span>
            <strong>{active.displayName}{state.status === "playing" ? "行动中" : ""}</strong>
            <div className="ding-piles">
              <span><small>牌堆</small><b>{state.deck.length}</b></span>
              <span><small>弃牌</small><b>{state.discard.length}</b></span>
            </div>
            <p key={state.revision}>{notice ?? tableMessage}</p>
          </div>
        </div>
      </section>

      {pendingHumanResponse ? (
        <section className="ding-response" aria-label="响应区">
          {humanRespondingStrike && pendingStrike ? (
            <>
              <div>
                <small>需要响应 · 刺击</small>
                <strong>{state.players.find((player) => player.id === pendingStrike.actorId)?.displayName}的「刺击」正指向你</strong>
                <p>打出「闪避」抵消伤害，或选择承受。</p>
              </div>
              <div className="ding-response__actions">
                {human.hand.filter((card) => card.type === "evade").map((card) => (
                  <button key={card.id} type="button" onClick={() => {
                    setState((current) => respondToStrike(current, human.id, card.id));
                    playSound("card");
                  }}>闪避</button>
                ))}
                <button type="button" onClick={() => {
                  setState((current) => respondToStrike(current, human.id));
                  playSound("hit");
                }}>承受攻击</button>
              </div>
            </>
          ) : null}
          {humanRespondingDying && pendingDying ? (
            <>
              <div>
                <small>濒死求援</small>
                <strong>{state.players.find((player) => player.id === pendingDying.targetId)?.displayName}需要 {pendingDying.required - pendingDying.offered} 张「疗元」</strong>
                <p>你可以打出一张「疗元」，或选择放弃。</p>
              </div>
              <div className="ding-response__actions">
                {human.hand.filter((card) => card.type === "salve").map((card) => (
                  <button key={card.id} type="button" onClick={() => {
                    setState((current) => respondToDying(current, human.id, card.id));
                    playSound("heal");
                  }}>疗元</button>
                ))}
                <button type="button" onClick={() => {
                  setState((current) => respondToDying(current, human.id));
                  playSound("tap");
                }}>放弃救援</button>
              </div>
            </>
          ) : null}
        </section>
      ) : (
        <section className="ding-hand-dock" aria-label="你的手牌">
          <header>
            <span><small>你的身份 · {IDENTITY_NAMES[human.identity]}</small><strong>手牌 {human.hand.length}</strong></span>
            <span className="ding-action-copy">
              {humanDiscarding
                ? `弃牌阶段：请选 ${required} 张弃置（${discardSelection.length}/${required}）`
                : humanCanPlay && selectedCard
                  ? targetOptions.length > 1
                    ? `请选择「${selectedCard.name}」的目标`
                    : `点击出牌使用「${selectedCard.name}」`
                  : humanCanPlay
                    ? "选择一张可出的牌"
                    : state.phase === "play" && active.id === human.id
                      ? "本回合没有可出的牌，可以结束回合"
                      : "等待其他角色行动"}
            </span>
          </header>
          <div className="ding-hand">
            {human.hand.map((card) => {
              const playable = playableCards.some((entry) => entry.id === card.id);
              const selected = selectedCardUid === card.id || discardSelection.includes(card.id);
              return (
                <button
                  key={card.id}
                  type="button"
                  className={`ding-card ding-card--${card.type} ${selected ? "is-selected" : ""} ${humanCanPlay && !playable ? "is-unavailable" : ""}`}
                  style={{ "--card-tone": card.tone } as CSSProperties}
                  onClick={() => selectCard(card.id)}
                  aria-pressed={selected}
                  aria-label={`${card.name}${humanDiscarding ? "，选择弃置" : playable ? "，可打出" : ""}`}
                >
                  <span className="ding-card__symbol" aria-hidden="true">{card.symbol}</span>
                  <strong>{card.name}</strong>
                  <small>{card.description}</small>
                </button>
              );
            })}
          </div>
          <footer className="ding-actions">
            {humanDiscarding ? (
              <button type="button" className="ding-action ding-action--primary" disabled={!discardReady} onClick={confirmDiscard}>确认弃牌</button>
            ) : (
              <>
                <button type="button" className="ding-action ding-action--primary" disabled={!humanCanPlay || !selectedCardUid} onClick={playSelection}>出牌 →</button>
                <button type="button" className="ding-action" disabled={!(state.phase === "play" && active.id === human.id && !state.pending)} onClick={() => {
                  setState((current) => endTurn(current, human.id));
                  setSelectedCardUid(undefined);
                  setSelectedTargetId(undefined);
                  playSound("tap");
                }}>结束回合</button>
              </>
            )}
          </footer>
        </section>
      )}

      {showLog && (
        <aside className="ding-log" aria-label="牌局记录">
          <header><strong>牌局记录</strong><button type="button" onClick={() => setShowLog(false)} aria-label="关闭牌局记录">×</button></header>
          <ol>{[...state.log].reverse().map((entry) => <li key={entry.id}>{entry.text}</li>)}</ol>
        </aside>
      )}

      {showRules && (
        <div ref={rulesRef} className="ding-modal" role="dialog" aria-modal="true" aria-labelledby="ding-rules-title" tabIndex={-1}>
          <article className="ding-rules">
            <button type="button" className="ding-rules__close" onClick={() => setShowRules(false)} aria-label="关闭规则">×</button>
            <span className="ding-rules__ribbon">身份局</span>
            <small>TABLE 004 · M0 规则骨架</small>
            <h2 id="ding-rules-title">四席暗局，<br />先明主君，再定鼎。</h2>
            <p>主君身份公开并多 1 点体力；其余三人身份隐藏。主君与辅臣要清剿叛锋与流谋；叛锋要在主君倒下时达阵；流谋必须成为主君倒下时唯一的其他存活者。</p>
            <div className="ding-rules__grid">
              <span><b>回合</b>准备 → 摸 2 张 → 出牌 → 弃牌到手牌上限（等于当前体力）</span>
              <span><b>刺击</b>攻击范围内每回合一次；目标可出「闪避」</span>
              <span><b>疗元</b>受伤时自疗，或在任何人濒死时救援</span>
              <span><b>距离</b>相邻座位为 1；赤影 -1、磐影 +1、长锋射程 2</span>
              <span><b>胜负</b>主君死时若只剩流谋则流谋胜，否则叛锋胜；叛锋与流谋全灭则主君方胜</span>
              <span><b>奖惩</b>击退叛锋摸 3 张；主君误杀辅臣弃光手牌</span>
            </div>
            <p className="ding-rules__scope">M0 暂不包含武将技能、决斗、无懈可击、群体锦囊与延时锦囊；这些会在后续里程碑加入。</p>
            <button type="button" className="ding-rules__enter" onClick={() => { setShowRules(false); playSound("card"); }}>入席开局 <span>→</span></button>
          </article>
        </div>
      )}

      {state.status === "finished" && state.winner && (
        <div ref={resultRef} className="ding-modal" role="dialog" aria-modal="true" aria-labelledby="ding-result-title" tabIndex={-1}>
          <article className="ding-result">
            <span className="ding-result__seal" aria-hidden="true">鼎</span>
            <small>第 {state.turnNumber} 回合 · 身份局</small>
            <h2 id="ding-result-title">{WINNER_COPY[state.winner].title}</h2>
            <p>{WINNER_COPY[state.winner].detail}</p>
            <div className="ding-result__identities">
              {state.players.map((player) => (
                <span key={player.id}>
                  <b>{player.displayName}</b>
                  <small>{IDENTITY_NAMES[player.identity]}</small>
                  <em>{player.alive ? `${player.hp}/${player.maxHp}` : "退场"}</em>
                </span>
              ))}
            </div>
            <div className="ding-result__actions">
              <button type="button" onClick={restart}>再来一局</button>
              <button type="button" onClick={onExit}>返回大厅</button>
            </div>
          </article>
        </div>
      )}
    </main>
  );
}
