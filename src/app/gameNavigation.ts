import type { GameRegistration } from "../core/games/types";

interface UrlLocation {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

export function readRequestedGameId(search: string): string | undefined {
  const value = new URLSearchParams(search).get("game")?.trim();
  return value || undefined;
}

export function resolvePlayableGameId(
  search: string,
  games: readonly GameRegistration[],
): string | undefined {
  const requested = readRequestedGameId(search);
  if (!requested) return undefined;
  const registration = games.find((game) => game.manifest.id === requested);
  return registration?.manifest.availability === "playable" && registration.load ? requested : undefined;
}

export function buildGameUrl(location: UrlLocation, gameId?: string): string {
  const parameters = new URLSearchParams(location.search);
  if (gameId) parameters.set("game", gameId);
  else parameters.delete("game");
  const search = parameters.toString();
  return `${location.pathname}${search ? `?${search}` : ""}${location.hash}`;
}
