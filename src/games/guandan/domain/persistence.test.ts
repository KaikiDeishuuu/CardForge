import { describe, expect, it } from "vitest";
import { createInitialState, getPlayer, playCards } from "./engine";
import { restoreGuandanState, serializeGuandanState } from "./persistence";

function tampered(overrides: Record<string, unknown>): unknown {
  return { ...createInitialState(() => 0.37), ...overrides };
}

describe("Guandan persistence", () => {
  it("round-trips an in-flight deal through a JSON envelope", () => {
    let game = createInitialState(() => 0.37);
    const first = getPlayer(game, "human").hand[0];
    game = playCards(game, "human", [first.id]);
    const restored = restoreGuandanState(JSON.parse(JSON.stringify(serializeGuandanState(game))));
    expect(restored).toEqual(game);
  });

  it("rejects unrecognizable saves", () => {
    expect(restoreGuandanState(undefined)).toBeUndefined();
    expect(restoreGuandanState(null)).toBeUndefined();
    expect(restoreGuandanState(tampered({ status: "corrupted" }))).toBeUndefined();
    expect(restoreGuandanState(tampered({ players: [] }))).toBeUndefined();
    expect(restoreGuandanState(tampered({ activePlayerId: "nobody" }))).toBeUndefined();
    expect(restoreGuandanState(tampered({ match: { dealNumber: 1 } }))).toBeUndefined();
  });

  it("rejects structurally broken but superficially JSON-valid tables", () => {
    const base = JSON.parse(JSON.stringify(createInitialState(() => 0.37)));

    const emptyActiveHand = JSON.parse(JSON.stringify(base));
    emptyActiveHand.players.find((player: { id: string }) => player.id === "human").hand = [];
    expect(restoreGuandanState(emptyActiveHand)).toBeUndefined();

    const duplicateId = JSON.parse(JSON.stringify(base));
    duplicateId.players[1].id = "human";
    duplicateId.players[1].team = "vermillion";
    duplicateId.players[1].controller = "ai";
    expect(restoreGuandanState(duplicateId)).toBeUndefined();

    const levelMismatch = JSON.parse(JSON.stringify(base));
    levelMismatch.match.levels.vermillion = "A";
    expect(restoreGuandanState(levelMismatch)).toBeUndefined();

    const badPlace = JSON.parse(JSON.stringify(base));
    badPlace.players[0].finishedPlace = 99;
    expect(restoreGuandanState(badPlace)).toBeUndefined();
  });

  it("rejects non-canonical seat metadata that the local table cannot control", () => {
    const base = JSON.parse(JSON.stringify(createInitialState(() => 0.37)));

    const remoteOpponent = JSON.parse(JSON.stringify(base));
    remoteOpponent.players[1].controller = "remote";
    expect(restoreGuandanState(remoteOpponent)).toBeUndefined();

    const renamedPartner = JSON.parse(JSON.stringify(base));
    renamedPartner.players[2].displayName = "另一位玩家";
    expect(restoreGuandanState(renamedPartner)).toBeUndefined();

    const reorderedSeats = JSON.parse(JSON.stringify(base));
    [reorderedSeats.players[1], reorderedSeats.players[2]] = [reorderedSeats.players[2], reorderedSeats.players[1]];
    expect(restoreGuandanState(reorderedSeats)).toBeUndefined();
  });
});
