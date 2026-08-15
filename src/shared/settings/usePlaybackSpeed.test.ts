import { describe, expect, it } from "vitest";
import { PLAYBACK_SPEEDS, parseStoredPlaybackSpeed, playbackDelay } from "./usePlaybackSpeed";

describe("playback speed preference", () => {
  it("parses valid stored speeds and falls back to 1×", () => {
    expect(parseStoredPlaybackSpeed(null)).toBe(1);
    expect(parseStoredPlaybackSpeed("2")).toBe(2);
    expect(parseStoredPlaybackSpeed("4")).toBe(4);
    expect(parseStoredPlaybackSpeed("8")).toBe(1);
    expect(parseStoredPlaybackSpeed("fast")).toBe(1);
  });

  it("scales AI pacing delays without dropping below zero", () => {
    expect(PLAYBACK_SPEEDS).toEqual([1, 2, 4]);
    expect(playbackDelay(620, 1)).toBe(620);
    expect(playbackDelay(620, 2)).toBe(310);
    expect(playbackDelay(460, 4)).toBe(115);
    expect(playbackDelay(10, 4)).toBe(3);
  });
});
