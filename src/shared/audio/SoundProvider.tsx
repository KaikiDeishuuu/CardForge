import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface SoundContextValue {
  enabled: boolean;
  toggle: () => void;
  play: (cue: "tap" | "card" | "hit" | "heal" | "win") => void;
}

const SoundContext = createContext<SoundContextValue | null>(null);

export function SoundProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(true);
  const toggle = useCallback(() => setEnabled((value) => !value), []);
  const play = useCallback((cue: "tap" | "card" | "hit" | "heal" | "win") => {
    if (!enabled || typeof window === "undefined") return;

    const AudioContextClass = window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const cues = {
      tap: [260, 0.035],
      card: [420, 0.055],
      hit: [110, 0.09],
      heal: [580, 0.12],
      win: [720, 0.18],
    } as const;
    const [frequency, duration] = cues[cue];

    oscillator.type = cue === "hit" ? "sawtooth" : "sine";
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    if (cue === "win") oscillator.frequency.exponentialRampToValueAtTime(980, context.currentTime + duration);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
    oscillator.addEventListener("ended", () => void context.close());
  }, [enabled]);

  const value = useMemo(() => ({ enabled, toggle, play }), [enabled, play, toggle]);
  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function useSound(): SoundContextValue {
  const context = useContext(SoundContext);
  if (!context) throw new Error("useSound must be used inside SoundProvider.");
  return context;
}
