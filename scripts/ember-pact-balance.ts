import { chooseAiResponse, chooseBestMove } from "../src/games/ember-pact/domain/ai";
import {
  createInitialState,
  declineResponse,
  endTurn,
  playCard,
  respondToAttack,
} from "../src/games/ember-pact/domain/engine";
import type {
  CombatantMetrics,
  EmberPactState,
  MatchWinner,
  TeamId,
} from "../src/games/ember-pact/domain/types";

const requestedMatches = Number.parseInt(process.argv[2] ?? "500", 10);
const matchCount = Number.isFinite(requestedMatches) ? Math.max(500, requestedMatches) : 500;
const decisionLimit = 1_000;

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 16_807) % 2_147_483_647;
    return value / 2_147_483_647;
  };
}

interface DecisionResult {
  readonly state: EmberPactState;
  readonly actorId?: string;
  readonly cardDefinitionId?: string;
}

function nextBotDecision(state: EmberPactState): DecisionResult {
  if (state.phase === "response") {
    const responderId = state.pendingAttack?.targetId;
    if (!responderId) throw new Error("Response phase has no responder.");
    const responseUid = chooseAiResponse(state, responderId, state.difficulty);
    const responseCard = responseUid
      ? state.combatants.find((combatant) => combatant.id === responderId)
        ?.hand.find((card) => card.uid === responseUid)
      : undefined;
    return {
      state: responseUid
        ? respondToAttack(state, responderId, responseUid)
        : declineResponse(state, responderId),
      actorId: responseCard ? responderId : undefined,
      cardDefinitionId: responseCard?.definitionId,
    };
  }

  const move = chooseBestMove(state, state.activePlayerId);
  const playedCard = move
    ? state.combatants.find((combatant) => combatant.id === state.activePlayerId)
      ?.hand.find((card) => card.uid === move.cardUid)
    : undefined;
  return {
    state: move
      ? playCard(state, state.activePlayerId, move.cardUid, move.targetId)
      : endTurn(state, state.activePlayerId),
    actorId: playedCard ? state.activePlayerId : undefined,
    cardDefinitionId: playedCard?.definitionId,
  };
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

const wins: Record<MatchWinner | "unfinished", number> = {
  dawn: 0,
  dusk: 0,
  draw: 0,
  unfinished: 0,
};
const defeats: Record<string, number> = { player: 0, luna: 0, scar: 0, ember: 0 };
const finishedDown: Record<string, number> = { player: 0, luna: 0, scar: 0, ember: 0 };
const metricFields = ["damageDealt", "healingDone", "blockGranted", "cardsPlayed", "responses", "combos"] as const;
type ReportMetric = typeof metricFields[number];
const emptyTeamMetrics = (): Record<ReportMetric, number> => ({
  damageDealt: 0,
  healingDone: 0,
  blockGranted: 0,
  cardsPlayed: 0,
  responses: 0,
  combos: 0,
});
const teamMetricTotals: Record<TeamId, Record<ReportMetric, number>> = {
  dawn: emptyTeamMetrics(),
  dusk: emptyTeamMetrics(),
};
const cardPlays: Record<string, number> = {};
const cardPlaysByTeam: Record<TeamId, Record<string, number>> = { dawn: {}, dusk: {} };
const rounds: number[] = [];
const decisions: number[] = [];
let overheatMatches = 0;
let overheatEvents = 0;

for (let seed = 1; seed <= matchCount; seed += 1) {
  let state = createInitialState(seededRandom(seed));
  let decisionCount = 0;
  let reachedOverheat = false;

  while (state.status === "playing" && decisionCount < decisionLimit) {
    const previous = state;
    const decision = nextBotDecision(state);
    state = decision.state;
    decisionCount += 1;
    if (state === previous || state.revision === previous.revision) {
      throw new Error(`Seed ${seed} stalled at decision ${decisionCount} (${state.phase}/${state.activePlayerId}).`);
    }

    if (decision.cardDefinitionId && decision.actorId) {
      cardPlays[decision.cardDefinitionId] = (cardPlays[decision.cardDefinitionId] ?? 0) + 1;
      const team = previous.combatants.find((combatant) => combatant.id === decision.actorId)?.team;
      if (team) {
        cardPlaysByTeam[team][decision.cardDefinitionId]
          = (cardPlaysByTeam[team][decision.cardDefinitionId] ?? 0) + 1;
      }
    }

    const events = state.lastAction?.events ?? [];
    const overheat = events.filter((event) => event.kind === "overheat").length;
    if (overheat > 0) reachedOverheat = true;
    overheatEvents += overheat;
    for (const event of events) {
      if (event.kind === "defeated") defeats[event.targetId] = (defeats[event.targetId] ?? 0) + 1;
    }
  }

  const outcome = state.status === "finished" ? state.winner : "unfinished";
  wins[outcome ?? "unfinished"] += 1;
  if (reachedOverheat) overheatMatches += 1;
  rounds.push(state.roundNumber);
  decisions.push(decisionCount);
  for (const combatant of state.combatants) {
    if (combatant.hp <= 0) finishedDown[combatant.id] = (finishedDown[combatant.id] ?? 0) + 1;
    const metric: CombatantMetrics = state.metrics[combatant.id];
    for (const field of metricFields) teamMetricTotals[combatant.team][field] += metric[field];
  }
}

const completed = matchCount - wins.unfinished;
const report = {
  matches: matchCount,
  completed,
  wins,
  winRates: {
    dawn: completed > 0 ? wins.dawn / completed : 0,
    dusk: completed > 0 ? wins.dusk / completed : 0,
    draw: completed > 0 ? wins.draw / completed : 0,
  },
  rounds: {
    average: rounds.reduce((sum, value) => sum + value, 0) / rounds.length,
    median: percentile(rounds, 0.5),
    p95: percentile(rounds, 0.95),
    maximum: Math.max(...rounds),
  },
  decisions: {
    average: decisions.reduce((sum, value) => sum + value, 0) / decisions.length,
    p95: percentile(decisions, 0.95),
    maximum: Math.max(...decisions),
  },
  overheat: {
    matches: overheatMatches,
    matchRate: overheatMatches / matchCount,
    events: overheatEvents,
  },
  defeats,
  finishedDown,
  teamAverages: Object.fromEntries(
    (Object.entries(teamMetricTotals) as [TeamId, Record<ReportMetric, number>][]).map(([team, metrics]) => [
      team,
      Object.fromEntries(metricFields.map((field) => [field, metrics[field] / matchCount])),
    ]),
  ),
  cardPlays: Object.fromEntries(Object.entries(cardPlays).sort((left, right) => right[1] - left[1])),
  cardPlaysByTeam: Object.fromEntries(
    (Object.entries(cardPlaysByTeam) as [TeamId, Record<string, number>][]).map(([team, plays]) => [
      team,
      Object.fromEntries(Object.entries(plays).sort((left, right) => right[1] - left[1])),
    ]),
  ),
  limits: {
    maxUnfinishedRate: 0.01,
  },
};

console.log(JSON.stringify(report, null, 2));

const unfinishedRate = wins.unfinished / matchCount;
if (unfinishedRate > report.limits.maxUnfinishedRate) {
  console.error(
    `Ember Pact baseline exceeded unfinished-match limit: ${unfinishedRate.toFixed(3)} > ${report.limits.maxUnfinishedRate}.`,
  );
  process.exitCode = 1;
}
