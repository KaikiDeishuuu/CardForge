import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { GameRuntimeProps } from "../../core/games/types";
import { useSound } from "../../shared/audio/SoundProvider";
import { playbackDelay, usePlaybackSpeed } from "../../shared/settings/usePlaybackSpeed";
import { useModalFocus } from "../../shared/ui/useModalFocus";
import {
  DING_DIFFICULTY_NAMES,
  activateSkill,
  advancePhase,
  changeDifficulty,
  discardCards,
  distanceBetween,
  endTurn,
  getActiveSkillUse,
  getPlayableCards,
  getTargetOptions,
  playCard,
  requiredDiscards,
  respondToDelayed,
  respondToDuel,
  respondToDying,
  respondToHorde,
  respondToProbe,
  respondToProtect,
  respondToSkill,
  respondToStrike,
  respondToTrick,
  respondToVolley,
} from "./domain/engine";
import {
  chooseAiDiscards,
  chooseAiDuelResponse,
  chooseAiDyingResponse,
  chooseAiHordeResponse,
  chooseAiMove,
  chooseAiNullifyResponse,
  chooseAiProbeGuess,
  chooseAiProtectResponse,
  chooseAiSkillDecision,
  chooseAiStrikeResponse,
  chooseAiVolleyResponse,
} from "./domain/ai";
import { IDENTITY_NAMES, WINNER_COPY } from "./domain/data";
import { HERO_CATALOG, matchesActiveSkillCardFilter, type HeroId } from "./domain/heroes";
import { DING_SAVE_SCHEMA_VERSION, restoreDingRootState, serializeDingRootState } from "./domain/persistence";
import {
  chooseDingMatchHero,
  createDefaultDingRootState,
  dismissDingMatch,
  startDingMatchWithHeroDraft,
  updateActiveDingMatch,
  type DingRootState,
} from "./domain/session";
import type { DingCard, DingDifficulty, DingPlayer, DingState, IdentityId, PlayerId, ResolutionFrame } from "./domain/types";
import "./dingding.css";

const SEAT_LAYOUT: Readonly<Record<PlayerId, string>> = {
  north: "north",
  east: "east",
  west: "west",
  south: "south",
};

function DingProfilePanel({ profile, onClose }: {
  profile: DingRootState["lifetimeProfile"];
  onClose: () => void;
}) {
  const winRate = profile.gamesPlayed === 0
    ? "—"
    : `${Math.round((profile.wins / profile.gamesPlayed) * 100)}%`;
  return (
    <div className="ding-profile" role="dialog" aria-modal="true" aria-labelledby="ding-profile-title" tabIndex={-1}>
      <article>
        <button type="button" className="ding-profile__close" onClick={onClose} aria-label="关闭定鼎战绩">×</button>
        <small>DING ARCHIVE</small>
        <h2 id="ding-profile-title">定鼎战绩</h2>
        <div className="ding-profile__summary">
          <span><small>完成对局</small><strong>{profile.gamesPlayed}</strong></span>
          <span><small>获胜</small><strong>{profile.wins}</strong></span>
          <span><small>胜率</small><strong>{winRate}</strong></span>
        </div>
        <section>
          <h3>身份胜率</h3>
          <div className="ding-profile__grid">
            {(Object.keys(profile.identityRecords) as Array<keyof typeof profile.identityRecords>).map((identity) => {
              const record = profile.identityRecords[identity];
              return (
                <span key={identity}>
                  <b>{IDENTITY_NAMES[identity]}</b>
                  <small>{record.wins} 胜 / {record.games} 局</small>
                </span>
              );
            })}
          </div>
        </section>
        <section>
          <h3>武将胜率</h3>
          <div className="ding-profile__grid">
            {(Object.keys(profile.heroRecords) as Array<HeroId>).map((heroId) => {
              const record = profile.heroRecords[heroId];
              return (
                <span key={heroId}>
                  <b>{HERO_CATALOG[heroId].name}</b>
                  <small>{record.wins} 胜 / {record.games} 局</small>
                </span>
              );
            })}
          </div>
        </section>
      </article>
    </div>
  );
}

const DIFFICULTY_OPTIONS: ReadonlyArray<{ id: DingDifficulty; description: string }> = [
  { id: "relaxed", description: "AI 行动保守，适合熟悉身份规则。" },
  { id: "standard", description: "按牌面压力行动，保留基础响应牌。" },
  { id: "tactician", description: "使用身份信念选择目标，更主动控制延时牌与主动技。" },
];

function DingHeroDraft({ options, onChoose, onExit }: {
  options: readonly HeroId[];
  onChoose: (heroId: HeroId) => void;
  onExit: () => void;
}) {
  const focusRef = useModalFocus({
    active: true,
    initialFocus: ".ding-draft__heroes button",
    onDismiss: onExit,
  });
  return (
    <div ref={focusRef} className="ding-modal" role="dialog" aria-modal="true" aria-labelledby="ding-draft-title" tabIndex={-1}>
      <article className="ding-draft">
        <small>DING HERO DRAFT</small>
        <h2 id="ding-draft-title">三选一 · 选择武将</h2>
        <p>身份仍然随机分配。三名 AI 会从其余武将中各自补位，四席武将互不重复。</p>
        <div className="ding-draft__heroes">
          {options.map((heroId) => {
            const hero = HERO_CATALOG[heroId];
            return (
              <button
                key={heroId}
                type="button"
                onClick={() => onChoose(heroId)}
                aria-label={`选择武将${hero.name}`}
              >
                <b>{hero.name}</b>
                <i>{hero.title} · {hero.skillName}</i>
                <span>{hero.description}</span>
                <em>{hero.maxHp} 体力</em>
              </button>
            );
          })}
        </div>
        <button type="button" className="ding-draft__exit" onClick={onExit}>返回大厅</button>
      </article>
    </div>
  );
}

