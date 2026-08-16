import { CHALLENGES, type ActiveTwentyOneSession, type TwentyOneRootState } from "../domain/session";
import type { TwentyOneOutcome } from "../domain/types";

export const OUTCOME_COPY: Record<TwentyOneOutcome, { eyebrow: string; title: string; mark: string }> = {
  player: { eyebrow: "判断成立", title: "此刻属于你", mark: "胜" },
  dealer: { eyebrow: "风险兑现", title: "庄家守住牌桌", mark: "负" },
  push: { eyebrow: "刻度重合", title: "本局和牌", mark: "和" },
};

export function outcomeTicketTitle(session: ActiveTwentyOneSession): string {
  const outcome = session.table.settlement?.outcome;
  return outcome ? OUTCOME_COPY[outcome].title : "本轮结算";
}

export function sessionSummaryTitle(root: TwentyOneRootState): string {
  const session = root.activeSession;
  if (!session) return "牌局总结";
  const challenge = session.mode === "challenge" && session.challengeId ? CHALLENGES[session.challengeId] : undefined;
  const cleared = session.endReason === "challenge-cleared";
  const bankrupt = session.endReason === "bankrupt";
  return challenge
    ? cleared ? "挑战达成" : bankrupt ? "筹码落尽" : "挑战落定"
    : bankrupt ? "牌桌收起席位" : "这一席已经结账";
}
