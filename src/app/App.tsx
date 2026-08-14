import { lazy, Suspense, useMemo, useState } from "react";
import { SoundProvider, useSound } from "../shared/audio/SoundProvider";
import { gameRegistry } from "../games/registry";
import { Lobby } from "./Lobby";

function AppContent() {
  const [activeGameId, setActiveGameId] = useState<string>();
  const { enabled, toggle, play } = useSound();
  const games = gameRegistry.list();
  const registration = activeGameId ? gameRegistry.get(activeGameId) : undefined;
  const LoadedGame = useMemo(
    () => registration?.load
      ? lazy(async () => {
          const module = await registration.load!();
          return { default: module.Game };
        })
      : null,
    [registration],
  );

  if (LoadedGame) {
    return (
      <Suspense fallback={
        <div className="game-loading" role="status">
          <span className="forge-spinner" aria-hidden="true"><i /><i /><i /></span>
          <strong>正在摆好牌桌</strong>
        </div>
      }>
        <LoadedGame onExit={() => setActiveGameId(undefined)} />
      </Suspense>
    );
  }

  return (
    <Lobby
      games={games}
      soundEnabled={enabled}
      onToggleSound={toggle}
      onLaunch={(id) => {
        const game = gameRegistry.get(id);
        if (!game?.load) return;
        play("card");
        setActiveGameId(id);
      }}
    />
  );
}

export function App() {
  return (
    <SoundProvider>
      <AppContent />
    </SoundProvider>
  );
}
