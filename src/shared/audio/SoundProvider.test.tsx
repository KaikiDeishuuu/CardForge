/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SOUND_PREFERENCE_STORAGE_KEY,
  SoundProvider,
  useSound,
} from "./SoundProvider";

function SoundHarness() {
  const { enabled, play, toggle } = useSound();
  return (
    <main>
      <output aria-label="声音状态">{enabled ? "on" : "off"}</output>
      <button type="button" onClick={toggle}>切换声音</button>
      <button type="button" onClick={() => play("tap")}>播放提示音</button>
    </main>
  );
}

function renderSoundHarness() {
  return render(<SoundProvider><SoundHarness /></SoundProvider>);
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  state: AudioContextState = "running";
  currentTime = 1;
  destination = {} as AudioDestinationNode;

  createOscillator = vi.fn(() => {
    const oscillator = {
      type: "sine",
      frequency: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn((node: AudioNode) => node),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn(),
    };
    return oscillator;
  });

  createGain = vi.fn(() => ({
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn((node: AudioNode) => node),
    disconnect: vi.fn(),
  }));

  suspend = vi.fn(async () => {
    this.state = "suspended";
  });

  resume = vi.fn(async () => {
    this.state = "running";
  });

  close = vi.fn(async () => {
    this.state = "closed";
  });

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  FakeAudioContext.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SoundProvider", () => {
  it("restores, stores and synchronizes the sound preference", async () => {
    window.localStorage.setItem(SOUND_PREFERENCE_STORAGE_KEY, "off");
    const first = renderSoundHarness();
    expect(screen.getByLabelText("声音状态").textContent).toBe("off");

    fireEvent.click(screen.getByRole("button", { name: "切换声音" }));
    expect(screen.getByLabelText("声音状态").textContent).toBe("on");
    await waitFor(() => expect(window.localStorage.getItem(SOUND_PREFERENCE_STORAGE_KEY)).toBe("on"));

    first.unmount();
    renderSoundHarness();
    expect(screen.getByLabelText("声音状态").textContent).toBe("on");

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: SOUND_PREFERENCE_STORAGE_KEY,
        newValue: "off",
      }));
    });
    expect(screen.getByLabelText("声音状态").textContent).toBe("off");
  });

  it("keeps working when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    renderSoundHarness();
    expect(screen.getByLabelText("声音状态").textContent).toBe("on");
    fireEvent.click(screen.getByRole("button", { name: "切换声音" }));
    expect(screen.getByLabelText("声音状态").textContent).toBe("off");
  });

  it("reuses one lazy audio context, resumes it when needed and closes it when muted", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const view = renderSoundHarness();
    const play = screen.getByRole("button", { name: "播放提示音" });
    const toggle = screen.getByRole("button", { name: "切换声音" });

    fireEvent.click(play);
    fireEvent.click(play);
    expect(FakeAudioContext.instances).toHaveLength(1);
    const context = FakeAudioContext.instances[0];
    expect(context.createOscillator).toHaveBeenCalledTimes(2);

    context.state = "suspended";
    fireEvent.click(play);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.createOscillator).toHaveBeenCalledTimes(3);

    fireEvent.click(toggle);
    expect(context.close).toHaveBeenCalledTimes(1);
    fireEvent.click(play);
    expect(FakeAudioContext.instances).toHaveLength(1);

    fireEvent.click(toggle);
    fireEvent.click(play);
    expect(FakeAudioContext.instances).toHaveLength(2);
    const replacement = FakeAudioContext.instances[1];
    expect(replacement.createOscillator).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(replacement.close).toHaveBeenCalledTimes(1);
  });
});