function phaseLabel(phase: DingState["phase"]): string {
  switch (phase) {
    case "prepare": return "准备";
    case "judge": return "判定";
    case "draw": return "摸牌";
    case "play": return "出牌";
    case "discard": return "弃牌";
    case "finished": return "结束";
  }
}

function frameLabel(frame: ResolutionFrame, state: DingState): string {
  switch (frame.kind) {
    case "strike": return "刺击";
    case "dying": return "濒死";
    case "skill": return "主动技";
    case "delayed":
      return state.delayedTricks[frame.ownerId]?.find((entry) => entry.card.id === frame.cardUid)?.card.name ?? "判定";
    case "duel": return "约斗";
    case "horde": return "合围";
    case "volley": return "齐射";
    case "protect": return "护主";
    case "probe": return "刺探";
    case "trick":
      return frame.cardType === "nullify"
        ? "无懈"
        : state.discard.find((card) => card.id === frame.cardUid)?.name ?? "锦囊";
  }
}

function Seat({ player, active, targetable, delayedCards, onTarget, onInspect, selectionActive }: {
  player: DingPlayer;
  active: boolean;
  targetable: boolean;
  selectionActive: boolean;
  delayedCards: readonly DingCard[];
  onTarget: (id: PlayerId) => void;
  onInspect: (id: PlayerId) => void;
}) {
  const identity = player.revealed ? IDENTITY_NAMES[player.identity] : "？";
  const hero = HERO_CATALOG[player.heroId as HeroId];
  const equipment = [
    player.equipment.weapon,
    player.equipment.armor,
    player.equipment.minusHorse,
    player.equipment.plusHorse,
  ].filter((card): card is DingCard => Boolean(card));

  return (
    <button
      type="button"
      className={`ding-seat ding-seat--${SEAT_LAYOUT[player.id]} ${active ? "is-active" : ""} ${targetable ? "is-targetable" : ""} ${selectionActive && !targetable ? "is-invalid" : ""} ${!player.alive ? "is-dead" : ""}`}
      onClick={() => targetable ? onTarget(player.id) : onInspect(player.id)}
      aria-label={`${player.displayName}，${identity}，${hero ? `${hero.name}·${hero.skillName}` : "无武将"}，体力 ${player.hp}/${player.maxHp}，${player.hand.length} 张手牌${targetable ? "，可选为目标" : ""}`}
    >
      <span className="ding-seat__mark" aria-hidden="true">{player.revealed ? IDENTITY_NAMES[player.identity].slice(0, 1) : "隐"}</span>
      <span className="ding-seat__copy">
        <small>{player.revealed ? IDENTITY_NAMES[player.identity] : "身份隐藏"}</small>
        <strong>{player.displayName}</strong>
        {hero && <i className="ding-seat__hero" title={`${hero.title} · ${hero.description}`}>{hero.name} · {hero.skillName}</i>}
        <i className="ding-hp"><b style={{ width: `${Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100))}%` }} /></i>
        <em>{player.alive ? `${player.hp}/${player.maxHp} · ${player.hand.length} 张` : "已退场"}</em>
        {delayedCards.length > 0 && <span className="ding-seat__delayed">{delayedCards.map((card) => card.name).join(" · ")}</span>}
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
    () => persistence?.restored
      ? restoreDingRootState(persistence.restored.schemaVersion, persistence.restored.data)
      : undefined,
    [persistence],
  );
  const initialRoot = useMemo(() => {
    const base = restored ?? createDefaultDingRootState();
    return base.activeMatch
      ? base
      : startDingMatchWithHeroDraft(base, base.preferences.difficulty, Math.random);
  }, [restored]);
  const [root, setRoot] = useState<DingRootState>(initialRoot);
  const state = root.activeMatch!.state;
  const heroDraft = root.activeMatch?.heroDraft;
  const [showRules, setShowRules] = useState(false);
  const [showRulesAfterDraft, setShowRulesAfterDraft] = useState(restored === undefined);
  function transition(update: (current: DingState) => DingState) {
    setRoot((current) => {
      const active = current.activeMatch;
      if (!active || active.resultRecorded) return current;
      return updateActiveDingMatch(current, update(active.state));
    });
  }
  const [showLog, setShowLog] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [resultLogMode, setResultLogMode] = useState<"key" | "full">("key");
  const [selectedCardUid, setSelectedCardUid] = useState<string>();
  const [selectedTargetId, setSelectedTargetId] = useState<PlayerId>();
  const [discardSelection, setDiscardSelection] = useState<readonly string[]>([]);
  const [skillCostUid, setSkillCostUid] = useState<string>();
  const [skillTargetId, setSkillTargetId] = useState<PlayerId>();
  const [protectCardUid, setProtectCardUid] = useState<string>();
  const [probeGuess, setProbeGuess] = useState<IdentityId>();
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
  const profileRef = useModalFocus({
    active: showProfile,
    initialFocus: ".ding-profile__close",
    onDismiss: () => setShowProfile(false),
  });
  const resultRef = useModalFocus({
    active: state.status === "finished" && !showRules,
    initialFocus: ".ding-result__actions button",
  });

  const human = state.players.find((player) => player.controller === "human")!;
  const active = state.players.find((player) => player.id === state.activePlayerId)!;
  const selectedCard = selectedCardUid ? human.hand.find((card) => card.id === selectedCardUid) : undefined;
  const stackTop = state.stack.at(-1);
  const playableCards = state.status === "playing" && state.phase === "play" && state.stack.length === 0 && active.id === human.id
    ? getPlayableCards(state, human.id)
    : [];
  const targetOptions = selectedCard ? getTargetOptions(state, human.id, selectedCard) : [];
  const pendingStrike = stackTop?.kind === "strike" ? stackTop : undefined;
  const pendingDying = stackTop?.kind === "dying" ? stackTop : undefined;
  const pendingSkill = stackTop?.kind === "skill" ? stackTop : undefined;
  const pendingSkillOwner = pendingSkill
    ? state.players.find((player) => player.id === pendingSkill.ownerId)
    : undefined;
  const pendingHeroSkill = pendingSkillOwner
    ? HERO_CATALOG[pendingSkillOwner.heroId as HeroId]?.activeSkill
    : undefined;
  const pendingSkillDefinition = pendingHeroSkill?.id === pendingSkill?.skillId
    ? pendingHeroSkill
    : undefined;
  const pendingSkillNeedsCost = pendingSkillDefinition?.cost.kind === "discard";
  const pendingSkillCostFilter = pendingSkillDefinition?.cost.kind === "discard"
    ? pendingSkillDefinition.cost.filter
    : undefined;
  const pendingSkillCostCards = human.hand.filter((card) =>
    matchesActiveSkillCardFilter(card, pendingSkillCostFilter));
  const pendingSkillNeedsTarget = pendingSkillDefinition ? pendingSkillDefinition.target !== "self" : false;
  const pendingSkillCostValid = !pendingSkillNeedsCost
    || pendingSkillCostCards.some((card) => card.id === skillCostUid);
  const pendingSkillTargetValid = !pendingSkillNeedsTarget
    || Boolean(skillTargetId && pendingSkill?.targetIds.includes(skillTargetId));
  const pendingSkillConfirmReady = Boolean(pendingSkillDefinition)
    && pendingSkillCostValid
    && pendingSkillTargetValid;
  const pendingTrick = stackTop?.kind === "trick" ? stackTop : undefined;
  const pendingDuel = stackTop?.kind === "duel" ? stackTop : undefined;
  const pendingHorde = stackTop?.kind === "horde" ? stackTop : undefined;
  const pendingVolley = stackTop?.kind === "volley" ? stackTop : undefined;
  const pendingDelayed = stackTop?.kind === "delayed" ? stackTop : undefined;
  const pendingProtect = stackTop?.kind === "protect" ? stackTop : undefined;
  const pendingProbe = stackTop?.kind === "probe" ? stackTop : undefined;
  const dyingResponder = pendingDying ? pendingDying.responders[pendingDying.cursor] : undefined;
  const trickResponder = pendingTrick?.awaitingResponse ? pendingTrick.responders[pendingTrick.cursor] : undefined;
  const duelResponder = pendingDuel?.turnId;
  const hordeResponder = pendingHorde ? pendingHorde.responders[pendingHorde.cursor] : undefined;
  const volleyResponder = pendingVolley ? pendingVolley.responders[pendingVolley.cursor] : undefined;
  const humanCanUseSkill = state.status === "playing" && state.phase === "play" && active.id === human.id && state.stack.length === 0;
  const activeSkillOffer = humanCanUseSkill ? getActiveSkillUse(state, human.id) : undefined;
  const humanCanPlay = playableCards.length > 0 && humanCanUseSkill;
  const humanDiscarding = state.phase === "discard" && active.id === human.id && requiredDiscards(state, human.id) > 0 && state.stack.length === 0;
  const humanRespondingStrike = pendingStrike?.targetId === human.id;
  const humanRespondingDying = dyingResponder === human.id;
  const humanRespondingSkill = pendingSkill?.ownerId === human.id;
  const humanRespondingTrick = trickResponder === human.id;
  const humanRespondingDuel = duelResponder === human.id;
  const humanRespondingHorde = hordeResponder === human.id;
  const humanRespondingVolley = volleyResponder === human.id;
  const humanRespondingProtect = pendingProtect?.protectorId === human.id;
  const humanRespondingProbe = pendingProbe?.actorId === human.id;
  const overlayOpen = showRules || showLog || showProfile || state.status === "finished" || Boolean(heroDraft);
  const pendingHumanResponse = humanRespondingStrike
    || humanRespondingDying
    || humanRespondingSkill
    || humanRespondingTrick
    || humanRespondingDuel
    || humanRespondingHorde
    || humanRespondingVolley
    || humanRespondingProtect
    || humanRespondingProbe;

  const shouldAutomate = state.status === "playing"
    && !overlayOpen
    && !pendingHumanResponse
    && (
      state.stack.length > 0
      || !active.alive
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
        transition((current) => {
          if (current.revision !== expectedRevision || current.stack.at(-1)?.kind !== "strike") return current;
          return respondToStrike(current, responder.id, evadeUid);
        });
      }, playbackDelay(560, playbackSpeed));
      return () => window.clearTimeout(timer);
    }

    if (pendingDying && dyingResponder) {
      const salveUid = chooseAiDyingResponse(state, dyingResponder);
      const timer = window.setTimeout(() => {
        playSound(salveUid ? "heal" : "tap");
        transition((current) => {
          const pending = current.stack.at(-1);
          if (current.revision !== expectedRevision || pending?.kind !== "dying") return current;
          const responder = pending.responders[pending.cursor];
          return respondToDying(current, responder, salveUid);
        });
      }, playbackDelay(560, playbackSpeed));
      return () => window.clearTimeout(timer);
    }

    if (pendingSkill && pendingSkill.ownerId !== human.id) {
      const decision = chooseAiSkillDecision(state, pendingSkill.ownerId);
      const timer = window.setTimeout(() => {
        playSound(decision ? "heal" : "tap");
        transition((current) => {
          const pending = current.stack.at(-1);
          if (current.revision !== expectedRevision || pending?.kind !== "skill") return current;
          return respondToSkill(current, pending.ownerId, decision);
        });
      }, playbackDelay(560, playbackSpeed));
      return () => window.clearTimeout(timer);
    }

    if (pendingDelayed) {
      const timer = window.setTimeout(() => {
        playSound("card");
        transition((current) => {
          const pending = current.stack.at(-1);
          if (current.revision !== expectedRevision || pending?.kind !== "delayed") return current;
          return respondToDelayed(current, pending.ownerId);
        });
      }, playbackDelay(560, playbackSpeed));
      return () => window.clearTimeout(timer);
    }

    if (pendingProtect && pendingProtect.protectorId !== human.id) {
      const cardUid = chooseAiProtectResponse(state, pendingProtect.protectorId);
      const timer = window.setTimeout(() => {
        playSound(cardUid ? "card" : "tap");
        transition((current) => {
          const pending = current.stack.at(-1);
          if (current.revision !== expectedRevision || pending?.kind !== "protect") return current;
          return respondToProtect(current, pending.protectorId, cardUid);
        });
      }, playbackDelay(560, playbackSpeed));
      return () => window.clearTimeout(timer);
    }

    if (pendingProbe && pendingProbe.actorId !== human.id) {
      const guess = chooseAiProbeGuess(state, pendingProbe.actorId);
      const timer = window.setTimeout(() => {
        playSound(guess ? "card" : "tap");
        transition((current) => {
          const pending = current.stack.at(-1);
          if (current.revision !== expectedRevision || pending?.kind !== "probe") return current;
          return respondToProbe(current, pending.actorId, guess);
        });
      }, playbackDelay(560, playbackSpeed));
      return () => window.clearTimeout(timer);
    }

    if (pendingTrick && trickResponder) {
      const nullifyUid = chooseAiNullifyResponse(state, trickResponder);
      const timer = window.setTimeout(() => {
        playSound(nullifyUid ? "card" : "tap");
        transition((current) => {
          const pending = current.stack.at(-1);
          if (current.revision !== expectedRevision || pending?.kind !== "trick") return current;
          const responder = pending.responders[pending.cursor];
          return respondToTrick(current, responder, nullifyUid);
        });
      }, playbackDelay(560, playbackSpeed));
      return () => window.clearTimeout(timer);
    }

    if (pendingDuel && duelResponder) {
      const strikeUid = chooseAiDuelResponse(state, duelResponder);
      const timer = window.setTimeout(() => {
        playSound(strikeUid ? "card" : "hit");
        transition((current) => {
          const pending = current.stack.at(-1);
          if (current.revision !== expectedRevision || pending?.kind !== "duel") return current;
          return respondToDuel(current, pending.turnId, strikeUid);
        });
      }, playbackDelay(560, playbackSpeed));
      return () => window.clearTimeout(timer);
    }

    if (pendingHorde && hordeResponder) {
      const strikeUid = chooseAiHordeResponse(state, hordeResponder);
      const timer = window.setTimeout(() => {
        playSound(strikeUid ? "card" : "hit");
        transition((current) => {
          const pending = current.stack.at(-1);
          if (current.revision !== expectedRevision || pending?.kind !== "horde") return current;
          const responder = pending.responders[pending.cursor];
          return respondToHorde(current, responder, strikeUid);
        });
      }, playbackDelay(560, playbackSpeed));
      return () => window.clearTimeout(timer);
    }

    if (pendingVolley && volleyResponder) {
      const evadeUid = chooseAiVolleyResponse(state, volleyResponder);
      const timer = window.setTimeout(() => {
        playSound(evadeUid ? "card" : "hit");
        transition((current) => {
          const pending = current.stack.at(-1);
          if (current.revision !== expectedRevision || pending?.kind !== "volley") return current;
          const responder = pending.responders[pending.cursor];
          return respondToVolley(current, responder, evadeUid);
        });
      }, playbackDelay(560, playbackSpeed));
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(() => {
      transition((current) => {
        if (current.revision !== expectedRevision || current.status !== "playing") return current;
        const currentActor = current.players.find((player) => player.id === current.activePlayerId);
        if (!currentActor?.alive) {
          playSound("tap");
          return advancePhase(current);
        }
        if (current.phase === "play" && current.activePlayerId === actorId && current.stack.length === 0) {
          const move = chooseAiMove(current, actorId);
          if (move.kind === "skill") {
            playSound("heal");
            return activateSkill(current, actorId, move.skillId);
          }
          if (move.kind === "play") {
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
  }, [duelResponder, dyingResponder, hordeResponder, human.id, pendingDelayed, pendingDuel, pendingDying, pendingHorde, pendingProbe, pendingProtect, pendingSkill, pendingStrike, pendingTrick, pendingVolley, playSound, playbackSpeed, shouldAutomate, state, trickResponder, volleyResponder]);

  useEffect(() => {
    if (!persistence || saveBlocked) return;
    const saved = persistence.save(DING_SAVE_SCHEMA_VERSION, root.revision, serializeDingRootState(root));
    if (saved) return;
    const timer = window.setTimeout(() => setNotice("本机存档不可用，本次进度只在当前页面保留。"), 0);
    return () => window.clearTimeout(timer);
  }, [persistence, root, saveBlocked]);

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
    transition((current) => playCard(current, human.id, selectedCardUid, targetId));
    setSelectedCardUid(undefined);
    setSelectedTargetId(undefined);
    setNotice(undefined);
    playSound("card");
  }

  function confirmDiscard() {
    if (!humanDiscarding) return;
    transition((current) => discardCards(current, human.id, discardSelection));
    setDiscardSelection([]);
    setNotice(undefined);
    playSound("tap");
  }

  function restart() {
    setRoot((current) => {
      const base = current.activeMatch?.resultRecorded ? dismissDingMatch(current) : current;
      return startDingMatchWithHeroDraft(base, base.preferences.difficulty, Math.random);
    });
    setShowRulesAfterDraft(false);
    setSelectedCardUid(undefined);
    setSelectedTargetId(undefined);
    setDiscardSelection([]);
    setSkillCostUid(undefined);
    setSkillTargetId(undefined);
    setProtectCardUid(undefined);
    setProbeGuess(undefined);
    setShowRules(false);
    setResultLogMode("key");
    setNotice(undefined);
    playSound("card");
  }

  function selectDraftHero(heroId: HeroId) {
    setRoot((current) => chooseDingMatchHero(current, heroId));
    setShowRules(showRulesAfterDraft);
    setShowRulesAfterDraft(false);
    playSound("card");
  }

  const trickCardName = (frame: { readonly cardUid: string }) =>
    state.discard.find((card) => card.id === frame.cardUid)?.name ?? "锦囊";
  const counterFrame = pendingTrick?.counterFrameId
    ? state.stack.find((frame) => frame.kind === "trick" && frame.frameId === pendingTrick.counterFrameId)
    : undefined;
  const counterTargetName = counterFrame?.kind === "trick" ? trickCardName(counterFrame) : "锦囊";

  const tableMessage = pendingDelayed
    ? `${state.players.find((player) => player.id === pendingDelayed.ownerId)?.displayName}的「${state.delayedTricks[pendingDelayed.ownerId]?.find((entry) => entry.card.id === pendingDelayed.cardUid)?.card.name ?? "延时锦囊"}」正在判定。`
    : pendingStrike
    ? `${state.players.find((player) => player.id === pendingStrike.actorId)?.displayName}的「刺击」等待响应。`
    : pendingProtect
      ? `${state.players.find((player) => player.id === pendingProtect.targetId)?.displayName}受到刺击，辅臣可以弃 1 张手牌护主。`
      : pendingProbe
        ? `${state.players.find((player) => player.id === pendingProbe.actorId)?.displayName}正在猜测${state.players.find((player) => player.id === pendingProbe.targetId)?.displayName}的身份。`
        : pendingDying
      ? `${state.players.find((player) => player.id === pendingDying.targetId)?.displayName}正在濒死求援。`
      : pendingSkill
        ? `${state.players.find((player) => player.id === pendingSkill.ownerId)?.displayName}正在决定${HERO_CATALOG[state.players.find((player) => player.id === pendingSkill.ownerId)?.heroId as HeroId]?.activeSkill?.name ?? "主动技"}的目标。`
        : pendingTrick
        ? pendingTrick.cardType === "nullify"
          ? `${state.players.find((player) => player.id === pendingTrick.actorId)?.displayName}的「无懈可击」等待反制响应。`
          : `${state.players.find((player) => player.id === pendingTrick.actorId)?.displayName}的「${state.discard.find((card) => card.id === pendingTrick.cardUid)?.name ?? "锦囊"}」等待无懈可击响应。`
        : pendingDuel
          ? `${state.players.find((player) => player.id === pendingDuel.turnId)?.displayName}需要打出「刺击」应对约斗。`
          : pendingHorde
            ? `${state.players.find((player) => player.id === pendingHorde.responders[pendingHorde.cursor])?.displayName}需要打出「刺击」抵御合围。`
            : pendingVolley
              ? `${state.players.find((player) => player.id === pendingVolley.responders[pendingVolley.cursor])?.displayName}需要打出「闪避」躲避齐射。`
              : state.lastAction?.text ?? "等待行动。";
  const required = humanDiscarding ? requiredDiscards(state, human.id) : 0;
  const discardReady = humanDiscarding && discardSelection.length === required;

  return (
    <main className="ding-screen">
      <header className="ding-topbar">
        <button type="button" onClick={onExit} aria-label="返回游戏大厅">←</button>
        <div className="ding-title"><small>CARDFORGE · TABLE 004</small><strong>定鼎 · 身份局</strong></div>
        <div className="ding-tools">
          <button type="button" onClick={() => setShowProfile(true)} aria-label="查看定鼎战绩">▤</button>
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

      {heroDraft && <DingHeroDraft options={heroDraft.options} onChoose={selectDraftHero} onExit={onExit} />}

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
                delayedCards={state.delayedTricks[player.id].map((entry) => entry.card)}
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
            {state.stack.length > 0 && (
              <div className="ding-stack" aria-label={`结算栈，共 ${state.stack.length} 层`}>
                {state.stack.map((frame, index) => (
                  <span key={`${frame.kind}-${index}`} className={index === state.stack.length - 1 ? "is-top" : ""}>
                    <i aria-hidden="true">{index + 1}</i>
                    {frameLabel(frame, state)}
                  </span>
                ))}
              </div>
            )}
            <p key={state.revision}>{notice ?? tableMessage}</p>
          </div>
        </div>
      </section>

      {pendingHumanResponse ? (
        <section className="ding-response" aria-label="响应区">
          {humanRespondingSkill && pendingSkill ? (
            <>
              <div>
                <small>武将主动技</small>
                <strong>{pendingSkillDefinition?.name ?? "主动技"}</strong>
                <p>{pendingSkill.prompt}</p>
              </div>
              {pendingSkillNeedsCost && (
                <div className="ding-skill-panel">
                  <div className="ding-skill-cost" aria-label="选择消耗手牌">
                    <small>选择一张手牌作为消耗</small>
                    <div>
                      {pendingSkillCostCards.map((card) => (
                        <button
                          key={card.id}
                          type="button"
                          className={`ding-card ding-card--${card.type} ${skillCostUid === card.id ? "is-selected" : ""}`}
                          style={{ "--card-tone": card.tone } as CSSProperties}
                          onClick={() => {
                            setSkillCostUid(skillCostUid === card.id ? undefined : card.id);
                            playSound("tap");
                          }}
                          aria-pressed={skillCostUid === card.id}
                          aria-label={`选择「${card.name}」作为技能消耗`}
                        >
                          <span className="ding-card__symbol" aria-hidden="true">{card.symbol}</span>
                          <strong>{card.name}</strong>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {pendingSkillNeedsTarget && (
                <div className="ding-skill-panel">
                  <div className="ding-skill-targets" aria-label="选择技能目标">
                    <small>{pendingSkillDefinition?.effect.kind === "heal-1" || pendingSkillDefinition?.effect.kind === "draw-target" ? "选择获得回复 / 摸牌的角色" : pendingSkillDefinition?.effect.kind === "damage" ? "选择受到伤害的角色" : pendingSkillDefinition?.effect.kind === "discard-target" ? "选择弃置手牌的角色" : "选择技能目标"}</small>
                    <div>
                      {pendingSkill.targetIds.map((targetId) => {
                        const target = state.players.find((player) => player.id === targetId)!;
                        return (
                          <button
                            key={targetId}
                            type="button"
                            className={skillTargetId === targetId ? "is-selected" : ""}
                            onClick={() => {
                              setSkillTargetId(targetId);
                              playSound("tap");
                            }}
                            aria-pressed={skillTargetId === targetId}
                            aria-label={`选择${target.displayName}作为技能目标`}
                          >
                            <b>{target.displayName}</b>
                            <span>{target.hp}/{target.maxHp}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              <div className="ding-response__actions">
                <button
                  type="button"
                  disabled={!pendingSkillConfirmReady}
                  onClick={() => {
                    if (!pendingSkillConfirmReady) return;
                    const cardUid = pendingSkillNeedsCost ? skillCostUid : undefined;
                    const targetId = pendingSkillNeedsTarget ? skillTargetId : undefined;
                    transition((current) => respondToSkill(current, human.id, { cardUid, targetId }));
                    setSkillCostUid(undefined);
                    setSkillTargetId(undefined);
                    playSound(pendingSkillDefinition?.effect.kind === "draw" || pendingSkillDefinition?.effect.kind === "draw-discard" ? "card" : "heal");
                  }}
                >确认发动</button>
                <button type="button" onClick={() => {
                  transition((current) => respondToSkill(current, human.id));
                  setSkillCostUid(undefined);
                  setSkillTargetId(undefined);
                  playSound("tap");
                }}>放弃发动</button>
              </div>
            </>
          ) : null}
          {humanRespondingStrike && pendingStrike ? (
            <>
              <div>
                <small>需要响应 · 刺击</small>
                <strong>{state.players.find((player) => player.id === pendingStrike.actorId)?.displayName}的「刺击」正指向你</strong>
                <p>{pendingStrike.unavoidable ? "此击无法被「闪避」响应，只能承受。" : "打出「闪避」抵消伤害，或选择承受。"}</p>
              </div>
              <div className="ding-response__actions">
                {!pendingStrike.unavoidable && human.hand.filter((card) => card.type === "evade").map((card) => (
                  <button key={card.id} type="button" onClick={() => {
                    transition((current) => respondToStrike(current, human.id, card.id));
                    playSound("card");
                  }}>闪避</button>
                ))}
                <button type="button" onClick={() => {
                  transition((current) => respondToStrike(current, human.id));
                  playSound("hit");
                }}>承受攻击</button>
              </div>
            </>
          ) : null}
          {humanRespondingProtect && pendingProtect ? (
            <>
              <div>
                <small>辅臣护主</small>
                <strong>主君受到刺击</strong>
                <p>你可以弃置任意 1 张手牌，为主君抵挡 1 点伤害；弃置会公开你的辅臣身份。</p>
              </div>
              <div className="ding-skill-panel">
                <div className="ding-skill-cost" aria-label="选择护主弃置的手牌">
                  <small>选择一张手牌（也可以放弃）</small>
                  <div>
                    {human.hand.map((card) => (
                      <button
                        key={card.id}
                        type="button"
                        className={`ding-card ding-card--${card.type} ${protectCardUid === card.id ? "is-selected" : ""}`}
                        style={{ "--card-tone": card.tone } as CSSProperties}
                        onClick={() => {
                          setProtectCardUid(protectCardUid === card.id ? undefined : card.id);
                          playSound("tap");
                        }}
                        aria-pressed={protectCardUid === card.id}
                        aria-label={`选择「${card.name}」护主`}
                      >
                        <span className="ding-card__symbol" aria-hidden="true">{card.symbol}</span>
                        <strong>{card.name}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="ding-response__actions">
                <button
                  type="button"
                  disabled={!protectCardUid}
                  onClick={() => {
                    transition((current) => respondToProtect(current, human.id, protectCardUid));
                    setProtectCardUid(undefined);
                    playSound("card");
                  }}
                >弃置护主</button>
                <button type="button" onClick={() => {
                  transition((current) => respondToProtect(current, human.id));
                  setProtectCardUid(undefined);
                  playSound("tap");
                }}>不护主</button>
              </div>
            </>
          ) : null}
          {humanRespondingProbe && pendingProbe ? (
            <>
              <div>
                <small>刺探身份</small>
                <strong>猜测{state.players.find((player) => player.id === pendingProbe.targetId)?.displayName}的身份</strong>
                <p>猜对会公开其身份并摸两张牌；猜错你会随机弃置一张手牌。</p>
              </div>
              <div className="ding-response__actions">
                {(["loyalist", "rebel", "renegade"] as const).map((identity) => (
                  <button
                    key={identity}
                    type="button"
                    className={probeGuess === identity ? "is-selected" : ""}
                    onClick={() => {
                      setProbeGuess(identity);
                      playSound("tap");
                    }}
                    aria-pressed={probeGuess === identity}
                  >{IDENTITY_NAMES[identity]}</button>
                ))}
              </div>
              <div className="ding-response__actions">
                <button
                  type="button"
                  disabled={!probeGuess}
                  onClick={() => {
                    transition((current) => respondToProbe(current, human.id, probeGuess));
                    setProbeGuess(undefined);
                    playSound("card");
                  }}
                >确认猜测</button>
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
                    transition((current) => respondToDying(current, human.id, card.id));
                    playSound("heal");
                  }}>疗元</button>
                ))}
                <button type="button" onClick={() => {
                  transition((current) => respondToDying(current, human.id));
                  playSound("tap");
                }}>放弃救援</button>
              </div>
            </>
          ) : null}
          {humanRespondingTrick && pendingTrick ? (
            <>
              <div>
                <small>无懈可击响应</small>
                <strong>
                  {pendingTrick.cardType === "nullify"
                    ? `${state.players.find((player) => player.id === pendingTrick.actorId)?.displayName}的「无懈可击」正指向「${counterTargetName}」`
                    : `${state.players.find((player) => player.id === pendingTrick.actorId)?.displayName}的「${trickCardName(pendingTrick)}」等待响应`}
                </strong>
                <p>打出「无懈可击」抵消这张锦囊，或选择不响应。</p>
              </div>
              <div className="ding-response__actions">
                {human.hand.filter((card) => card.type === "nullify").map((card) => (
                  <button key={card.id} type="button" onClick={() => {
                    transition((current) => respondToTrick(current, human.id, card.id));
                    playSound("card");
                  }}>无懈可击</button>
                ))}
                <button type="button" onClick={() => {
                  transition((current) => respondToTrick(current, human.id));
                  playSound("tap");
                }}>不响应</button>
              </div>
            </>
          ) : null}
          {humanRespondingDuel && pendingDuel ? (
            <>
              <div>
                <small>约斗响应</small>
                <strong>约斗轮到你出「刺击」</strong>
                <p>双方轮流打出「刺击」，先打不出的一方受到对方造成的 1 点伤害。</p>
              </div>
              <div className="ding-response__actions">
                {human.hand.filter((card) => card.type === "strike").map((card) => (
                  <button key={card.id} type="button" onClick={() => {
                    transition((current) => respondToDuel(current, human.id, card.id));
                    playSound("card");
                  }}>刺击</button>
                ))}
                <button type="button" onClick={() => {
                  transition((current) => respondToDuel(current, human.id));
                  playSound("hit");
                }}>打不出</button>
              </div>
            </>
          ) : null}
          {humanRespondingHorde && pendingHorde ? (
            <>
              <div>
                <small>合围响应</small>
                <strong>合围压境</strong>
                <p>打出「刺击」抵御，否则受到 {state.players.find((player) => player.id === pendingHorde.actorId)?.displayName} 造成的 1 点伤害。</p>
              </div>
              <div className="ding-response__actions">
                {human.hand.filter((card) => card.type === "strike").map((card) => (
                  <button key={card.id} type="button" onClick={() => {
                    transition((current) => respondToHorde(current, human.id, card.id));
                    playSound("card");
                  }}>刺击</button>
                ))}
                <button type="button" onClick={() => {
                  transition((current) => respondToHorde(current, human.id));
                  playSound("hit");
                }}>不打出</button>
              </div>
            </>
          ) : null}
          {humanRespondingVolley && pendingVolley ? (
            <>
              <div>
                <small>齐射响应</small>
                <strong>齐射袭来</strong>
                <p>打出「闪避」躲避，否则受到 {state.players.find((player) => player.id === pendingVolley.actorId)?.displayName} 造成的 1 点伤害。</p>
              </div>
              <div className="ding-response__actions">
                {human.hand.filter((card) => card.type === "evade").map((card) => (
                  <button key={card.id} type="button" onClick={() => {
                    transition((current) => respondToVolley(current, human.id, card.id));
                    playSound("card");
                  }}>闪避</button>
                ))}
                <button type="button" onClick={() => {
                  transition((current) => respondToVolley(current, human.id));
                  playSound("hit");
                }}>不打出</button>
              </div>
            </>
          ) : null}
        </section>
      ) : (
        <section className="ding-hand-dock" aria-label="你的手牌">
          <header>
            <span>
              <small>你的身份 · {IDENTITY_NAMES[human.identity]}</small>
              <strong>手牌 {human.hand.length}</strong>
              {HERO_CATALOG[human.heroId as HeroId] && (
                <em className="ding-hand__hero" title={HERO_CATALOG[human.heroId as HeroId].description}>
                  {HERO_CATALOG[human.heroId as HeroId].name} · {HERO_CATALOG[human.heroId as HeroId].skillName}
                </em>
              )}
            </span>
            <span className="ding-action-copy">
              {humanDiscarding
                ? `弃牌阶段：请选 ${required} 张弃置（${discardSelection.length}/${required}）`
                : humanCanPlay && selectedCard
                  ? targetOptions.length > 1
                    ? `请选择「${selectedCard.name}」的目标`
                    : `点击出牌使用「${selectedCard.name}」`
                  : humanCanPlay
                    ? "选择一张可出的牌，或发动武将技能"
                    : state.phase === "play" && active.id === human.id
                      ? activeSkillOffer
                        ? `可以发动「${activeSkillOffer.skill.name}」，或结束回合`
                        : "本回合没有可出的牌，可以结束回合"
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
                <button
                  type="button"
                  className="ding-action ding-action--skill"
                  disabled={!activeSkillOffer}
                  onClick={() => {
                    if (!activeSkillOffer) return;
                    transition((current) => activateSkill(current, human.id, activeSkillOffer.skill.id));
                    setSelectedCardUid(undefined);
                    setSelectedTargetId(undefined);
                    setSkillCostUid(undefined);
                    setSkillTargetId(undefined);
                    playSound("heal");
                  }}
                >{activeSkillOffer ? `${activeSkillOffer.skill.name}` : "武将技能"}</button>
                <button type="button" className="ding-action ding-action--primary" disabled={!humanCanPlay || !selectedCardUid} onClick={playSelection}>出牌 →</button>
                <button type="button" className="ding-action" disabled={!(state.phase === "play" && active.id === human.id && state.stack.length === 0)} onClick={() => {
                  transition((current) => endTurn(current, human.id));
                  setSelectedCardUid(undefined);
                  setSelectedTargetId(undefined);
                  setSkillCostUid(undefined);
                  setSkillTargetId(undefined);
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

      {showProfile && (
        <div ref={profileRef} className="ding-modal ding-modal--profile">
          <DingProfilePanel profile={root.lifetimeProfile} onClose={() => setShowProfile(false)} />
        </div>
      )}

      {showRules && (
        <div ref={rulesRef} className="ding-modal" role="dialog" aria-modal="true" aria-labelledby="ding-rules-title" tabIndex={-1}>
          <article className="ding-rules">
            <button type="button" className="ding-rules__close" onClick={() => setShowRules(false)} aria-label="关闭规则">×</button>
            <span className="ding-rules__ribbon">身份局</span>
            <small>TABLE 004 · M5 身份体验</small>
            <h2 id="ding-rules-title">四席暗局，<br />先明主君，再定鼎。</h2>
            <p>主君身份公开并多 1 点体力；其余三人身份隐藏。主君与辅臣要清剿叛锋与流谋；叛锋要在主君倒下时达阵；流谋必须成为主君倒下时唯一的其他存活者。</p>
            <div className="ding-rules__grid">
              <span><b>回合</b>准备 → 判定 → 摸 2 张 → 出牌 → 弃牌到手牌上限（等于当前体力）</span>
              <span><b>刺击</b>攻击范围内每回合一次；目标可出「闪避」</span>
              <span><b>疗元</b>受伤时自疗，或在任何人濒死时救援</span>
              <span><b>锦囊</b>聚势/拆解/牵袭/约斗/合围/齐射/同袍/刺探先询问「无懈可击」，再进结算栈；拆解与牵袭可作用于手牌、装备或判定区</span>
              <span><b>延时</b>断锋/困阵/焚营进入判定区，在判定阶段翻牌顶判定后结算</span>
              <span><b>无懈</b>抵消一张锦囊；无懈本身可被另一张无懈反制，层层嵌套后自栈顶结算</span>
              <span><b>约斗</b>目标先出「刺击」，双方轮流；先打不出的一方受对方 1 点伤害</span>
              <span><b>合围/齐射</b>其他角色依次需出「刺击」/「闪避」，否则受 1 点伤害</span>
              <span><b>武将</b>开局从三名武将中选一，AI 从其余武将补位；武将体力为 3 或 4，主君 +1，技能在回合、伤害、濒死或锦囊结算时触发</span>
              <span><b>距离</b>相邻座位为 1；赤影 -1、磐影 +1、长锋射程 2、穿云射程 3；犀甲每回合首次受伤 -1</span>
              <span><b>胜负</b>主君死时若只剩流谋则流谋胜，否则叛锋胜；叛锋与流谋全灭则主君方胜</span>
              <span><b>奖惩</b>击退叛锋摸 3 张；流谋不取奖惩；主君误杀辅臣弃光手牌。主君倒下即终局</span>
              <span><b>护主</b>主君被刺击且未闪避时，存活辅臣可自选是否弃 1 张手牌抵挡 1 点伤害；弃牌会公开辅臣身份</span>
              <span><b>过载</b>第 24 轮起，每跨过一整轮对存活角色造成递增真实伤害，但不会致死</span>
            </div>
            <p className="ding-rules__scope">M5 已加入三选一选将、身份与武将战绩、结算栈复盘；辅臣护主、牌局过载及三档身份 AI 同时启用。</p>
            <div className="ding-difficulty" role="radiogroup" aria-label="对手难度">
              <small>对手 AI 难度 · 对当前及后续牌局生效</small>
              <div>
                {DIFFICULTY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={state.difficulty === option.id}
                    className={state.difficulty === option.id ? "is-selected" : ""}
                    onClick={() => {
                      transition((current) => changeDifficulty(current, option.id));
                      playSound("tap");
                    }}
                  >
                    <strong>{DING_DIFFICULTY_NAMES[option.id]}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="ding-rules__enter" onClick={() => { setShowRules(false); playSound("card"); }}>入席开局 <span>→</span></button>
          </article>
        </div>
      )}

      {state.status === "finished" && state.winner && (
        <div ref={resultRef} className="ding-modal" role="dialog" aria-modal="true" aria-labelledby="ding-result-title" tabIndex={-1}>
          <article className="ding-result">
            <span className="ding-result__seal" aria-hidden="true">鼎</span>
            <small>第 {state.turnNumber} 回合 · {DING_DIFFICULTY_NAMES[state.difficulty]}难度 · 身份局</small>
            <h2 id="ding-result-title">{WINNER_COPY[state.winner].title}</h2>
            <p>{WINNER_COPY[state.winner].detail}</p>
            <div className="ding-result__identities">
              {state.players.map((player) => {
                const hero = HERO_CATALOG[player.heroId as HeroId];
                return (
                  <span key={player.id}>
                    <b>{player.displayName}</b>
                    <small>{IDENTITY_NAMES[player.identity]}{hero ? ` · ${hero.name}` : ""}</small>
                    <em title={hero?.description}>{hero?.skillName ?? ""} · {player.alive ? `${player.hp}/${player.maxHp}` : "退场"}</em>
                  </span>
                );
              })}
            </div>
            <div className="ding-result__review">
              <header>
                <strong>对局复盘</strong>
                <div role="group" aria-label="复盘记录筛选">
                  <button type="button" className={resultLogMode === "key" ? "is-selected" : ""} onClick={() => setResultLogMode("key")}>关键节点</button>
                  <button type="button" className={resultLogMode === "full" ? "is-selected" : ""} onClick={() => setResultLogMode("full")}>完整记录</button>
                </div>
              </header>
              <ol>
                {[...state.log].reverse()
                  .filter((entry) => resultLogMode === "full" || [
                    "退场", "濒死", "无懈", "判定", "跳过", "发动", "胜负", "赢下", "达成",
                  ].some((keyword) => entry.text.includes(keyword)))
                  .map((entry) => <li key={entry.id}><small>#{entry.id}</small><span>{entry.text}</span></li>)}
              </ol>
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
