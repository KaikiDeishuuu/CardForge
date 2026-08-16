import { useEffect, useMemo, useState } from "react";
import type { GameRuntimeProps } from "../../core/games/types";
import { useSound } from "../../shared/audio/SoundProvider";
import { playbackDelay, usePlaybackSpeed } from "../../shared/settings/usePlaybackSpeed";
import {
  GameShell,
  GameTopBar,
  ToolMenu,
  type GameToolAction,
} from "../../shared/ui/GameShell";
import { PlayerHand } from "./components/PlayerHand";
import { PlayerSeat } from "./components/PlayerSeat";
import { CombatantSheet, TacticalBrief } from "./components/TacticalBrief";
import { TurnTrack } from "./components/TurnTrack";
import {
  ProfilePanel,
  ResponsePanel,
  ResultPanel,
  EndTurnConfirm,
  type ProfileOverview,
} from "./components/BattlePanels";
import { chooseAiMove, chooseAiResponse, predictedIncomingDamage } from "./domain/ai";
import { COMBATANT_SEEDS, PASSIVE_CATALOG, TEAM_NAMES } from "./domain/data";
import {
  DEFAULT_HUMAN_ID,
  createInitialState,
  declineResponse,
  endTurn,
  getCard,
  getCombatant,
  getResponseCards,
  getValidTargetIds,
  playCard,
  respondToAttack,
} from "./domain/engine";
import {
  PACT_SAVE_SCHEMA_VERSION,
  restorePactRootState,
  serializePactRootState,
} from "./domain/persistence";
import {
  createDefaultRootState,
  dismissFinishedMatch,
  resetLifetimeProfile,
  startMatch,
  updateActiveMatch,
  updatePreferences,
} from "./domain/session";
import type { CardKind, Difficulty, EmberPactState } from "./domain/types";
import "./ember-pact.css";

const cueForKind: Record<CardKind, "hit" | "card" | "heal"> = {
  attack: "hit",
  guard: "card",
  restore: "heal",
  tactic: "card",
};

