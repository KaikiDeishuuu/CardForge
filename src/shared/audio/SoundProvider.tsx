import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type SoundCue = "tap" | "card" | "hit" | "heal" | "win";
export const SOUND_PREFERENCE_STORAGE_KEY = "cardforge.sound-enabled";

const CUES: Readonly<Record<SoundCue, readonly [frequency: number, duration: number]>> = {
  tap: [260, 0.035],
  card: [420, 0.055],
  hit: [110, 0.09],
  heal: [580, 0.12],
  win: [720, 0.18],
};

interface SoundContextValue {
  enabled: boolean;
  toggle: () => void;
  play: (cue: SoundCue) => void;
}

const SoundContext = createContext<SoundContextValue | null>(null);

function parseStoredPreference(value: string | null): boolean | undefined {
  if (value === "on") return true;
  if (value === "off") return false;
  return undefined;
}

function readStoredPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return parseStoredPreference(window.localStorage.getItem(SOUND_PREFERENCE_STORAGE_KEY)) ?? true;
  } catch {
    return true;
  }
}

function storePreference(enabled: boolean) {
  try {
    window.localStorage.setItem(SOUND_PREFERENCE_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Storage can be unavailable in privacy modes; sound still works for the current page.
  }
}

export function SoundProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(readStoredPreference);
  const audioContextRef = useRef<AudioContext | null>(null);
  const toggle = useCallback(() => setEnabled((value) => !value), []);

  useEffect(() => storePreference(enabled), [enabled]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== SOUND_PREFERENCE_STORAGE_KEY) return;
      setEnabled(parseStoredPreference(event.newValue) ?? true);
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const getAudioContext = useCallback(() => {
    if (audioContextRef.current && audioContextRef.current.state !== "closed") return audioContextRef.current;

    const AudioContextClass = window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return undefined;

    const context = new AudioContextClass();
    audioContextRef.current = context;
    return context;
  }, []);

  const play = useCallback((cue: SoundCue) => {
    if (!enabled || typeof window === "undefined") return;

    const context = getAudioContext();
    if (!context) return;
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const [frequency, duration] = CUES[cue];

    oscillator.type = cue === "hit" ? "sawtooth" : "sine";
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    if (cue === "win") oscillator.frequency.exponentialRampToValueAtTime(980, context.currentTime + duration);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      gain.disconnect();
    }, { once: true });
  }, [enabled, getAudioContext]);

  useEffect(() => {
    const context = audioContextRef.current;
    if (!enabled && context && context.state !== "closed") {
      audioContextRef.current = null;
      void context.close().catch(() => undefined);
    }
  }, [enabled]);

  useEffect(() => () => {
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ enabled, toggle, play }), [enabled, play, toggle]);
  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function useSound(): SoundContextValue {
  const context = useContext(SoundContext);
  if (!context) throw new Error("useSound must be used inside SoundProvider.");
  return context;
}
