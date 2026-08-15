import { describe, expect, it } from "vitest";
import { chooseAiMove, chooseAiResponse, chooseBestMove } from "./ai";
import { CARD_CATALOG } from "./data";
import {
  ACTIONS_PER_TURN,
  BLOCK_LIMIT,
  DEFAULT_HUMAN_ID,
  HAND_LIMIT,
  INITIATIVE_ORDER,
  OVERHEAT_START_ROUND,
  createInitialState,
  declineResponse,
  endTurn,
  getCombatant,
  getResponseCards,
  getValidTargetIds,
  playCard,
  respondToAttack,
  selectableCombatantIds,
} from "./engine";
import type { CardInstance, Combatant, EmberPactState } from "./types";

const fixedRandom = () => 0.42;

function updateCombatant(
  state: EmberPactState,
  combatantId: string,
  update: Partial<Combatant>,
): EmberPactState {
  return {
    ...state,
    combatants: state.combatants.map((combatant) =>
      combatant.id === combatantId ? { ...combatant, ...update } : combatant),
  };
}

function testCard(ownerId: string, definitionId: string, index = 0): CardInstance {
  return { uid: `test-${ownerId}-${definitionId}-${index}`, definitionId };
}

function setHand(
  state: EmberPactState,
  combatantId: string,
  definitionIds: readonly string[],
): EmberPactState {
  return updateCombatant(state, combatantId, {
    hand: definitionIds.map((definitionId, index) => testCard(combatantId, definitionId, index)),
  });
}

function startTurn(
  state: EmberPactState,
  actorId: string,
  definitionIds: readonly string[],
): EmberPactState {
  return setHand({
    ...state,
    activePlayerId: actorId,
    actionsRemaining: ACTIONS_PER_TURN,
    attackUsed: false,
    phase: "action",
    pendingAttack: undefined,
  }, actorId, definitionIds);
}

function playNamedCard(
  state: EmberPactState,
  actorId: string,
  definitionId: string,
  targetId: string,
): EmberPactState {
  const instance = getCombatant(state, actorId)?.hand.find((card) => card.definitionId === definitionId);
  if (!instance) throw new Error(`${actorId} does not hold ${definitionId}`);
  return playCard(state, actorId, instance.uid, targetId);
}

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 16_807) % 2_147_483_647;
    return value / 2_147_483_647;
  };
}

function directDamage(definitionId: string): number {
  return CARD_CATALOG[definitionId].effects.find((effect) => effect.kind === "damage")?.amount ?? 0;
}

function driveBotDecision(state: EmberPactState): EmberPactState {
  if (state.phase === "response") {
    const responderId = state.pendingAttack?.targetId;
    if (!responderId) throw new Error("response phase requires a responder");
    const responseUid = chooseAiResponse(state, responderId, state.difficulty);
    return responseUid
      ? respondToAttack(state, responderId, responseUid)
      : declineResponse(state, responderId);
  }

  const move = chooseBestMove(state, state.activePlayerId);
  return move
    ? playCard(state, state.activePlayerId, move.cardUid, move.targetId)
    : endTurn(state, state.activePlayerId);
}

