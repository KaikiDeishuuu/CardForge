/**
 * Heads-up baseline for the Texas bot.
 *
 * Scoring is duplicate: every deal is played twice, once with the hero in each
 * seat, and the hero's two results are summed. Card luck therefore cancels
 * almost exactly. Without it the noise floor of a 2000-hand session is roughly
 * ±430 bb/100 — wide enough to swamp any change worth making, and wide enough
 * to make a straight session look like evidence when it is not.
 *
 * Usage: npm run test:balance:texas [dealsPerSeed]
 */
import { chooseTexasBotAction } from "../src/games/texas-holdem/domain/ai";
import { texasRankValue } from "../src/games/texas-holdem/domain/cards";
import { applyTexasAction, createTexasState } from "../src/games/texas-holdem/domain/engine";
import { evaluateTexasHand, handCategoryPower } from "../src/games/texas-holdem/domain/evaluator";
import { buildTexasObservation, type TexasObservation } from "../src/games/texas-holdem/domain/observation";
import type { TexasPlayerAction, TexasState } from "../src/games/texas-holdem/domain/types";

const requestedDeals = Number.parseInt(process.argv[2] ?? "700", 10);
const dealsPerSeed = Number.isFinite(requestedDeals) ? Math.max(200, requestedDeals) : 700;
const seedBases = [10_007, 114_733, 219_463, 324_191, 428_921, 533_651];
const actionLimit = 400;

type Policy = (observation: TexasObservation) => TexasPlayerAction;

function seededRandom(seed: number): () => number {
  let value = seed % 2_147_483_647;
  if (value <= 0) value += 2_147_483_646;
  return () => {
    value = (value * 16_807) % 2_147_483_647;
    return value / 2_147_483_647;
  };
}

function mixOf(observation: TexasObservation): number {
  let hash = 5381;
  for (const character of `${observation.actorId}:${observation.handNumber}:${observation.revision}`) {
    hash = ((hash << 5) + hash + character.charCodeAt(0)) | 0;
  }
  return ((hash >>> 0) % 1000) / 1000;
}

function madePower(observation: TexasObservation): number {
  const cards = [...observation.hole, ...observation.board];
  return cards.length >= 5 ? handCategoryPower(evaluateTexasHand(cards).category) : 0;
}

/** Never folds. The floor: any competent bot must beat this badly. */
const callingStation: Policy = (observation) => {
  if (observation.legal.check) return { type: "check" };
  if (observation.legal.callAmount > 0) return { type: "call" };
  return { type: "check" };
};

/** Continues only with a pair or better. Punishes a bot that never bluffs. */
const rock: Policy = (observation) => {
  if (observation.legal.check) return { type: "check" };
  const strongEnough = observation.board.length >= 3
    ? madePower(observation) >= 1
    : observation.hole[0]?.rank === observation.hole[1]?.rank
      || texasRankValue(observation.hole[0]?.rank ?? "2") >= 12;
  if (strongEnough && observation.legal.callAmount > 0) return { type: "call" };
  return { type: "fold" };
};

/**
 * Bets often and calls wide. The passive references never put in a raise, so
 * this is the only one that exercises the bot's calling and draw pricing at
 * all — without it the report grades half the policy.
 */
const maniac: Policy = (observation) => {
  const presets = observation.legal.raisePresets;
  const roll = mixOf(observation);
  if (observation.legal.check) {
    return presets.length > 0 && roll < 0.62 ? { type: "raise", to: presets[0] } : { type: "check" };
  }
  if (observation.legal.callAmount > 0) {
    if (presets.length > 0 && madePower(observation) >= 2 && roll < 0.4) return { type: "raise", to: presets[0] };
    return roll < 0.72 || madePower(observation) >= 1 ? { type: "call" } : { type: "fold" };
  }
  return { type: "check" };
};

/**
 * A frozen snapshot of the bot before draw equity, position and mixed sizing
 * landed. It is a fixed reference point: do not "improve" it, or the delta it
 * anchors stops meaning anything.
 */
