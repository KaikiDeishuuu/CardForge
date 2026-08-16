import { texasRankValue } from "./cards";
import { evaluateTexasHand } from "./evaluator";
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

function postflopStrength(observation: TexasObservation): number {
  const cards = [...observation.hole, ...observation.board];
  if (cards.length < 5) return preflopStrength(observation);
  const hand = evaluateTexasHand(cards);
  const kicker = (hand.tiebreak[0] ?? 2) / 100;
  return Math.min(1, CATEGORY_STRENGTH[hand.category] + kicker);
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

function preferredRaise(observation: TexasObservation, strength: number): number | undefined {
  const presets = observation.legal.raisePresets;
  if (presets.length === 0) return undefined;
  if (strength > 0.86) return presets.at(-1);
  if (strength > 0.66) return presets[Math.min(1, presets.length - 1)];
  return presets[0];
}

export function chooseTexasBotAction(observation: TexasObservation): TexasPlayerAction {
  const legal = observation.legal;
  const strength = observation.street === "preflop"
    ? preflopStrength(observation)
    : postflopStrength(observation);
  const mix = deterministicMix(observation);
  const raiseTo = preferredRaise(observation, strength);

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
}
