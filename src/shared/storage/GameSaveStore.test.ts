/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { clearGameSave, loadGameSave, saveGameSave } from "./GameSaveStore";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("GameSaveStore", () => {
  it("stores and reloads a save envelope without interpreting its data", () => {
    expect(loadGameSave("ember-pact")).toBeUndefined();
    expect(saveGameSave("ember-pact", 1, 7, { hp: 12 })).toBe(true);

    const saved = loadGameSave("ember-pact");
    expect(saved?.schemaVersion).toBe(1);
    expect(saved?.savedAt).toBeTypeOf("number");
    expect(saved?.snapshot).toMatchObject({ gameId: "ember-pact", revision: 7 });
    expect(saved?.snapshot.data).toEqual({ hp: 12 });
  });

  it("ignores corrupted, incomplete and foreign saves", () => {
    window.localStorage.setItem("cardforge.save.guandan", "{not json");
    expect(loadGameSave("guandan")).toBeUndefined();

    window.localStorage.setItem(
      "cardforge.save.guandan",
      JSON.stringify({ schemaVersion: 1, savedAt: 1 }),
    );
    expect(loadGameSave("guandan")).toBeUndefined();

    window.localStorage.setItem(
      "cardforge.save.guandan",
      JSON.stringify({ schemaVersion: 1, savedAt: 1, snapshot: { gameId: "other", revision: 1, data: {} } }),
    );
    expect(loadGameSave("guandan")).toBeUndefined();
  });

  it("ignores envelopes with negative, fractional or non-finite bookkeeping numbers", () => {
    const cases = [
      { schemaVersion: -1, savedAt: 1, snapshot: { gameId: "guandan", revision: 1, data: {} } },
      { schemaVersion: 1.5, savedAt: 1, snapshot: { gameId: "guandan", revision: 1, data: {} } },
      { schemaVersion: 1, savedAt: -1, snapshot: { gameId: "guandan", revision: 1, data: {} } },
      { schemaVersion: 1, savedAt: 1, snapshot: { gameId: "guandan", revision: -2, data: {} } },
      { schemaVersion: 1, savedAt: 1, snapshot: { gameId: "", revision: 1, data: {} } },
    ];
    for (const record of cases) {
      window.localStorage.setItem("cardforge.save.guandan", JSON.stringify(record));
      expect(loadGameSave("guandan")).toBeUndefined();
    }
  });

  it("clears saves and degrades gracefully when storage is unavailable", () => {
    saveGameSave("twenty-one", 1, 1, {});
    expect(loadGameSave("twenty-one")).toBeDefined();
    clearGameSave("twenty-one");
    expect(loadGameSave("twenty-one")).toBeUndefined();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    expect(saveGameSave("twenty-one", 1, 1, {})).toBe(false);
    expect(clearGameSave("twenty-one")).toBeUndefined();
  });
});
