import { useCallback, useEffect, useState } from "react";
import { gameRegistry } from "../games/registry";
import { SoundProvider, useSound } from "../shared/audio/SoundProvider";
import { GameHost } from "./GameHost";
import { buildGameUrl, resolvePlayableGameId } from "./gameNavigation";
import { Lobby } from "./Lobby";

const HISTORY_MARKER = "cardforge-launch";
const REGISTERED_GAMES = gameRegistry.list();

function requestedGameId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return resolvePlayableGameId(window.location.search, REGISTERED_GAMES);
}

function AppContent() {
  const [activeGameId, setActiveGameId] = useState(requestedGameId);
  const { enabled, toggle, play } = useSound();
  const games = REGISTERED_GAMES;
  const registration = activeGameId ? gameRegistry.get(activeGameId) : undefined;

  useEffect(() => {
    const handlePopState = () => setActiveGameId(requestedGameId());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("game");
    if (requested && !resolvePlayableGameId(window.location.search, games)) {
      window.history.replaceState(window.history.state, "", buildGameUrl(window.location, undefined));
    }
  }, [games]);

  const exitGame = useCallback(() => {
    const state = window.history.state as { cardForge?: string } | null;
    if (state?.cardForge === HISTORY_MARKER) {
      window.history.back();
      return;
    }
    window.history.replaceState(window.history.state, "", buildGameUrl(window.location, undefined));
    setActiveGameId(undefined);
  }, []);

  if (registration?.load && registration.manifest.availability === "playable") {
    return <GameHost registration={registration} onExit={exitGame} />;
  }

  return (
    <Lobby
      games={games}
      soundEnabled={enabled}
      onToggleSound={toggle}
      onLaunch={(id) => {
        const game = gameRegistry.get(id);
        if (!game?.load || game.manifest.availability !== "playable") return;
        play("card");
        window.history.pushState(
          { ...window.history.state, cardForge: HISTORY_MARKER },
          "",
          buildGameUrl(window.location, id),
        );
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
