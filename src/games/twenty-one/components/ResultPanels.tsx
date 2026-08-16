import { evaluateHand } from "../domain/engine";
import { CHALLENGES, type ActiveTwentyOneSession, type TwentyOneRootState } from "../domain/session";
import type { HandOutcome } from "../domain/types";
import { OUTCOME_COPY, sessionSummaryTitle } from "./resultPresentation";

const HAND_OUTCOME_COPY: Record<HandOutcome, string> = {
  win: "胜",
  loss: "负",
  push: "和",
  blackjack: "Blackjack",
  surrender: "投降",
};

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

interface OutcomeTicketProps {
  session: ActiveTwentyOneSession;
  onNext: () => void;
  onExit: () => void;
}

export function OutcomeTicket({ session, onNext, onExit }: OutcomeTicketProps) {
  const { table } = session;
  const settlement = table.settlement;
  if (!settlement) return null;
  const copy = OUTCOME_COPY[settlement.outcome];
  const dealerValue = evaluateHand(table.dealerHand);
  const challenge = session.mode === "challenge" && session.challengeId ? CHALLENGES[session.challengeId] : undefined;

  return (
    <article className={`outcome-ticket outcome-ticket--${settlement.outcome}`}>
      <span className="outcome-ticket__mark" aria-hidden="true">{copy.mark}</span>
      <small>{copy.eyebrow}</small>
      <h2 id="twenty-one-result-title">{copy.title}</h2>
      <p>{settlement.reason}</p>
      <div className="tw-result-hands" aria-label="逐手结算">
        {settlement.handResults.map((result, index) => {
          const hand = table.hands.find((entry) => entry.id === result.handId);
          const total = hand ? evaluateHand(hand.cards).total : "—";
          return (
            <div key={result.handId} className={`is-${result.outcome}`}>
              <span><small>手牌 {index + 1}</small><strong>{total} 点</strong></span>
              <span><small>{HAND_OUTCOME_COPY[result.outcome]}</small><strong>{signed(result.net)}</strong></span>
            </div>
          );
        })}
        <div className="tw-result-dealer"><span><small>庄家</small><strong>{dealerValue.total} 点</strong></span><span><small>保险</small><strong>{signed(settlement.insurance.net)}</strong></span></div>
      </div>
      <div className={`outcome-ticket__payout ${settlement.net > 0 ? "is-gain" : settlement.net < 0 ? "is-loss" : ""}`}>
        <span><small>本轮</small><strong>{signed(settlement.net)}</strong></span>
        <i aria-hidden="true">→</i>
        <span><small>筹码</small><strong>{table.chips}</strong></span>
      </div>
      {challenge && <p className="tw-result-progress">{challenge.name} · 已完成 {session.roundsCompleted}/{challenge.roundLimit} 手</p>}
      <div className="outcome-ticket__actions">
        <button type="button" onClick={onNext}>下一手 <span aria-hidden="true">→</span></button>
        <button type="button" onClick={onExit}>返回大厅</button>
      </div>
    </article>
  );
}

interface SessionSummaryProps {
  root: TwentyOneRootState;
  onRetry: () => void;
  onModeSelect: () => void;
}

export function SessionSummary({ root, onRetry, onModeSelect }: SessionSummaryProps) {
  const session = root.activeSession;
  if (!session || session.status !== "summary") return null;
  const challenge = session.mode === "challenge" && session.challengeId ? CHALLENGES[session.challengeId] : undefined;
  const cleared = session.endReason === "challenge-cleared";
  const bankrupt = session.endReason === "bankrupt";
  const title = sessionSummaryTitle(root);
  const mark = challenge ? (cleared ? "成" : "止") : bankrupt ? "尽" : "结";
  const stats = session.sessionStats;
  const record = challenge && session.challengeId
    ? root.challengeRecords[session.challengeId][session.assisted ? "assisted" : "unassisted"]
    : undefined;

  return (
    <article className={`outcome-ticket session-summary ${cleared ? "outcome-ticket--player" : "outcome-ticket--dealer"}`}>
      <span className="outcome-ticket__mark" aria-hidden="true">{mark}</span>
      <small>{challenge ? challenge.eyebrow : "CLASSIC SESSION"}</small>
      <h2 id="twenty-one-summary-title">{title}</h2>
      <p>{challenge
        ? cleared ? `你完成了「${challenge.name}」的目标。` : `${challenge.name}本次未能达成，记录已经留在本机。`
        : bankrupt ? "余额已低于最低下注，保留生涯记录后重新入座。" : "这是你主动结束的经典会话总结。"}</p>
      <div className="tw-summary-hero">
        <span><small>终局筹码</small><strong>{session.table.chips}</strong></span>
        <span><small>本席净值</small><strong>{signed(stats.netChips)}</strong></span>
        <span><small>完成局数</small><strong>{session.roundsCompleted}</strong></span>
      </div>
      <div className="tw-summary-details">
        <span>胜 / 负 / 和 <b>{stats.handsWon} / {stats.handsLost} / {stats.handsPushed}</b></span>
        <span>Blackjack <b>{stats.blackjacks}</b></span>
        <span>最佳连胜 <b>{stats.bestWinStreak}</b></span>
        {record && <span>{session.assisted ? "辅助记录" : "无辅助记录"} <b>最佳 {record.bestFinalChips ?? session.table.chips}</b></span>}
      </div>
      <div className="outcome-ticket__actions">
        <button type="button" onClick={onRetry}>{challenge ? "再挑战一次" : "重新入座"} <span aria-hidden="true">→</span></button>
        <button type="button" onClick={onModeSelect}>返回模式选择</button>
      </div>
    </article>
  );
}