const legacyBot: Policy = (observation) => {
  const CATEGORY_STRENGTH: Record<string, number> = {
    "high-card": 0.18, pair: 0.4, "two-pair": 0.58, "three-kind": 0.7, straight: 0.78,
    flush: 0.82, "full-house": 0.9, "four-kind": 0.97, "straight-flush": 1,
  };
  const legal = observation.legal;
  const cards = [...observation.hole, ...observation.board];
  let strength: number;
  if (observation.street === "preflop" || cards.length < 5) {
    const [first, second] = observation.hole;
    const high = Math.max(texasRankValue(first.rank), texasRankValue(second.rank));
    const low = Math.min(texasRankValue(first.rank), texasRankValue(second.rank));
    const gap = high - low;
    strength = (high + low) / 40;
    if (first.rank === second.rank) strength += 0.28 + high / 50;
    if (first.suit === second.suit) strength += 0.06;
    if (gap <= 1) strength += 0.07;
    else if (gap >= 4) strength -= 0.07;
    if (high === 14) strength += 0.06;
    strength = Math.max(0.05, Math.min(0.96, strength));
  } else {
    const hand = evaluateTexasHand(cards);
    strength = Math.min(1, CATEGORY_STRENGTH[hand.category] + (hand.tiebreak[0] ?? 2) / 100);
  }

  let hash = 2166136261;
  for (const character of `${observation.actorId}:${observation.handNumber}:${observation.revision}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const mix = (hash >>> 0) / 0xffffffff;

  const presets = legal.raisePresets;
  const raiseTo = presets.length === 0
    ? undefined
    : strength > 0.86 ? presets.at(-1)
      : strength > 0.66 ? presets[Math.min(1, presets.length - 1)] : presets[0];

  if (legal.check) {
    if (raiseTo !== undefined && (strength > 0.72 || (strength > 0.54 && mix > 0.72))) {
      return { type: "raise", to: raiseTo };
    }
    return { type: "check" };
  }
  if (legal.callAmount > 0) {
    const price = legal.callAmount / Math.max(1, observation.pot + legal.callAmount);
    if (raiseTo !== undefined && strength > 0.78 && mix > 0.18) return { type: "raise", to: raiseTo };
    if (strength + mix * 0.12 >= price + 0.16) return { type: "call" };
    return { type: "fold" };
  }
  return { type: "fold" };
};

/** One deal from a fresh table, hero in the named seat. Returns hero's chip delta. */
function playDeal(
  hero: Policy,
  villain: Policy,
  heroSeat: "east" | "human",
  seed: number,
): number | undefined {
  let state: TexasState = createTexasState(seededRandom(seed));
  const seatOf = (current: TexasState) => current.players.find((player) => player.id === heroSeat)!;
  const opening = seatOf(state);
  const start = opening.stack + opening.totalCommitted;

  let actions = 0;
  while (state.status === "playing" && actions < actionLimit) {
    const actorId = state.activePlayerId;
    if (!actorId) break;
    const observation = buildTexasObservation(state, actorId);
    const action = actorId === heroSeat ? hero(observation) : villain(observation);
    const next = applyTexasAction(state, actorId, action);
    if (next === state) break;
    state = next;
    actions += 1;
  }

  if (state.status !== "settled") return undefined;
  return seatOf(state).stack - start;
}

interface Rate {
  readonly bbPer100: number;
  readonly confidence95: number;
  readonly deals: number;
  readonly unsettled: number;
}

function measure(hero: Policy, villain: Policy): Rate {
  let unsettled = 0;
  const perSeed = seedBases.map((base) => {
    let delta = 0;
    let counted = 0;
    for (let index = 0; index < dealsPerSeed; index += 1) {
      const seed = base + index * 7919;
      const asEast = playDeal(hero, villain, "east", seed);
      const asHuman = playDeal(hero, villain, "human", seed);
      if (asEast === undefined || asHuman === undefined) {
        unsettled += 1;
        continue;
      }
      delta += asEast + asHuman;
      counted += 2;
    }
    return counted === 0 ? 0 : (delta / 10 / counted) * 100;
  });

  const mean = perSeed.reduce((sum, rate) => sum + rate, 0) / perSeed.length;
  const variance = perSeed.reduce((sum, rate) => sum + (rate - mean) ** 2, 0) / (perSeed.length - 1);
  return {
    bbPer100: round(mean),
    confidence95: round(1.96 * Math.sqrt(variance / perSeed.length)),
    deals: dealsPerSeed * seedBases.length * 2,
    unsettled,
  };
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const vsStation = measure(chooseTexasBotAction, callingStation);
const vsRock = measure(chooseTexasBotAction, rock);
const vsManiac = measure(chooseTexasBotAction, maniac);
const vsLegacy = measure(chooseTexasBotAction, legacyBot);

const limits = {
  minBbPer100VsStation: 300,
  minBbPer100VsRock: 100,
  minBbPer100VsManiac: 140,
  /** The gate that matters: a change must not lose ground to the frozen bot. */
  minBbPer100VsLegacy: -10,
  maxUnsettled: 0,
};

const report = {
  dealsPerSeed,
  seeds: seedBases.length,
  scoring: "duplicate (each deal played from both seats)",
  current: { vsCallingStation: vsStation, vsRock, vsManiac, vsLegacy },
  limits,
};

console.log(JSON.stringify(report, null, 2));

const failures: string[] = [];
if (vsStation.bbPer100 < limits.minBbPer100VsStation) {
  failures.push(`only ${vsStation.bbPer100} bb/100 against a calling station`);
}
if (vsRock.bbPer100 < limits.minBbPer100VsRock) {
  failures.push(`only ${vsRock.bbPer100} bb/100 against a rock`);
}
if (vsManiac.bbPer100 < limits.minBbPer100VsManiac) {
  failures.push(`only ${vsManiac.bbPer100} bb/100 against an aggressor`);
}
if (vsLegacy.bbPer100 < limits.minBbPer100VsLegacy) {
  failures.push(`lost ground to the frozen reference bot: ${vsLegacy.bbPer100} bb/100`);
}
const unsettled = vsStation.unsettled + vsRock.unsettled + vsManiac.unsettled + vsLegacy.unsettled;
if (unsettled > limits.maxUnsettled) {
  failures.push(`${unsettled} deals failed to settle within ${actionLimit} actions`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`Texas baseline failed: ${failure}`);
  process.exitCode = 1;
}