export function EmberPactGame({ onExit, persistence }: GameRuntimeProps) {
  const restoredRoot = useMemo(
    () => persistence?.restored
      ? restorePactRootState(persistence.restored.schemaVersion, persistence.restored.data)
      : undefined,
    [persistence],
  );
  const initialRoot = useMemo(() => restoredRoot ?? createDefaultRootState(), [restoredRoot]);
  const unreadableRestoredSave = Boolean(persistence?.restored && !restoredRoot);
  const restoredMatch = initialRoot.activeMatch?.state;
  const initialHumanId = restoredMatch?.combatants.find((combatant) => combatant.controller === "human")?.id
    ?? DEFAULT_HUMAN_ID;

  const [root, setRoot] = useState(initialRoot);
  const [chosenId, setChosenId] = useState(initialHumanId);
  const [draft, setDraft] = useState(() => restoredMatch
    ?? createInitialState(Math.random, initialHumanId, initialRoot.preferences.difficulty));
  const [selectedUid, setSelectedUid] = useState<string>();
  const [showLog, setShowLog] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showBrief, setShowBrief] = useState(!restoredMatch);
  const [showProfile, setShowProfile] = useState(false);
  const [inspectedId, setInspectedId] = useState<string>();
  const [endTurnConfirmOpen, setEndTurnConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [saveBlocked, setSaveBlocked] = useState(unreadableRestoredSave);
  const [saveUnavailable, setSaveUnavailable] = useState(false);
  const [restoredNotice, setRestoredNotice] = useState(Boolean(restoredMatch?.status === "playing"));
  const { enabled: soundEnabled, toggle: toggleSound, play: playSound } = useSound();
  const { speed: playbackSpeed, cycle: cyclePlaybackSpeed } = usePlaybackSpeed();

  const state = root.activeMatch?.state ?? draft;
  const setupComplete = Boolean(root.activeMatch);
  const active = getCombatant(state, state.activePlayerId);
  const player = state.combatants.find((combatant) => combatant.controller === "human")!;
  const responder = state.pendingAttack ? getCombatant(state, state.pendingAttack.targetId) : undefined;
  const attacker = state.pendingAttack ? getCombatant(state, state.pendingAttack.actorId) : undefined;
  const isHumanTurn = setupComplete
    && state.status === "playing"
    && state.phase === "action"
    && active?.controller === "human";
  const isHumanResponse = setupComplete
    && state.status === "playing"
    && state.phase === "response"
    && responder?.controller === "human";
  const overlayOpen = showTools || showBrief || showLog || showProfile || Boolean(inspectedId) || endTurnConfirmOpen;
  const modalOpen = showTools || showBrief || showProfile || Boolean(inspectedId) || endTurnConfirmOpen || state.status === "finished";
  const aiThinking = setupComplete
    && state.status === "playing"
    && !overlayOpen
    && (state.phase === "response" ? responder?.controller === "ai" : active?.controller === "ai");

  const validTargetIds = useMemo(
    () => selectedUid ? getValidTargetIds(state, player.id, selectedUid) : [],
    [player.id, selectedUid, state],
  );
  const playableUids = useMemo(
    () => isHumanTurn
      ? player.hand.filter((instance) => getValidTargetIds(state, player.id, instance.uid).length > 0).map((instance) => instance.uid)
      : [],
    [isHumanTurn, player.hand, player.id, state],
  );

  useEffect(() => {
    if (!aiThinking) return;
    const expectedRevision = state.revision;
    const expectedPhase = state.phase;

    if (state.phase === "response" && responder) {
      const effectiveDifficulty = responder.team === player.team ? "standard" : state.difficulty;
      const responseUid = chooseAiResponse(state, responder.id, effectiveDifficulty);
      const timer = window.setTimeout(() => {
        playSound(responseUid ? "card" : "hit");
        setRoot((current) => {
          const match = current.activeMatch?.state;
          if (!match || match.revision !== expectedRevision || match.phase !== expectedPhase) return current;
          const next = responseUid
            ? respondToAttack(match, responder.id, responseUid)
            : declineResponse(match, responder.id);
          return updateActiveMatch(current, next);
        });
      }, playbackDelay(620, playbackSpeed));
      return () => window.clearTimeout(timer);
    }

    if (state.phase === "action" && active) {
      const effectiveDifficulty: Difficulty = active.team === player.team ? "standard" : state.difficulty;
      const move = chooseAiMove(state, active.id, effectiveDifficulty);
      const timer = window.setTimeout(() => {
        if (move) {
          const instance = active.hand.find((card) => card.uid === move.cardUid);
          if (instance) playSound(cueForKind[getCard(instance).kind]);
        }
        setRoot((current) => {
          const match = current.activeMatch?.state;
          if (!match || match.revision !== expectedRevision || match.phase !== expectedPhase
            || match.activePlayerId !== active.id) return current;
          const next = move
            ? playCard(match, active.id, move.cardUid, move.targetId)
            : endTurn(match, active.id);
          return updateActiveMatch(current, next);
        });
      }, playbackDelay(620, playbackSpeed));
      return () => window.clearTimeout(timer);
    }
  }, [active, aiThinking, playSound, player.team, playbackSpeed, responder, state]);

  useEffect(() => {
    if (state.status !== "finished" || !state.winner) return;
    playSound(state.winner === player.team ? "win" : "tap");
  }, [playSound, player.team, state.status, state.winner]);

  useEffect(() => {
    if (!persistence || saveBlocked || (root.revision === 0 && !persistence.restored)) return;
    const saved = persistence.save(PACT_SAVE_SCHEMA_VERSION, root.revision, serializePactRootState(root));
    if (saved) {
      const timer = window.setTimeout(() => setSaveUnavailable(false), 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setSaveUnavailable(true), 0);
    return () => window.clearTimeout(timer);
  }, [persistence, root, saveBlocked]);

  useEffect(() => {
    if (!restoredNotice) return;
    const timer = window.setTimeout(() => setRestoredNotice(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [restoredNotice]);

  function transitionMatch(update: (current: EmberPactState) => EmberPactState) {
    setRoot((current) => {
      const match = current.activeMatch?.state;
      if (!match) return current;
      return updateActiveMatch(current, update(match));
    });
  }

  function handleSelect(uid: string) {
    if (!isHumanTurn) return;
    if (!playableUids.includes(uid)) {
      const card = player.hand.find((instance) => instance.uid === uid);
      const definition = card ? getCard(card) : undefined;
      setNotice(definition?.kind === "attack" && state.attackUsed
        ? "本回合已经使用过进攻牌，可以改用战术、守护或回复牌。"
        : "当前行动力不足，结束回合后会补充到 2 点。"
      );
      playSound("tap");
      return;
    }
    setSelectedUid((current) => current === uid ? undefined : uid);
    setNotice(undefined);
    playSound("tap");
  }

  function handleTarget(targetId: string) {
    if (!selectedUid || !validTargetIds.includes(targetId)) return;
    const instance = player.hand.find((card) => card.uid === selectedUid);
    if (instance) playSound(cueForKind[getCard(instance).kind]);
    transitionMatch((current) => playCard(current, player.id, selectedUid, targetId));
    setSelectedUid(undefined);
    setNotice(undefined);
  }

  function handleInvalidTarget() {
    setNotice("这名角色不符合当前卡牌的目标条件；金色高亮座位才可选择。");
    playSound("tap");
  }

  function commitEndTurn() {
    setSelectedUid(undefined);
    setNotice(undefined);
    setEndTurnConfirmOpen(false);
    transitionMatch((current) => endTurn(current, player.id));
    playSound("tap");
  }

  function handleEndTurn() {
    if (isHumanTurn && playableUids.length > 0) {
      setEndTurnConfirmOpen(true);
      return;
    }
    commitEndTurn();
  }

  function handleResponse(cardUid?: string) {
    if (!isHumanResponse || !responder) return;
    transitionMatch((current) => cardUid
      ? respondToAttack(current, responder.id, cardUid)
      : declineResponse(current, responder.id));
    playSound(cardUid ? "card" : "hit");
    setNotice(undefined);
  }

  function chooseCombatant(id: string) {
    if (setupComplete || id === chosenId) return;
    setChosenId(id);
    setSelectedUid(undefined);
    setDraft(createInitialState(Math.random, id, root.preferences.difficulty));
    playSound("tap");
  }

  function chooseDifficulty(difficulty: Difficulty) {
    if (setupComplete) return;
    setRoot((current) => updatePreferences(current, { difficulty }));
    setDraft(createInitialState(Math.random, chosenId, difficulty));
    playSound("tap");
  }

  function chooseGuide(guideEnabled: boolean) {
    if (setupComplete) return;
    setRoot((current) => updatePreferences(current, { guideEnabled }));
  }

  function commitBrief() {
    if (setupComplete) {
      setShowBrief(false);
      return;
    }
    setRoot((current) => startMatch(current, draft));
    setShowBrief(false);
    playSound("card");
  }

  function dismissBrief() {
    if (!setupComplete) {
      onExit();
      return;
    }
    setShowBrief(false);
  }

  function resetUnreadableSave() {
    persistence?.clear();
    setSaveBlocked(false);
    setSaveUnavailable(false);
  }

  function restart() {
    setSelectedUid(undefined);
    setShowLog(false);
    setInspectedId(undefined);
    setRoot((current) => {
      const cleared = dismissFinishedMatch(current);
      return startMatch(cleared, createInitialState(Math.random, chosenId, current.preferences.difficulty));
    });
    playSound("card");
  }

  function changeRole() {
    setRoot((current) => dismissFinishedMatch(current));
    setDraft(createInitialState(Math.random, chosenId, root.preferences.difficulty));
    setSelectedUid(undefined);
    setShowBrief(true);
  }

  const enemies = state.combatants.filter((combatant) => combatant.team !== player.team);
  const allies = state.combatants.filter((combatant) => combatant.team === player.team);
  const enemyTeam = enemies[0]?.team ?? (player.team === "dawn" ? "dusk" : "dawn");
  const selectedCard = selectedUid ? player.hand.find((card) => card.uid === selectedUid) : undefined;
  const inspected = inspectedId ? getCombatant(state, inspectedId) : undefined;
  const responseCards = responder ? getResponseCards(state, responder.id) : [];
  const pendingCard = state.pendingAttack ? getCard({
    uid: state.pendingAttack.cardUid,
    definitionId: state.pendingAttack.definitionId,
  }) : undefined;
  const actionPrompt = !setupComplete
    ? "选择执火者后开始"
    : isHumanResponse
      ? "选择卸力，或承受攻击"
      : isHumanTurn
        ? selectedCard
          ? `选择「${getCard(selectedCard).name}」的目标`
          : `还有 ${state.actionsRemaining} 点行动力 · 选牌或结束回合`
        : aiThinking
          ? `${state.phase === "response" ? responder?.displayName : active?.displayName}正在判断…`
          : `等待${active?.displayName ?? "其他角色"}行动`;
  const guideMessage = root.preferences.guideEnabled && setupComplete && state.status === "playing"
    ? isHumanResponse
      ? "响应不消耗下一回合行动力；若伤害不致命，也可以保留卸力。"
      : isHumanTurn && selectedCard
        ? "只需点击金色高亮座位；再次点选手牌可以取消。"
        : isHumanTurn && state.actionsRemaining < 2
          ? "你还可以继续使用非进攻牌，也可以提前结束回合。"
          : isHumanTurn
            ? "每回合有 2 点行动力，但进攻牌最多使用 1 张。"
            : "观察行动轨：四席按守炉、逐光交错行动，队友施加的状态可以触发联携。"
    : undefined;
  const trackSummary = notice
    ?? (isHumanTurn && selectedCard ? guideMessage : undefined)
    ?? state.lastAction?.summary
    ?? guideMessage;
  const saveWarning = saveBlocked
    ? "现有存档无法安全读取，本次不会覆盖它。"
    : saveUnavailable
      ? "本机存档不可用，本次进度只在当前页面保留。"
      : undefined;

  const profileOverview: ProfileOverview = useMemo(() => ({
    completed: root.lifetimeProfile.gamesPlayed,
    wins: root.lifetimeProfile.wins,
    losses: root.lifetimeProfile.losses,
    draws: root.lifetimeProfile.draws,
    abandons: root.lifetimeProfile.abandons,
    currentStreak: root.lifetimeProfile.currentWinStreak,
    bestStreak: root.lifetimeProfile.bestWinStreak,
    fastestWinRound: root.lifetimeProfile.fastestWinRounds,
    lifetimeMetrics: root.lifetimeProfile.playerMetrics,
    characters: COMBATANT_SEEDS.map((combatant) => ({
      id: combatant.id,
      name: combatant.displayName,
      role: PASSIVE_CATALOG[combatant.passiveId].role,
      played: root.lifetimeProfile.combatants[combatant.id as keyof typeof root.lifetimeProfile.combatants].gamesPlayed,
      wins: root.lifetimeProfile.combatants[combatant.id as keyof typeof root.lifetimeProfile.combatants].wins,
      bestDifficulty: root.lifetimeProfile.combatants[combatant.id as keyof typeof root.lifetimeProfile.combatants].highestDifficulty,
    })),
  }), [root]);

  const toolActions: readonly GameToolAction[] = [
    {
      id: "profile",
      label: "查看争焰记录",
      icon: "◎",
      onSelect: () => setShowProfile(true),
    },
    {
      id: "brief",
      label: "打开角色与规则",
      icon: "?",
      onSelect: () => setShowBrief(true),
    },
    {
      id: "log",
      label: "查看战报",
      icon: "≡",
      pressed: showLog,
      onSelect: () => setShowLog((value) => !value),
    },
    {
      id: "speed",
      label: `AI 速度 ${playbackSpeed}×`,
      icon: `${playbackSpeed}×`,
      onSelect: cyclePlaybackSpeed,
    },
    {
      id: "sound",
      label: soundEnabled ? "关闭声音" : "开启声音",
      icon: soundEnabled ? "♪" : "×",
      onSelect: toggleSound,
    },
  ];

  const actionDock = isHumanResponse && responder && attacker && pendingCard ? (
    <ResponsePanel
      attacker={attacker}
      responder={responder}
      attackName={pendingCard.name}
      incomingDamage={predictedIncomingDamage(state)}
      cards={responseCards}
      onRespond={(cardUid) => handleResponse(cardUid)}
      onDecline={() => handleResponse()}
    />
  ) : (
    <div className="hand-dock">
      <div className="hand-dock__header">
        <span><small>{isHumanTurn ? `你的手牌 · ${state.actionsRemaining} 行动力` : "你的手牌"}</small><strong>{actionPrompt}</strong></span>
        <button type="button" className="pass-button" onClick={handleEndTurn} disabled={!isHumanTurn}>结束回合</button>
      </div>
      <PlayerHand
        cards={player.hand}
        selectedUid={selectedUid}
        enabled={isHumanTurn}
        playableUids={playableUids}
        onSelect={handleSelect}
      />
    </div>
  );

  const gameOverlay = (
    <>
      <ToolMenu
        open={showTools}
        title="牌桌选项"
        actions={toolActions}
        onClose={() => setShowTools(false)}
      />

      {endTurnConfirmOpen && (
        <EndTurnConfirm
          actionsRemaining={state.actionsRemaining}
          playableCards={playableUids.length}
          onConfirm={commitEndTurn}
          onCancel={() => setEndTurnConfirmOpen(false)}
        />
      )}

      {showBrief && (
        <TacticalBrief
          combatants={state.combatants}
          selectedId={chosenId}
          selectionLocked={setupComplete}
          difficulty={root.preferences.difficulty}
          guideEnabled={root.preferences.guideEnabled}
          saveWarning={saveWarning}
          onResetSave={saveBlocked ? resetUnreadableSave : undefined}
          onSelect={chooseCombatant}
          onDifficultyChange={chooseDifficulty}
          onGuideChange={chooseGuide}
          onCommit={commitBrief}
          onClose={dismissBrief}
        />
      )}
      {showProfile && (
        <ProfilePanel
          profile={profileOverview}
          canResetProfile={!root.activeMatch}
          onResetProfile={() => setRoot((current) => resetLifetimeProfile(current))}
          onClose={() => setShowProfile(false)}
        />
      )}
      {inspected && <CombatantSheet combatant={inspected} onClose={() => setInspectedId(undefined)} />}

      {state.status === "finished" && state.winner && (
        <ResultPanel
          winner={state.winner}
          playerTeam={player.team}
          difficulty={state.difficulty}
          roundNumber={state.roundNumber}
          metrics={state.metrics[player.id]}
          archiveAvailable={!saveBlocked && !saveUnavailable}
          onReplay={restart}
          onChangeRole={changeRole}
          onExit={onExit}
        />
      )}
    </>
  );

  return (
    <GameShell
      className="battle-screen"
      contentClassName="battlefield"
      contentLabel="争焰战场"
      contentRole="region"
      topBar={(
        <GameTopBar
          className="battle-topbar"
          title="争焰"
          subtitle="四席阵营策略"
          onBack={onExit}
          backLabel="返回游戏大厅"
          actions={toolActions}
          onMore={() => setShowTools(true)}
          moreOpen={showTools}
          moreLabel="更多选项"
        />
      )}
      status={restoredNotice ? `已恢复第 ${state.roundNumber} 轮争焰` : undefined}
      actionDock={actionDock}
      actionDockClassName="pact-action-dock"
      actionDockLabel="行动区"
      overlayActive={modalOpen}
      overlay={gameOverlay}
    >
      <div className="team-label team-label--enemy"><span>{TEAM_NAMES[enemyTeam]}</span><i /></div>
      <div className="seat-row seat-row--enemies">
        {enemies.map((combatant) => (
          <PlayerSeat
            key={combatant.id}
            combatant={combatant}
            active={state.activePlayerId === combatant.id}
            targetable={validTargetIds.includes(combatant.id)}
            selectionActive={Boolean(selectedUid)}
            lastAction={state.lastAction}
            revision={state.revision}
            onTarget={handleTarget}
            onInspect={setInspectedId}
            onInvalidTarget={handleInvalidTarget}
          />
        ))}
      </div>

      <TurnTrack
        combatants={state.combatants}
        activePlayerId={state.activePlayerId}
        actionsRemaining={state.actionsRemaining}
        roundNumber={state.roundNumber}
        phase={state.phase}
        summary={trackSummary}
      />

      <div className="seat-row seat-row--allies">
        {allies.map((combatant) => (
          <PlayerSeat
            key={combatant.id}
            combatant={combatant}
            active={state.activePlayerId === combatant.id}
            targetable={validTargetIds.includes(combatant.id)}
            selectionActive={Boolean(selectedUid)}
            lastAction={state.lastAction}
            revision={state.revision}
            onTarget={handleTarget}
            onInspect={setInspectedId}
            onInvalidTarget={handleInvalidTarget}
          />
        ))}
      </div>
      <div className="team-label team-label--ally"><i /><span>{TEAM_NAMES[player.team]}</span></div>

      {saveWarning && !modalOpen && (
        <div className="pact-save-warning" role="alert">
          <span>{saveWarning}</span>
          {saveBlocked && <button type="button" onClick={resetUnreadableSave}>重置旧存档并启用保存</button>}
        </div>
      )}

      {showLog && (
        <aside id="battle-log" className="battle-log" aria-label="战报">
          <div><strong>战报</strong><button type="button" onClick={() => setShowLog(false)} aria-label="关闭战报">×</button></div>
          <ol>{[...state.log].reverse().map((entry) => <li key={entry.id}>{entry.text}</li>)}</ol>
        </aside>
      )}
    </GameShell>
  );
}
