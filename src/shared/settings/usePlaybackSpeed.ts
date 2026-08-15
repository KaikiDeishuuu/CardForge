import { useCallback, useEffect, useState } from "react";

export const PLAYBACK_SPEEDS = [1, 2, 4] as const;
export type PlaybackSpeed = typeof PLAYBACK_SPEEDS[number];
export const PLAYBACK_SPEED_STORAGE_KEY = "cardforge.playback-speed";

export function parseStoredPlaybackSpeed(value: string | null): PlaybackSpeed {
  const parsed = value === null ? Number.NaN : Number(value);
  return PLAYBACK_SPEEDS.includes(parsed as PlaybackSpeed) ? parsed as PlaybackSpeed : 1;
}

function readStoredPlaybackSpeed(): PlaybackSpeed {
  if (typeof window === "undefined") return 1;
  try {
    return parseStoredPlaybackSpeed(window.localStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY));
  } catch {
    return 1;
  }
}

function storePlaybackSpeed(speed: PlaybackSpeed) {
  try {
    window.localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, String(speed));
  } catch {
    // Storage can be unavailable in privacy modes; the speed still works for the current page.
  }
}

/**
 * 三张牌桌共享的 AI 演出速度偏好：只影响等待动画/间隔，不改变规则。
 * 偏好保存在本机并跨标签同步，默认 1×。
 */
export function usePlaybackSpeed(): { speed: PlaybackSpeed; cycle: () => void } {
  const [speed, setSpeed] = useState<PlaybackSpeed>(readStoredPlaybackSpeed);

  useEffect(() => storePlaybackSpeed(speed), [speed]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== PLAYBACK_SPEED_STORAGE_KEY) return;
      setSpeed(parseStoredPlaybackSpeed(event.newValue));
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const cycle = useCallback(() => {
    setSpeed((current) => {
      const nextIndex = (PLAYBACK_SPEEDS.indexOf(current) + 1) % PLAYBACK_SPEEDS.length;
      return PLAYBACK_SPEEDS[nextIndex];
    });
  }, []);

  return { speed, cycle };
}

export function playbackDelay(baseMilliseconds: number, speed: PlaybackSpeed): number {
  return Math.max(0, Math.round(baseMilliseconds / speed));
}
