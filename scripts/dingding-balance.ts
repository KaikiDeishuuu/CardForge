import {
  activateSkill,
  advancePhase,
  createInitialState,
  discardCards,
  endTurn,
  getTargetOptions,
  playCard,
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
} from "../src/games/dingding/domain/engine";
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
} from "../src/games/dingding/domain/ai";
import { HERO_CATALOG } from "../src/games/dingding/domain/heroes";
import type { DingDifficulty, MatchWinner } from "../src/games/dingding/domain/types";

const requestedMatches = Number.parseInt(process.argv[2] ?? "200", 10);
const matchCount = Number.isFinite(requestedMatches) && requestedMatches > 0 ? requestedMatches : 200;
const requestedLimit = Number.parseInt(process.argv[3] ?? "3000", 10);
const decisionLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 3000;
const requestedDifficulty = process.argv[4] ?? "standard";
const difficulty: DingDifficulty = requestedDifficulty === "relaxed"
  || requestedDifficulty === "standard"
  || requestedDifficulty === "tactician"
  ? requestedDifficulty
  : "standard";

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 4_294_967_296;
  };
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

const wins: Record<MatchWinner | "unfinished", number> = {
  "lord-side": 0,
  rebel: 0,
  renegade: 0,
  unfinished: 0,
};
const turns: number[] = [];
const decisions: number[] = [];
const cardPlays: Record<string, number> = {};
const skillActivations: Record<string, number> = {};
const delayedJudgments: Record<string, number> = {};
const heroGames: Record<string, number> = {};
const heroWins: Record<string, number> = {};
const identityHeroGames: Record<string, Record<string, number>> = {
  lord: {}, loyalist: {}, rebel: {}, renegade: {},
};
const identityHeroWins: Record<string, Record<string, number>> = {
  lord: {}, loyalist: {}, rebel: {}, renegade: {},
};
const identityDeaths: Record<string, number> = { lord: 0, loyalist: 0, rebel: 0, renegade: 0 };

for (let seed = 1; seed <= matchCount; seed += 1) {
  let state = createInitialState(seededRandom(seed), difficulty);
  for (const player of state.players) {
    heroGames[player.heroId] = (heroGames[player.heroId] ?? 0) + 1;
    identityHeroGames[player.identity][player.heroId]
      = (identityHeroGames[player.identity][player.heroId] ?? 0) + 1;
  }

  let decisionCount = 0;
  while (state.status === "playing" && decisionCount < decisionLimit) {
    const before = state;
    const top = state.stack.at(-1);
    const actorId = state.activePlayerId;

    if (top?.kind === "strike") {
      state = respondToStrike(state, top.targetId, chooseAiStrikeResponse(state, top.targetId));
    } else if (top?.kind === "dying") {
      const responder = top.responders[top.cursor];
      state = respondToDying(state, responder, chooseAiDyingResponse(state, responder));
    } else if (top?.kind === "skill") {
      state = respondToSkill(state, top.ownerId, chooseAiSkillDecision(state, top.ownerId));
    } else if (top?.kind === "protect") {
      state = respondToProtect(state, top.protectorId, chooseAiProtectResponse(state, top.protectorId));
    } else if (top?.kind === "probe") {
      state = respondToProbe(state, top.actorId, chooseAiProbeGuess(state, top.actorId));
    } else if (top?.kind === "delayed") {
      const card = state.delayedTricks[top.ownerId]?.find((entry) => entry.card.id === top.cardUid)?.card;
      if (card) delayedJudgments[card.type] = (delayedJudgments[card.type] ?? 0) + 1;
      state = respondToDelayed(state, top.ownerId);
    } else if (top?.kind === "trick") {
      const responder = top.responders[top.cursor];
      state = respondToTrick(state, responder, chooseAiNullifyResponse(state, responder));
    } else if (top?.kind === "duel") {
      state = respondToDuel(state, top.turnId, chooseAiDuelResponse(state, top.turnId));
    } else if (top?.kind === "horde") {
      const responder = top.responders[top.cursor];
      state = respondToHorde(state, responder, chooseAiHordeResponse(state, responder));
    } else if (top?.kind === "volley") {
      const responder = top.responders[top.cursor];
      state = respondToVolley(state, responder, chooseAiVolleyResponse(state, responder));
    } else if (state.phase === "discard") {
      const toDiscard = chooseAiDiscards(state, actorId);
      state = toDiscard.length > 0 ? discardCards(state, actorId, toDiscard) : advancePhase(state);
    } else if (state.phase === "play") {
      const move = chooseAiMove(state, actorId);
      if (move.kind === "skill") {
        skillActivations[move.skillId] = (skillActivations[move.skillId] ?? 0) + 1;
        state = activateSkill(state, actorId, move.skillId);
      } else if (move.kind === "play") {
        const card = state.players.find((player) => player.id === actorId)?.hand
          .find((entry) => entry.id === move.cardUid);
        if (!card) throw new Error(`Seed ${seed}: AI selected a missing card ${move.cardUid}.`);
        const targets = getTargetOptions(state, actorId, card);
        const targetId = move.targetId && targets.includes(move.targetId) ? move.targetId : targets[0];
        if (!targetId) {
          state = endTurn(state, actorId);
        } else {
          cardPlays[card.type] = (cardPlays[card.type] ?? 0) + 1;
          const next = playCard(state, actorId, move.cardUid, targetId);
          if (next === state) throw new Error(`Seed ${seed}: AI returned an illegal move ${move.cardUid}.`);
          state = next;
        }
      } else {
        state = endTurn(state, actorId);
      }
    } else {
      state = advancePhase(state);
    }

    decisionCount += 1;
    if (state === before || state.revision === before.revision) {
      throw new Error(`Seed ${seed}: stalled at decision ${decisionCount} (${state.phase}/${state.activePlayerId}).`);
    }
  }

  const outcome = state.status === "finished" ? state.winner : "unfinished";
  wins[outcome ?? "unfinished"] += 1;
  turns.push(state.turnNumber);
  decisions.push(decisionCount);

  for (const player of state.players) {
    if (!player.alive) identityDeaths[player.identity] = (identityDeaths[player.identity] ?? 0) + 1;
  }

  if (state.winner) {
    for (const player of state.players) {
      const won = state.winner === "lord-side"
        ? player.identity === "lord" || player.identity === "loyalist"
        : state.winner === "rebel"
          ? player.identity === "rebel"
          : player.identity === "renegade";
      if (won) {
        heroWins[player.heroId] = (heroWins[player.heroId] ?? 0) + 1;
        identityHeroWins[player.identity][player.heroId]
          = (identityHeroWins[player.identity][player.heroId] ?? 0) + 1;
      }
    }
  }
}