describe("Ember Pact engine", () => {
  it("starts the standard four-seat battle with two actions", () => {
    const state = createInitialState(fixedRandom);

    expect(state.combatants).toHaveLength(4);
    expect(state.combatants.every((combatant) => combatant.hand.length === 4)).toBe(true);
    expect(state.combatants.every((combatant) => combatant.maxHp > 0 && combatant.hp === combatant.maxHp)).toBe(true);
    expect(state.combatants.map((combatant) => combatant.team)).toEqual(["dawn", "dawn", "dusk", "dusk"]);
    expect(state.activePlayerId).toBe(INITIATIVE_ORDER[0]);
    expect(state.actionsRemaining).toBe(2);
    expect(state.attackUsed).toBe(false);
    expect(state.phase).toBe("action");
    expect(Object.keys(state.metrics).sort()).toEqual(["ember", "luna", "player", "scar"]);
  });

  it("lets the human control any seat without changing the initiative order", () => {
    const asScar = createInitialState(fixedRandom, "scar");
    expect(getCombatant(asScar, "scar")?.controller).toBe("human");
    expect(getCombatant(asScar, "player")?.controller).toBe("ai");
    expect(asScar.combatants.filter((combatant) => combatant.controller === "human")).toHaveLength(1);
    expect(asScar.activePlayerId).toBe("player");

    const fallback = createInitialState(fixedRandom, "unknown");
    expect(getCombatant(fallback, DEFAULT_HUMAN_ID)?.controller).toBe("human");
    expect(selectableCombatantIds()).toEqual(["player", "luna", "scar", "ember"]);
  });

  it("allows two cards but limits attack cards to one per turn", () => {
    let state = startTurn(createInitialState(fixedRandom), "player", ["sever", "sever", "fracture"]);
    state = setHand(state, "scar", []);
    const startingHp = getCombatant(state, "scar")!.hp;

    const firstAttack = getCombatant(state, "player")!.hand[0];
    state = playCard(state, "player", firstAttack.uid, "scar");
    expect(state.activePlayerId).toBe("player");
    expect(state.actionsRemaining).toBe(1);
    expect(state.attackUsed).toBe(true);

    const secondAttack = getCombatant(state, "player")!.hand.find((card) => card.definitionId === "sever")!;
    expect(getValidTargetIds(state, "player", secondAttack.uid)).toEqual([]);
    expect(playCard(state, "player", secondAttack.uid, "scar")).toBe(state);

    state = playNamedCard(state, "player", "fracture", "scar");
    expect(getCombatant(state, "scar")?.hp)
      .toBe(startingHp - directDamage("sever") - directDamage("fracture"));
    expect(state.activePlayerId).toBe("scar");
    expect(state.actionsRemaining).toBe(ACTIONS_PER_TURN);
    expect(state.attackUsed).toBe(false);
  });

  it("automatically rotates after the second one-cost action", () => {
    let state = startTurn(createInitialState(fixedRandom), "player", ["plate", "fracture"]);
    state = playNamedCard(state, "player", "plate", "player");
    expect(state.activePlayerId).toBe("player");
    expect(state.actionsRemaining).toBe(1);

    state = playNamedCard(state, "player", "fracture", "scar");
    expect(state.activePlayerId).toBe("scar");
    expect(state.turnNumber).toBe(2);
    expect(state.actionsRemaining).toBe(2);
  });

  it("rotates in an interleaved team order and increments rounds only on wrap", () => {
    let state = createInitialState(fixedRandom);
    const observed = [state.activePlayerId];

    for (let count = 0; count < 4; count += 1) {
      state = endTurn(state, state.activePlayerId);
      observed.push(state.activePlayerId);
    }

    expect(observed).toEqual(["player", "scar", "luna", "ember", "player"]);
    expect(state.roundNumber).toBe(2);

    const withoutScar = updateCombatant(createInitialState(fixedRandom), "scar", { hp: 0 });
    expect(endTurn(withoutScar, "player").activePlayerId).toBe("luna");
  });

  it("allows the actor to end early and settles end-of-turn effects once", () => {
    let state = startTurn(createInitialState(fixedRandom), "player", ["plate", "fracture"]);
    state = updateCombatant(state, "player", {
      statuses: [{ id: "burning", remainingTurns: 2, sourceActorId: "ember" }],
    });
    state = playNamedCard(state, "player", "plate", "player");
    const beforeEnd = getCombatant(state, "player")!.hp;

    state = endTurn(state, "player");
    const burnEvent = state.lastAction?.events.find((event) => event.kind === "damage" && event.source === "status");
    expect(burnEvent?.amount).toBeGreaterThan(0);
    expect(getCombatant(state, "player")?.hp).toBe(beforeEnd - (burnEvent?.amount ?? 0));
    expect(getCombatant(state, "player")?.statuses.find((status) => status.id === "burning")?.remainingTurns).toBe(1);
    expect(state.activePlayerId).toBe("scar");
    expect(state.lastAction?.events.filter((event) => event.kind === "damage")).toHaveLength(1);
  });

  it("attributes a burning defeat to its status source", () => {
    let state = startTurn(createInitialState(fixedRandom), "player", []);
    state = updateCombatant(state, "player", {
      hp: 2,
      statuses: [{ id: "burning", remainingTurns: 1, sourceActorId: "ember" }],
    });

    state = endTurn(state, "player");

    expect(getCombatant(state, "player")?.hp).toBe(0);
    expect(state.lastAction?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "defeated",
        targetId: "player",
        actorId: "ember",
        source: "status",
      }),
    ]));
  });

  it("keeps shields between turns and caps them at the configured limit", () => {
    let state = startTurn(createInitialState(fixedRandom), "player", ["plate", "plate"]);
    state = playNamedCard(state, "player", "plate", "player");
    state = playNamedCard(state, "player", "plate", "player");

    expect(getCombatant(state, "player")?.block).toBe(BLOCK_LIMIT);
    expect(state.activePlayerId).toBe("scar");

    state = endTurn(state, "scar");
    state = endTurn(state, "luna");
    state = endTurn(state, "ember");
    expect(state.activePlayerId).toBe("player");
    expect(getCombatant(state, "player")?.block).toBe(BLOCK_LIMIT);
  });

  it("pauses for Deflect, then returns the decision to the original actor", () => {
    let state = startTurn(createInitialState(fixedRandom), "player", ["sever", "fracture"]);
    state = setHand(state, "scar", ["deflect"]);
    const startingHp = getCombatant(state, "scar")!.hp;

    state = playNamedCard(state, "player", "sever", "scar");
    expect(state.phase).toBe("response");
    expect(state.activePlayerId).toBe("player");
    expect(state.pendingAttack).toMatchObject({ actorId: "player", targetId: "scar", definitionId: "sever" });
    expect(getCombatant(state, "scar")?.hp).toBe(startingHp);

    const response = getResponseCards(state, "scar")[0];
    state = respondToAttack(state, "scar", response.uid);
    expect(state.phase).toBe("action");
    expect(state.pendingAttack).toBeUndefined();
    expect(state.activePlayerId).toBe("player");
    expect(state.actionsRemaining).toBe(1);
    const prevented = Math.min(CARD_CATALOG.deflect.responsePower ?? 0, directDamage("sever"));
    expect(getCombatant(state, "scar")?.hp).toBe(startingHp - directDamage("sever") + prevented);
    expect(state.lastAction?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "response", targetId: "scar" }),
      expect.objectContaining({
        kind: "damage",
        targetId: "scar",
        amount: directDamage("sever") - prevented,
        prevented,
      }),
    ]));
    expect(state.metrics.scar.responses).toBe(1);
    expect(state.log.filter((entry) => entry.text.includes("准备化解 4 点伤害"))).toHaveLength(1);
  });

  it("can decline a response without losing the response card", () => {
    let state = startTurn(createInitialState(fixedRandom), "player", ["sever", "fracture"]);
    state = setHand(state, "scar", ["deflect"]);
    const startingHp = getCombatant(state, "scar")!.hp;
    state = playNamedCard(state, "player", "sever", "scar");

    const beforeHand = getCombatant(state, "scar")!.hand;
    state = declineResponse(state, "scar");
    expect(state.phase).toBe("action");
    expect(state.activePlayerId).toBe("player");
    expect(state.actionsRemaining).toBe(1);
    expect(getCombatant(state, "scar")?.hp).toBe(startingHp - directDamage("sever"));
    expect(getCombatant(state, "scar")?.hand).toEqual(beforeHand);
    expect(state.metrics.scar.responses).toBe(0);
  });

  it("lets a restore card return a defeated ally to the initiative", () => {
    let state = startTurn(createInitialState(fixedRandom), "luna", ["rekindle", "fracture"]);
    state = updateCombatant(state, "player", {
      hp: 0,
      block: 7,
      statuses: [
        { id: "burning", remainingTurns: 2, sourceActorId: "ember" },
        { id: "tempered", sourceActorId: "luna" },
      ],
    });

    const rescue = getCombatant(state, "luna")!.hand[0];
    expect(getValidTargetIds(state, "luna", rescue.uid)).toContain("player");
    state = playCard(state, "luna", rescue.uid, "player");

    expect(getCombatant(state, "player")?.hp).toBe(3);
    expect(getCombatant(state, "player")?.block).toBeGreaterThan(0);
    expect(getCombatant(state, "player")?.statuses).toEqual([
      { id: "tempered", sourceActorId: "luna" },
    ]);
    expect(state.lastAction?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "revive", targetId: "player", amount: 3, combo: true }),
    ]));
    expect(state.metrics.luna.healingDone).toBe(3);

    state = startTurn(updateCombatant(state, "player", { hp: 0 }), "luna", ["rekindle"]);
    const secondRescue = getCombatant(state, "luna")!.hand[0];
    expect(getCombatant(state, "player")?.reviveAvailable).toBe(false);
    expect(getValidTargetIds(state, "luna", secondRescue.uid)).not.toContain("player");
    expect(playCard(state, "luna", secondRescue.uid, "player")).toBe(state);
  });

  it("records cross-seat coordination in both events and metrics", () => {
    let state = startTurn(createInitialState(fixedRandom), "player", ["rally", "fracture"]);
    state = playNamedCard(state, "player", "rally", "luna");

    expect(state.lastAction?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "block", targetId: "luna", combo: true }),
      expect.objectContaining({ kind: "status-applied", targetId: "luna", combo: true }),
    ]));
    expect(state.metrics.player).toMatchObject({ cardsPlayed: 1, blockGranted: 2, combos: 1 });
  });

  it("does not emit the same tempered application twice", () => {
    let state = startTurn(createInitialState(fixedRandom), "player", ["temper"]);

    state = playNamedCard(state, "player", "temper", "player");

    expect(state.lastAction?.events.filter((event) =>
      event.kind === "status-applied" && event.statusId === "tempered"
    )).toHaveLength(1);
  });

  it("applies global true-damage overheat to every living seat on round wrap", () => {
    let state = startTurn(createInitialState(fixedRandom), "ember", []);
    state = {
      ...state,
      roundNumber: OVERHEAT_START_ROUND - 1,
      combatants: state.combatants.map((combatant) => ({ ...combatant, hp: 5, block: BLOCK_LIMIT })),
    };

    state = endTurn(state, "ember");
    expect(state.roundNumber).toBe(OVERHEAT_START_ROUND);
    expect(state.combatants.map((combatant) => combatant.hp)).toEqual([4, 4, 4, 4]);
    expect(state.combatants.every((combatant) => combatant.block === BLOCK_LIMIT)).toBe(true);
    expect(state.lastAction?.events.filter((event) => event.kind === "overheat")).toHaveLength(4);
  });

  it("has the AI spend Deflect against lethal incoming damage", () => {
    let state = startTurn(createInitialState(fixedRandom), "player", ["sever"]);
    state = setHand(state, "scar", ["deflect"]);
    state = updateCombatant(state, "scar", { hp: 2 });
    state = playNamedCard(state, "player", "sever", "scar");

    const responseUid = chooseAiResponse(state, "scar");
    expect(responseUid).toBe(getCombatant(state, "scar")?.hand[0].uid);
    state = respondToAttack(state, "scar", responseUid);
    expect(getCombatant(state, "scar")?.hp).toBe(1);
    expect(state.status).toBe("playing");
  });

  it("has the AI preserve Deflect when it cannot prevent defeat", () => {
    let state = startTurn(createInitialState(fixedRandom), "player", ["sever"]);
    state = setHand(state, "scar", ["deflect"]);
    state = updateCombatant(state, "scar", { hp: 1 });
    state = playNamedCard(state, "player", "sever", "scar");

    expect(chooseAiResponse(state, "scar")).toBeUndefined();
    const beforeHand = getCombatant(state, "scar")!.hand;
    state = declineResponse(state, "scar");
    expect(getCombatant(state, "scar")?.hp).toBe(0);
    expect(getCombatant(state, "scar")?.hand).toEqual(beforeHand);
  });

  it("ends the turn instead of proactively spending the final Deflect for no value", () => {
    let state = startTurn(createInitialState(fixedRandom), "scar", ["deflect"]);
    state = updateCombatant(state, "scar", { block: BLOCK_LIMIT });

    expect(chooseAiMove(state, "scar", "tactician")).toBeUndefined();
  });

  it("values breaking enemy block even when the hit deals no health damage", () => {
    let state = startTurn(createInitialState(fixedRandom), "scar", ["sever"]);
    state = updateCombatant(state, "player", { block: BLOCK_LIMIT, hand: [] });
    state = updateCombatant(state, "luna", { hp: 0 });

    const move = chooseAiMove(state, "scar", "standard");
    expect(move).toMatchObject({ targetId: "player" });
    const resolved = playCard(state, "scar", move!.cardUid, move!.targetId);
    expect(getCombatant(resolved, "player")).toMatchObject({ hp: 19, block: 0 });
  });

  it("cycles a non-response card when a full hand would otherwise lock future draws", () => {
    const fullHand = Array.from({ length: HAND_LIMIT }, () => "rekindle");
    const state = startTurn(createInitialState(fixedRandom), "scar", fullHand);

    const move = chooseAiMove(state, "scar", "standard");
    expect(move).toBeDefined();
    expect(getCombatant(state, "scar")?.hand.find((card) => card.uid === move?.cardUid)?.definitionId)
      .toBe("rekindle");
  });

  it("rejects illegal, out-of-turn, response-phase, and post-match actions", () => {
    let state = startTurn(createInitialState(fixedRandom), "player", ["sever", "fracture"]);
    state = setHand(state, "scar", ["deflect", "plate"]);
    const attack = getCombatant(state, "player")!.hand[0];

    expect(playCard(state, "player", attack.uid, "luna")).toBe(state);
    expect(playCard(state, "scar", attack.uid, "player")).toBe(state);
    expect(endTurn(state, "scar")).toBe(state);
    expect(respondToAttack(state, "scar", getCombatant(state, "scar")!.hand[0].uid)).toBe(state);

    const waiting = playCard(state, "player", attack.uid, "scar");
    expect(endTurn(waiting, "player")).toBe(waiting);
    expect(declineResponse(waiting, "ember")).toBe(waiting);
    expect(respondToAttack(waiting, "scar", getCombatant(waiting, "scar")!.hand[1].uid)).toBe(waiting);

    const finished: EmberPactState = { ...state, status: "finished", winner: "dawn" };
    expect(playCard(finished, "player", attack.uid, "scar")).toBe(finished);
    expect(endTurn(finished, "player")).toBe(finished);
  });

  it("finishes deterministic all-bot matches while resolving response phases", () => {
    const outcomes: string[] = [];
    for (let seed = 1; seed <= 12; seed += 1) {
      let state = createInitialState(seededRandom(seed));
      let decisions = 0;
      while (state.status === "playing" && decisions < 400) {
        state = driveBotDecision(state);
        decisions += 1;
      }

      expect(state.status, `seed ${seed} after ${decisions} decisions`).toBe("finished");
      expect(state.winner).toMatch(/^(dawn|dusk|draw)$/);
      outcomes.push(`${state.winner}:${state.roundNumber}:${decisions}`);
    }

    const replayed: string[] = [];
    for (let seed = 1; seed <= 12; seed += 1) {
      let state = createInitialState(seededRandom(seed));
      let decisions = 0;
      while (state.status === "playing" && decisions < 400) {
        state = driveBotDecision(state);
        decisions += 1;
      }
      replayed.push(`${state.winner}:${state.roundNumber}:${decisions}`);
    }
    expect(replayed).toEqual(outcomes);
  }, 15_000);
});
