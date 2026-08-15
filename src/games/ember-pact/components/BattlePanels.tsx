import { useEffect, useRef } from "react";
import { useModalFocus } from "../../../shared/ui/useModalFocus";
import { DIFFICULTY_NAMES, TEAM_NAMES } from "../domain/data";
import { getCard } from "../domain/engine";
import type { LifetimePlayerMetrics } from "../domain/session";
import type {
  CardInstance,
  Combatant,
  CombatantMetrics,
  Difficulty,
  MatchWinner,
  TeamId,
} from "../domain/types";

interface ResponsePanelProps {
  attacker: Combatant;
  responder: Combatant;
  attackName: string;
  cards: readonly CardInstance[];
  onRespond: (cardUid: string) => void;
  onDecline: () => void;
}

export function ResponsePanel({
  attacker,
  responder,
  attackName,
  cards,
  onRespond,
  onDecline,
}: ResponsePanelProps) {
  const firstResponseRef = useRef<HTMLButtonElement>(null);
  const declineRef = useRef<HTMLButtonElement>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    const target = firstResponseRef.current ?? declineRef.current;
    if (!target) return;
    focusedRef.current = true;
    target.focus({ preventScroll: true });
  }, []);

  return (
    <section className="response-panel" aria-labelledby="response-title">
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        需要响应：{attacker.displayName}的「{attackName}」正攻向{responder.displayName}。
      </p>
      <span className="response-panel__mark" aria-hidden="true">应</span>
      <div className="response-panel__copy">
        <small>敌方回合 · 你的响应</small>
        <strong id="response-title">{attacker.displayName}以「{attackName}」攻向{responder.displayName}</strong>
        <p>卸力不会消耗你下回合的行动力，也可以保留手牌并承受攻击。</p>
      </div>
      <div className="response-panel__actions">
        {cards.map((instance, index) => {
          const card = getCard(instance);
          return (
            <button
              ref={index === 0 ? firstResponseRef : undefined}
              type="button"
              className="response-button"
              key={instance.uid}
              onClick={() => onRespond(instance.uid)}
            >
              <span>{card.symbol}</span>
              <b>{card.name}</b>
              <small>化解 {card.responsePower} 点</small>
            </button>
          );
        })}
        <button ref={declineRef} type="button" className="response-decline" onClick={onDecline}>保留手牌 · 承受攻击</button>
      </div>
    </section>
  );
}

interface ResultPanelProps {
  winner: MatchWinner;
  playerTeam: TeamId;
  difficulty: Difficulty;
  roundNumber: number;
  metrics: CombatantMetrics;
  archiveAvailable: boolean;
  onReplay: () => void;
  onChangeRole: () => void;
  onExit: () => void;
}

export function ResultPanel({
  winner,
  playerTeam,
  difficulty,
  roundNumber,
  metrics,
  archiveAvailable,
  onReplay,
  onChangeRole,
  onExit,
}: ResultPanelProps) {
  const won = winner === playerTeam;
  const drawn = winner === "draw";
  const title = drawn ? "火种相抵，本局战平" : won ? "联手守住了这一焰" : "这一局由对手拿下";
  const modalRef = useModalFocus({ active: true, initialFocus: ".primary-button" });

  return (
    <div ref={modalRef} className="result-overlay" role="dialog" aria-modal="true" aria-labelledby="result-title" tabIndex={-1}>
      <section className={`result-card ${drawn ? "result-card--draw" : `result-card--${winner}`}`}>
        <span className="result-card__seal" aria-hidden="true">{drawn ? "和" : won ? "胜" : "惜"}</span>
        <small>{DIFFICULTY_NAMES[difficulty]} · 第 {roundNumber} 轮</small>
        <h2 id="result-title">{title}</h2>
        <p>{drawn
          ? "双方同时耗尽火种。调整行动顺序，再试一次。"
          : `${TEAM_NAMES[winner as TeamId]}赢得争焰。${won
              ? archiveAvailable ? "你的配合已经写入本机战绩。" : "本机存档不可用，本局记录只在当前页面保留。"
              : "战报会保留这局的关键数据，下一局可以换一位执火者。"}`}</p>

        <div className="result-metrics" aria-label="本局表现">
          <span><small>造成伤害</small><b>{metrics.damageDealt}</b></span>
          <span><small>治疗</small><b>{metrics.healingDone}</b></span>
          <span><small>护盾</small><b>{metrics.blockGranted}</b></span>
          <span><small>联携</small><b>{metrics.combos}</b></span>
          <span><small>击退</small><b>{metrics.defeats}</b></span>
          <span><small>最高一击</small><b>{metrics.biggestHit}</b></span>
        </div>

        <div className="result-actions">
          <button type="button" className="primary-button" onClick={onReplay}>原阵容再战</button>
          <button type="button" className="secondary-button" onClick={onChangeRole}>更换角色与难度</button>
          <button type="button" className="text-button" onClick={onExit}>返回大厅</button>
        </div>
      </section>
    </div>
  );
}