const completed = matchCount - wins.unfinished;
const heroStats = Object.fromEntries(
  Object.keys(HERO_CATALOG).map((heroId) => [
    heroId,
    {
      name: HERO_CATALOG[heroId as keyof typeof HERO_CATALOG].name,
      games: heroGames[heroId] ?? 0,
      wins: heroWins[heroId] ?? 0,
      winRate: (heroGames[heroId] ?? 0) > 0 ? (heroWins[heroId] ?? 0) / (heroGames[heroId] ?? 1) : 0,
    },
  ]),
);

const identityHeroStats = Object.fromEntries(
  (Object.keys(identityHeroGames) as Array<keyof typeof identityHeroGames>).map((identity) => [
    identity,
    Object.fromEntries(
      Object.keys(identityHeroGames[identity]).map((heroId) => {
        const games = identityHeroGames[identity][heroId] ?? 0;
        const wins = identityHeroWins[identity][heroId] ?? 0;
        return [heroId, {
          name: HERO_CATALOG[heroId as keyof typeof HERO_CATALOG].name,
          games,
          wins,
          winRate: games > 0 ? wins / games : 0,
        }];
      }),
    ),
  ]),
);

const report = {
  matches: matchCount,
  difficulty,
  completed,
  wins,
  winRates: {
    "lord-side": completed > 0 ? wins["lord-side"] / completed : 0,
    rebel: completed > 0 ? wins.rebel / completed : 0,
    renegade: completed > 0 ? wins.renegade / completed : 0,
  },
  turns: {
    average: turns.reduce((sum, value) => sum + value, 0) / turns.length,
    median: percentile(turns, 0.5),
    p95: percentile(turns, 0.95),
    maximum: Math.max(...turns),
  },
  decisions: {
    average: decisions.reduce((sum, value) => sum + value, 0) / decisions.length,
    median: percentile(decisions, 0.5),
    p95: percentile(decisions, 0.95),
    maximum: Math.max(...decisions),
  },
  identityDeaths,
  cardPlays: Object.fromEntries(Object.entries(cardPlays).sort((left, right) => right[1] - left[1])),
  skillActivations: Object.fromEntries(Object.entries(skillActivations).sort((left, right) => right[1] - left[1])),
  delayedJudgments,
  heroStats,
  identityHeroStats,
};

console.log(JSON.stringify(report, null, 2));
