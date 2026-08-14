import { useEffect, useMemo, useState } from "react";
import type { GameRuntimeProps } from "../../core/games/types";
import { useSound } from "../../shared/audio/SoundProvider";
import { useModalFocus } from "../../shared/ui/useModalFocus";
import { PlayerHand } from "./components/PlayerHand";
import { PlayerSeat } from "./components/PlayerSeat";
import { CombatantSheet, TacticalBrief } from "./components/TacticalBrief";
import { chooseAiMove } from "./domain/ai";
import { TEAM_NAMES } from "./domain/data";
import {
  DEFAULT_HUMAN_ID,
  OVERHEAT_START_ROUND,
  createInitialState,
  getCard,
  getCombatant,
  getValidTargetIds,
  passTurn,
  playCard,
} from "./domain/engine";
import type { CardKind } from "./domain/types";
import "./ember-pact.css";

const cueForKind: Record<CardKind, "hit" | "card" | "heal"> = {
  attack: "hit",
  guard: "card",
  restore: "heal",
  tactic: "card",
};

export function EmberPactGame({ onExit }: GameRuntimeProps) {
  const [chosenId, setChosenId] = useState(DEFAULT_HUMAN_ID);
  const [state, setState] = useState(() => createInitialState(Math.random, DEFAULT_HUMAN_ID));
  const [selectedUid, setSelectedUid] = useState<string>();
  const [showLog, setShowLog] = useState(false);
  const [showBrief, setShowBrief] = useState(true);
  const [inspectedId, setInspectedId] = useState<string>();
  const { enabled: soundEnabled, toggle: toggleSound, play: playSound } = useSound();

  const active = getCombatant(state, state.activePlayerId);
  // 出战角色由开局选将决定，敌我分组随之翻转，不再假设人类固定是 dawn。
  const player = state.combatants.find((combatant) => combatant.controller === "human")!;
  const isHumanTurn = state.status === "playing" && active?.controller === "human";
  // Derived, not stored: a combatant is thinking exactly while its move is pending.
  const aiThinking = state.status === "playing" && active?.controller === "ai" && !showBrief && !inspectedId;
  const validTargetIds = useMemo(
    () => selectedUid ? getValidTargetIds(state, player.id, selectedUid) : [],
    [player.id, selectedUid, state],
  );

  useEffect(() => {
    if (!aiThinking || !active) return;

    const expectedRevision = state.revision;
    const expectedActor = active.id;
    const move = chooseAiMove(state, expectedActor);
    const timer = window.setTimeout(() => {
      if (move) {
        const instance = active.hand.find((card) => card.uid === move.cardUid);
        if (instance) playSound(cueForKind[getCard(instance).kind]);
      }

      setState((current) => {
        if (current.revision !== expectedRevision || current.activePlayerId !== expectedActor) return current;
        return move
          ? playCard(current, expectedActor, move.cardUid, move.targetId)
          : passTurn(current, expectedActor);
      });
    }, 720);

    return () => window.clearTimeout(timer);
  }, [active, aiThinking, playSound, state]);

  useEffect(() => {
    if (state.status === "finished") playSound("win");
  }, [playSound, state.status]);

  function handleSelect(uid: string) {
    if (!isHumanTurn) return;
    setSelectedUid((current) => current === uid ? undefined : uid);
    playSound("tap");
  }

  function handleTarget(targetId: string) {
    if (!selectedUid || !validTargetIds.includes(targetId)) return;
    const instance = player.hand.find((card) => card.uid === selectedUid);
    if (instance) playSound(cueForKind[getCard(instance).kind]);
    setState((current) => playCard(current, player.id, selectedUid, targetId));
    setSelectedUid(undefined);
  }

  function handlePass() {
    setSelectedUid(undefined);
    setState((current) => passTurn(current, player.id));
    playSound("tap");
  }

  /** 选将只在开局炉谱里可用，直接按新角色重新发牌。 */
  function chooseCombatant(id: string) {
    if (!showBrief || id === chosenId) return;
    setChosenId(id);
    setSelectedUid(undefined);
    setState(createInitialState(Math.random, id));
    playSound("tap");
  }

  function restart() {
    setSelectedUid(undefined);
    setShowLog(false);
    setInspectedId(undefined);
    setState(createInitialState(Math.random, chosenId));
    playSound("card");
  }

  const enemies = state.combatants.filter((combatant) => combatant.team !== player.team);
  const allies = state.combatants.filter((combatant) => combatant.team === player.team);
  const enemyTeam = enemies[0]?.team ?? (player.team === "dawn" ? "dusk" : "dawn");
  const selectedCard = selectedUid
    ? player.hand.find((card) => card.uid === selectedUid)
    : undefined;
  const inspected = inspectedId ? getCombatant(state, inspectedId) : undefined;
  const overheatAmount = state.roundNumber >= OVERHEAT_START_ROUND
    ? state.roundNumber - OVERHEAT_START_ROUND + 1
    : 0;
  const resultModalRef = useModalFocus({
    active: state.status === "finished" && Boolean(state.winner),
    initialFocus: ".primary-button",
  });

  return (
    <main className="battle-screen">
      <header className="battle-topbar">
        <button type="button" className="icon-button" onClick={onExit} aria-label="返回游戏大厅">
          <span aria-hidden="true">←</span>
        </button>
        <div className="battle-title">
          <small>战术试炼</small>
          <strong>烬契 · 2v2</strong>
        </div>
        <div className="battle-actions">
          <button type="button" className="icon-button" onClick={() => setShowBrief(true)} aria-label="打开战术炉谱">
            <span aria-hidden="true">?</span>
          </button>
          <button type="button" className="icon-button" onClick={() => setShowLog((value) => !value)} aria-label="查看战报">
            <span aria-hidden="true">≡</span>
          </button>
          <button type="button" className="icon-button" onClick={toggleSound} aria-label={soundEnabled ? "关闭声音" : "开启声音"}>
            <span aria-hidden="true">{soundEnabled ? "♪" : "×"}</span>
          </button>
        </div>
      </header>

      <section className="battlefield" aria-label="烬契战场">
        <div className="team-label team-label--enemy">
          <span>{TEAM_NAMES[enemyTeam]}</span>
          <i />
        </div>
        <div className="seat-row seat-row--enemies">
          {enemies.map((combatant) => (
            <PlayerSeat
              key={combatant.id}
              combatant={combatant}
              active={state.activePlayerId === combatant.id}
              targetable={validTargetIds.includes(combatant.id)}
              lastAction={state.lastAction}
              revision={state.revision}
              onTarget={handleTarget}
              onInspect={setInspectedId}
            />
          ))}
        </div>

        <div className={`forge-line ${overheatAmount > 0 ? "is-overheating" : ""}`} aria-live="polite">
          <span className="forge-mark" aria-hidden="true">
            <i /><i /><i />
            {overheatAmount > 0 && <b>{overheatAmount}</b>}
          </span>
          <p>
            {state.status === "finished"
              ? "对局结束"
              : aiThinking
                ? `${active?.displayName}正在思考…`
                : isHumanTurn
                  ? selectedCard
                    ? `选择「${getCard(selectedCard).name}」的目标`
                    : "你的行动 · 选择一张手牌"
                  : `${active?.displayName}的行动`}
          </p>
          <span className="round-counter">
            {overheatAmount > 0 ? `过载 ${overheatAmount}` : `轮次 ${state.roundNumber}`}
          </span>
        </div>

        <div className="seat-row seat-row--allies">
          {allies.map((combatant) => (
            <PlayerSeat
              key={combatant.id}
              combatant={combatant}
              active={state.activePlayerId === combatant.id}
              targetable={validTargetIds.includes(combatant.id)}
              lastAction={state.lastAction}
              revision={state.revision}
              onTarget={handleTarget}
              onInspect={setInspectedId}
            />
          ))}
        </div>
        <div className="team-label team-label--ally">
          <i />
          <span>{TEAM_NAMES[player.team]}</span>
        </div>
      </section>

      <section className="hand-dock" aria-label="行动区">
        <div className="hand-dock__header">
          <span>
            <small>你的手牌</small>
            <strong>{isHumanTurn ? "选牌，再点选目标" : "等待其他角色行动"}</strong>
          </span>
          <button type="button" className="pass-button" onClick={handlePass} disabled={!isHumanTurn}>
            暂缓行动
          </button>
        </div>
        <PlayerHand cards={player.hand} selectedUid={selectedUid} enabled={isHumanTurn} onSelect={handleSelect} />
      </section>

      {showLog && (
        <aside className="battle-log" aria-label="战报">
          <div>
            <strong>炉边战报</strong>
            <button type="button" onClick={() => setShowLog(false)} aria-label="关闭战报">×</button>
          </div>
          <ol>
            {[...state.log].reverse().map((entry) => <li key={entry.id}>{entry.text}</li>)}
          </ol>
        </aside>
      )}

      {showBrief && (
        <TacticalBrief
          combatants={state.combatants}
          selectedId={chosenId}
          onSelect={chooseCombatant}
          onClose={() => setShowBrief(false)}
        />
      )}

      {inspected && (
        <CombatantSheet combatant={inspected} onClose={() => setInspectedId(undefined)} />
      )}

      {state.status === "finished" && state.winner && (
        <div ref={resultModalRef} className="result-overlay" role="dialog" aria-modal="true" aria-labelledby="result-title" tabIndex={-1}>
          <div className={`result-card result-card--${state.winner}`}>
            <span className="result-card__seal" aria-hidden="true">{state.winner === "dawn" ? "铸" : "蚀"}</span>
            <small>试炼完成</small>
            <h2 id="result-title">{TEAM_NAMES[state.winner]}胜出</h2>
            <p>{state.winner === "dawn" ? "火种仍在，工坊将记住这次配合。" : "夜蚀占据了桌面。再调整一次出牌顺序。"}</p>
            <div>
              <button type="button" className="primary-button" onClick={restart}>再来一局</button>
              <button type="button" className="text-button" onClick={onExit}>返回大厅</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
