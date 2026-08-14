import { describe, expect, it } from "vitest";
import { chooseAiMove, chooseBestMove } from "./ai";
import {
  DEFAULT_HUMAN_ID,
  HAND_LIMIT,
  createInitialState,
  selectableCombatantIds,
  getCombatant,
  getValidTargetIds,
  hasStatus,
  passTurn,
  playCard,
} from "./engine";
import type { CardInstance, Combatant, EmberPactState } from "./types";

const fixedRandom = () => 0.42;

function updateActor(
  state: EmberPactState,
  actorId: string,
  update: Partial<Combatant>,
): EmberPactState {
  return {
    ...state,
    combatants: state.combatants.map((actor) => actor.id === actorId ? { ...actor, ...update } : actor),
  };
}

function giveCard(
  state: EmberPactState,
  actorId: string,
  definitionId: string,
): { state: EmberPactState; card: CardInstance } {
  const card = { uid: `test-${actorId}-${definitionId}-${state.revision}`, definitionId };
  const actor = getCombatant(state, actorId)!;
  return { state: updateActor(state, actorId, { hand: [card, ...actor.hand] }), card };
}

describe("Ember Pact engine", () => {
  it("starts four asymmetric combatants with four cards", () => {
    const state = createInitialState(fixedRandom);
    expect(state.combatants).toHaveLength(4);
    expect(state.combatants.every((actor) => actor.hand.length === 4)).toBe(true);
    expect(state.combatants.map((actor) => actor.maxHp)).toEqual([24, 20, 25, 21]);
    expect(new Set(state.combatants.map((actor) => actor.passiveId)).size).toBe(4);
    expect(state.roundNumber).toBe(1);
  });

  it("seats the human on any chosen combatant and leaves the rest to the AI", () => {
    const asScar = createInitialState(fixedRandom, "scar");
    expect(getCombatant(asScar, "scar")?.controller).toBe("human");
    expect(getCombatant(asScar, "player")?.controller).toBe("ai");
    expect(asScar.combatants.filter((actor) => actor.controller === "human")).toHaveLength(1);
    expect(getCombatant(asScar, "scar")?.team).toBe("dusk");

    const fallback = createInitialState(fixedRandom, "nobody");
    expect(getCombatant(fallback, DEFAULT_HUMAN_ID)?.controller).toBe("human");
    expect(selectableCombatantIds()).toEqual(["player", "luna", "scar", "ember"]);
  });

  it("drains with siphon and shields with aegis", () => {
    const drained = updateActor(createInitialState(fixedRandom), "player", { hp: 18 });
    const siphon = giveCard(drained, "player", "siphon");
    const drain = playCard(siphon.state, "player", siphon.card.uid, "scar");
    expect(getCombatant(drain, "scar")?.hp).toBe(22);
    expect(getCombatant(drain, "player")?.hp).toBe(20);

    // 护盾在目标下一次行动开始时清空，所以挡在自己身上才留得住。
    const exposed = updateActor(createInitialState(fixedRandom), "player", { statuses: [{ id: "exposed" }] });
    const aegis = giveCard(exposed, "player", "aegis");
    const shielded = playCard(aegis.state, "player", aegis.card.uid, "player");
    expect(getCombatant(shielded, "player")?.block).toBe(4);
    expect(hasStatus(getCombatant(shielded, "player")!, "exposed")).toBe(false);
  });

  it("lights a single-turn burn with emberwind", () => {
    const emberTurn = { ...createInitialState(fixedRandom), activePlayerId: "ember" };
    const wind = giveCard(emberTurn, "ember", "emberwind");
    const burned = playCard(wind.state, "ember", wind.card.uid, "player");

    expect(getCombatant(burned, "player")?.hp).toBe(22);
    expect(getCombatant(burned, "player")?.statuses.find((status) => status.id === "burning")?.remainingTurns).toBe(1);
  });

  it("validates enemy, ally and self target rules", () => {
    const initial = createInitialState(fixedRandom);
    const attack = giveCard(initial, "player", "sever");
    expect([...getValidTargetIds(attack.state, "player", attack.card.uid)].sort()).toEqual(["ember", "scar"]);

    const temper = giveCard(initial, "player", "temper");
    expect(getValidTargetIds(temper.state, "player", temper.card.uid)).toEqual(["player"]);
  });

  it("resolves direct damage and advances to the AI teammate", () => {
    const setup = giveCard(createInitialState(fixedRandom), "player", "sever");
    const next = playCard(setup.state, "player", setup.card.uid, "scar");
    expect(getCombatant(next, "scar")?.hp).toBe(22);
    expect(next.activePlayerId).toBe("luna");
    expect(next.revision).toBe(1);
  });

  it("applies and consumes exposed on the next direct attack", () => {
    const fracture = giveCard(createInitialState(fixedRandom), "player", "fracture");
    const exposed = playCard(fracture.state, "player", fracture.card.uid, "scar");
    expect(hasStatus(getCombatant(exposed, "scar")!, "exposed")).toBe(true);

    const playerAgain = { ...exposed, activePlayerId: "player" };
    const sever = giveCard(playerAgain, "player", "sever");
    const hit = playCard(sever.state, "player", sever.card.uid, "scar");
    expect(getCombatant(hit, "scar")?.hp).toBe(19);
    expect(hasStatus(getCombatant(hit, "scar")!, "exposed")).toBe(false);
  });

  it("ticks burning twice at the end of the affected actor's turns", () => {
    const cinder = giveCard(createInitialState(fixedRandom), "player", "cinder");
    const burning = playCard(cinder.state, "player", cinder.card.uid, "scar");
    expect(hasStatus(getCombatant(burning, "scar")!, "burning")).toBe(true);

    const firstTick = passTurn({ ...burning, activePlayerId: "scar" }, "scar");
    expect(getCombatant(firstTick, "scar")?.hp).toBe(22);
    expect(getCombatant(firstTick, "scar")?.statuses.find((status) => status.id === "burning")?.remainingTurns).toBe(1);

    const secondTick = passTurn({ ...firstTick, activePlayerId: "scar" }, "scar");
    expect(getCombatant(secondTick, "scar")?.hp).toBe(20);
    expect(hasStatus(getCombatant(secondTick, "scar")!, "burning")).toBe(false);
  });

  it("keeps an untimed burn alight until it is cleansed", () => {
    const initial = updateActor(createInitialState(fixedRandom), "player", {
      statuses: [{ id: "burning" }],
    });
    const firstTick = passTurn(initial, "player");
    expect(getCombatant(firstTick, "player")?.hp).toBe(22);
    expect(hasStatus(getCombatant(firstTick, "player")!, "burning")).toBe(true);

    // 没有剩余回合的灼烧与「破绽」「蓄势」一样是永久的，不会自己熄灭。
    const laterTick = passTurn({ ...firstTick, activePlayerId: "player" }, "player");
    expect(hasStatus(getCombatant(laterTick, "player")!, "burning")).toBe(true);
  });

  it("renews a burn when cinder lands on an already burning target", () => {
    const weakened = updateActor(createInitialState(fixedRandom), "scar", {
      statuses: [{ id: "burning", remainingTurns: 1 }],
    });
    const cinder = giveCard(weakened, "player", "cinder");
    const renewed = playCard(cinder.state, "player", cinder.card.uid, "scar");
    expect(getCombatant(renewed, "scar")?.statuses.find((status) => status.id === "burning")?.remainingTurns).toBe(2);
  });

  it("triggers Furnace Heart and Afterglow passives", () => {
    const plate = giveCard(createInitialState(fixedRandom), "player", "plate");
    const guarded = playCard(plate.state, "player", plate.card.uid, "player");
    expect(getCombatant(guarded, "player")?.block).toBe(5);
    expect(hasStatus(getCombatant(guarded, "player")!, "tempered")).toBe(true);

    let lunaTurn = { ...createInitialState(fixedRandom), activePlayerId: "luna" };
    lunaTurn = updateActor(lunaTurn, "player", { hp: 10 });
    const heal = giveCard(lunaTurn, "luna", "rekindle");
    const restored = playCard(heal.state, "luna", heal.card.uid, "player");
    expect(getCombatant(restored, "player")?.hp).toBe(14);
    expect(getCombatant(restored, "player")?.block).toBe(2);
  });

  it("triggers Siegebreaker and Firehunt damage bonuses", () => {
    let scarTurn = { ...createInitialState(fixedRandom), activePlayerId: "scar" };
    scarTurn = updateActor(scarTurn, "player", { block: 5 });
    const scarAttack = giveCard(scarTurn, "scar", "sever");
    const breached = playCard(scarAttack.state, "scar", scarAttack.card.uid, "player");
    expect(getCombatant(breached, "player")?.block).toBe(0);
    expect(getCombatant(breached, "player")?.hp).toBe(24);

    let emberTurn = { ...createInitialState(fixedRandom), activePlayerId: "ember" };
    emberTurn = updateActor(emberTurn, "player", { statuses: [{ id: "burning", remainingTurns: 2 }] });
    const emberAttack = giveCard(emberTurn, "ember", "sever");
    const hunted = playCard(emberAttack.state, "ember", emberAttack.card.uid, "player");
    expect(getCombatant(hunted, "player")?.hp).toBe(19);
  });

  it("does not brand a target its own earlier effect defeated", () => {
    const weakened = updateActor(createInitialState(fixedRandom), "scar", { hp: 1 });
    const cinder = giveCard(weakened, "player", "cinder");
    const result = playCard(cinder.state, "player", cinder.card.uid, "scar");

    expect(getCombatant(result, "scar")?.hp).toBe(0);
    expect(hasStatus(getCombatant(result, "scar")!, "burning")).toBe(false);
    expect(result.lastAction?.events.some((event) => event.kind === "status-applied")).toBe(false);
  });

  it("stays quiet when a heal restores nothing but still pays the passive", () => {
    const lunaTurn = { ...createInitialState(fixedRandom), activePlayerId: "luna" };
    const heal = giveCard(lunaTurn, "luna", "rekindle");
    const result = playCard(heal.state, "luna", heal.card.uid, "player");

    expect(getCombatant(result, "player")?.hp).toBe(24);
    expect(result.lastAction?.events.some((event) => event.kind === "heal")).toBe(false);
    expect(getCombatant(result, "player")?.block).toBe(2);
  });

  it("cleanses harmful statuses while healing", () => {
    let state = updateActor(createInitialState(fixedRandom), "player", {
      hp: 20,
      statuses: [{ id: "exposed" }, { id: "burning", remainingTurns: 2 }],
    });
    const refine = giveCard(state, "player", "refine");
    state = playCard(refine.state, "player", refine.card.uid, "player");
    expect(getCombatant(state, "player")?.hp).toBe(22);
    expect(getCombatant(state, "player")?.statuses).toEqual([]);
  });

  it("starts escalating unblocked overheat at round thirteen", () => {
    const state = { ...createInitialState(fixedRandom), roundNumber: 13 };
    const next = passTurn(state, "player");
    expect(getCombatant(next, "player")?.hp).toBe(23);
    expect(next.lastAction?.events.some((event) => event.kind === "overheat" && event.amount === 1)).toBe(true);
  });

  it("discards the next draw when the incoming actor has a full hand", () => {
    const initial = createInitialState(fixedRandom);
    const luna = getCombatant(initial, "luna")!;
    const filler = Array.from({ length: HAND_LIMIT }, (_, index) => ({ uid: `full-${index}`, definitionId: "sever" }));
    const state = updateActor(initial, "luna", { hand: filler });
    const next = passTurn(state, "player");
    expect(getCombatant(next, "luna")?.hand).toHaveLength(HAND_LIMIT);
    expect(getCombatant(next, "luna")?.discard).toHaveLength(luna.discard.length + 1);
    expect(next.lastAction?.events.some((event) => event.kind === "card-overflow")).toBe(true);
  });

  it("reshuffles an exhausted deck instead of dealing the discard back in order", () => {
    const base = createInitialState(fixedRandom);
    const source = getCombatant(base, "player")!;
    const pile = [...source.deck, ...source.hand];
    const emptied = updateActor(base, "player", { deck: [], discard: pile, hand: [] });

    // ember acts last, so the turn wraps to player, whose draw must recycle.
    const recycledOrder = (rngSeed: number) => {
      const next = passTurn({ ...emptied, activePlayerId: "ember", rngSeed }, "ember");
      const after = getCombatant(next, "player")!;
      return [...after.deck, ...after.hand].map((card) => card.uid);
    };

    const order = recycledOrder(7);
    expect(order).toHaveLength(pile.length);
    expect([...order].sort()).toEqual(pile.map((card) => card.uid).sort());
    expect(order, "must not simply replay the discard pile backwards")
      .not.toEqual([...pile].reverse().map((card) => card.uid));
    expect(order, "the same seed must reproduce the exact shuffle")
      .toEqual(recycledOrder(7));
    expect(order, "a different seed must produce a different shuffle")
      .not.toEqual(recycledOrder(99));
  });

  it("lets the scored AI choose a legal move and prefer a match-winning attack", () => {
    const aiTurn = passTurn(createInitialState(fixedRandom), "player");
    const legalMove = chooseAiMove(aiTurn, "luna");
    expect(legalMove).toBeDefined();
    expect(getValidTargetIds(aiTurn, "luna", legalMove!.cardUid)).toContain(legalMove!.targetId);

    let decisive = { ...createInitialState(fixedRandom), activePlayerId: "scar" };
    decisive = updateActor(decisive, "player", { hp: 2 });
    decisive = updateActor(decisive, "luna", { hp: 0 });
    decisive = updateActor(decisive, "scar", { hand: [] });
    const attack = giveCard(decisive, "scar", "sever");
    const guard = giveCard(attack.state, "scar", "plate");
    const choice = chooseAiMove(guard.state, "scar");
    expect(choice).toEqual({ cardUid: attack.card.uid, targetId: "player" });
  });

  it("marks defeated actors and completes the match", () => {
    let decisive = createInitialState(fixedRandom);
    decisive = updateActor(decisive, "scar", { hp: 2 });
    decisive = updateActor(decisive, "ember", { hp: 0 });
    const attack = giveCard(decisive, "player", "sever");
    const result = playCard(attack.state, "player", attack.card.uid, "scar");
    expect(getCombatant(result, "scar")?.hp).toBe(0);
    expect(result.status).toBe("finished");
    expect(result.winner).toBe("dawn");
  });

  it("rejects illegal, out-of-turn and post-match actions", () => {
    const setup = giveCard(createInitialState(fixedRandom), "player", "sever");
    expect(playCard(setup.state, "player", setup.card.uid, "luna")).toBe(setup.state);
    expect(playCard(setup.state, "luna", setup.card.uid, "player")).toBe(setup.state);

    const finished: EmberPactState = { ...setup.state, status: "finished", winner: "dawn" };
    expect(playCard(finished, "player", setup.card.uid, "scar")).toBe(finished);
    expect(passTurn(finished, "player")).toBe(finished);
  });

  it("skips defeated actors and increments the round only when order wraps", () => {
    let state = updateActor(createInitialState(fixedRandom), "luna", { hp: 0 });
    state = passTurn(state, "player");
    expect(state.activePlayerId).toBe("scar");
    expect(state.roundNumber).toBe(1);

    state = { ...state, activePlayerId: "ember" };
    state = passTurn(state, "ember");
    expect(state.activePlayerId).toBe("player");
    expect(state.roundNumber).toBe(2);
  });

  it("guarantees deterministic bot matches terminate through overheat", () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      let value = seed;
      const random = () => {
        value = (value * 16_807) % 2_147_483_647;
        return value / 2_147_483_647;
      };
      let state = createInitialState(random);
      let actions = 0;
      while (state.status === "playing" && actions < 200) {
        const move = chooseBestMove(state, state.activePlayerId);
        state = move
          ? playCard(state, state.activePlayerId, move.cardUid, move.targetId)
          : passTurn(state, state.activePlayerId);
        actions += 1;
      }
      expect(state.status, `seed ${seed} after ${actions} actions`).toBe("finished");
    }
  });
});
