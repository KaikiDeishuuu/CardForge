import { texasRankValue } from "./cards";
import { countStraightOrBetterOuts, evaluateTexasHand } from "./evaluator";
import type { TexasObservation } from "./observation";
import type { TexasPlayerAction } from "./types";

const CATEGORY_STRENGTH = {
  "high-card": 0.18,
  pair: 0.4,
  "two-pair": 0.58,
  "three-kind": 0.7,
  straight: 0.78,
  flush: 0.82,
  "full-house": 0.9,
  "four-kind": 0.97,
  "straight-flush": 1,
} as const;

/**
 * Each out is worth about 2% per card still to come. The "rule of four" that
 * doubles this on the flop only holds when the call is already all-in; with
 * another betting round to come it double-counts, and a balance run showed the
 * bot paying too much for draws as a result.
 */
const EQUITY_PER_OUT = 0.02;
/** A nut flush draw is about 36% — treat that as the ceiling for a pure draw. */
const MAX_DRAW_EQUITY = 0.36;
/** Acting last is worth roughly this much in threshold terms heads-up. */
const POSITION_EDGE = 0.04;
/**
 * How much the mix perturbs raise sizing. Small on purpose: it takes only a
 * nudge to stop the size being a readable one-to-one map of strength, and at
 * 0.28 the bot bet big with weak holdings often enough to cost ~22 bb/100.
 */
const SIZING_MIX_WEIGHT = 0.08;

function preflopStrength(observation: TexasObservation): number {
  const [first, second] = observation.hole;
  if (!first || !second) return 0;
  const high = Math.max(texasRankValue(first.rank), texasRankValue(second.rank));
  const low = Math.min(texasRankValue(first.rank), texasRankValue(second.rank));
  const pair = first.rank === second.rank;
  const suited = first.suit === second.suit;
  const gap = high - low;
  let strength = (high + low) / 40;
  if (pair) strength += 0.28 + high / 50;
  if (suited) strength += 0.06;
  if (gap <= 1) strength += 0.07;
  else if (gap >= 4) strength -= 0.07;
  if (high === 14) strength += 0.06;
  return Math.max(0.05, Math.min(0.96, strength));
}

/** Equity carried by a live draw, zero once the last card is out. */
function drawEquity(observation: TexasObservation): number {
  if (observation.street !== "flop" && observation.street !== "turn") return 0;
  const outs = countStraightOrBetterOuts([...observation.hole, ...observation.board]);
  return Math.min(MAX_DRAW_EQUITY, outs * EQUITY_PER_OUT);
}

function postflopStrength(observation: TexasObservation): number {
  const cards = [...observation.hole, ...observation.board];
  if (cards.length < 5) return preflopStrength(observation);
  const hand = evaluateTexasHand(cards);
  const kicker = (hand.tiebreak[0] ?? 2) / 100;
  const made = Math.min(1, CATEGORY_STRENGTH[hand.category] + kicker);
  // Either the made hand is already good, or the draw gets there: the two are
  // combined as alternatives rather than summed, so a draw can never push a
  // holding past what actually making the hand would be worth.
  return Math.min(0.96, made + drawEquity(observation) * (1 - made));
}

function deterministicMix(observation: TexasObservation): number {
  const source = `${observation.actorId}:${observation.handNumber}:${observation.revision}`;
  let hash = 2166136261;
  for (const character of source) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

/**
 * Heads-up the button posts the small blind, so it acts first before the flop
 * and last on every street after it.
 */
function actsLast(observation: TexasObservation): boolean {
  const seatIndex = observation.players.findIndex((player) => player.id === observation.actorId);
  const onButton = seatIndex === observation.dealerIndex;
  return observation.street === "preflop" ? !onButton : onButton;
}

/**
 * Picks a raise size. The mix is blended in on purpose: sizing driven by
 * strength alone is a tell, because the biggest preset would only ever appear
 * with the strongest holdings.
 */
function preferredRaise(
  observation: TexasObservation,
  strength: number,
  mix: number,
): number | undefined {
  const presets = observation.legal.raisePresets;
  if (presets.length === 0) return undefined;
  const sizing = strength * (1 - SIZING_MIX_WEIGHT) + mix * SIZING_MIX_WEIGHT;
  if (sizing > 0.8) return presets.at(-1);
  if (sizing > 0.6) return presets[Math.min(1, presets.length - 1)];
  return presets[0];
}

export function chooseTexasBotAction(observation: TexasObservation): TexasPlayerAction {
  const legal = observation.legal;
  const strength = observation.street === "preflop"
    ? preflopStrength(observation)
    : postflopStrength(observation);
  const mix = deterministicMix(observation);
  const edge = actsLast(observation) ? POSITION_EDGE : 0;
  const raiseTo = preferredRaise(observation, strength, mix);

  if (legal.check) {
    if (raiseTo !== undefined && (strength > 0.72 - edge || (strength > 0.54 - edge && mix > 0.72))) {
      return { type: "raise", to: raiseTo };
    }
    return { type: "check" };
  }

  if (legal.callAmount > 0) {
    const price = legal.callAmount / Math.max(1, observation.pot + legal.callAmount);
    if (raiseTo !== undefined && strength > 0.78 - edge && mix > 0.18) return { type: "raise", to: raiseTo };
    if (strength + mix * 0.12 >= price + 0.16 - edge) return { type: "call" };
    return { type: "fold" };
  }

  return { type: "fold" };
}