export interface ProfileCharacterRow {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly played: number;
  readonly wins: number;
  readonly bestDifficulty?: Difficulty;
}

export interface ProfileOverview {
  readonly completed: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly currentStreak: number;
  readonly bestStreak: number;
  readonly fastestWinRound?: number;
  readonly lifetimeMetrics: LifetimePlayerMetrics;
  readonly characters: readonly ProfileCharacterRow[];
}

interface ProfilePanelProps {
  profile: ProfileOverview;
  onClose: () => void;
}

export function ProfilePanel({ profile, onClose }: ProfilePanelProps) {
  const modalRef = useModalFocus({ active: true, initialFocus: "button", onDismiss: onClose });
  const winRate = profile.completed === 0 ? "—" : `${Math.round((profile.wins / profile.completed) * 100)}%`;

  return (
    <div ref={modalRef} className="ledger-overlay ledger-overlay--profile" role="dialog" aria-modal="true" aria-labelledby="profile-title" tabIndex={-1} onClick={onClose}>
      <section className="forge-ledger profile-sheet" onClick={(event) => event.stopPropagation()}>
        <header className="forge-ledger__header">
          <span className="ledger-seal" aria-hidden="true">录</span>
          <span><small>只保存在本机</small><h2 id="profile-title">争焰记录</h2></span>
          <button type="button" onClick={onClose} aria-label="关闭争焰记录">×</button>
        </header>

        <div className="profile-summary">
          <span><small>完成对局</small><b>{profile.completed}</b></span>
          <span><small>胜率</small><b>{winRate}</b></span>
          <span><small>胜 / 负 / 和</small><b>{profile.wins}/{profile.losses}/{profile.draws}</b></span>
          <span><small>当前 / 最佳连胜</small><b>{profile.currentStreak}/{profile.bestStreak}</b></span>
          <span><small>最快胜利</small><b>{profile.fastestWinRound ? `${profile.fastestWinRound} 轮` : "—"}</b></span>
        </div>

        <dl className="profile-lifetime" aria-label="累计个人表现">
          <div><dt>累计伤害</dt><dd>{profile.lifetimeMetrics.damageDealt}</dd></div>
          <div><dt>累计治疗</dt><dd>{profile.lifetimeMetrics.healingDone}</dd></div>
          <div><dt>累计护盾</dt><dd>{profile.lifetimeMetrics.blockGranted}</dd></div>
          <div><dt>累计联携</dt><dd>{profile.lifetimeMetrics.combos}</dd></div>
          <div><dt>累计击退</dt><dd>{profile.lifetimeMetrics.defeats}</dd></div>
        </dl>

        <div className="profile-roster">
          {profile.characters.map((character) => (
            <article key={character.id}>
              <span>{character.name}<small>{character.role}</small></span>
              <b>{character.wins} 胜 / {character.played} 局</b>
              <em>{character.bestDifficulty ? `${DIFFICULTY_NAMES[character.bestDifficulty]}通关` : "等待首胜"}</em>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
