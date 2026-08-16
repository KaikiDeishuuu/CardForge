import { useEffect, useState } from "react";
import type { GameRegistration } from "../core/games/types";
import { loadGameSave, type StoredGameSave } from "../shared/storage/GameSaveStore";

interface LobbyProps {
  games: readonly GameRegistration[];
  soundEnabled: boolean;
  onToggleSound: () => void;
  onLaunch: (id: string) => void;
}

interface LobbySaveSummary {
  readonly savedAt: number;
  readonly revision: number;
}

function isLaunchable(game: GameRegistration): boolean {
  return game.manifest.availability === "playable" && Boolean(game.load);
}

function readSaveSummaries(games: readonly GameRegistration[]): ReadonlyMap<string, LobbySaveSummary> {
  const summaries = new Map<string, LobbySaveSummary>();
  for (const game of games) {
    if (!isLaunchable(game)) continue;
    const saved: StoredGameSave | undefined = loadGameSave(game.manifest.id);
    if (saved) summaries.set(game.manifest.id, { savedAt: saved.savedAt, revision: saved.snapshot.revision });
  }
  return summaries;
}

function formatSavedAgo(savedAt: number, now = Date.now()): string {
  const elapsedMinutes = Math.max(0, Math.floor((now - savedAt) / 60_000));
  if (elapsedMinutes < 1) return "刚刚";
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} 小时前`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} 天前`;
}

export function Lobby({ games, soundEnabled, onToggleSound, onLaunch }: LobbyProps) {
  const launchableCount = games.filter(isLaunchable).length;
  const [savedGames, setSavedGames] = useState(() => readSaveSummaries(games));

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (!event.key?.startsWith("cardforge.save.")) return;
      setSavedGames(readSaveSummaries(games));
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [games]);

  const featured = games.find((game) => game.manifest.featured && isLaunchable(game))
    ?? games.find(isLaunchable);
  const shelfGames = featured
    ? games.filter((game) => game.manifest.id !== featured.manifest.id)
    : games;
  const continueGames = [...savedGames.entries()]
    .map(([gameId, summary]) => ({ game: games.find((entry) => entry.manifest.id === gameId), summary }))
    .filter((entry): entry is { game: GameRegistration; summary: LobbySaveSummary } => Boolean(entry.game && isLaunchable(entry.game)))
    .sort((left, right) => right.summary.savedAt - left.summary.savedAt)
    .slice(0, 3);
  const featuredCode = featured
    ? `CF · ${String(games.indexOf(featured) + 1).padStart(3, "0")}`
    : "";

  return (
    <main className="lobby">
      <header className="lobby-header">
        <a href="#top" className="wordmark" aria-label="CardForge 首页">
          <span className="wordmark__mark" aria-hidden="true">牌</span>
          <span><strong>CardForge</strong><small>卡牌工坊</small></span>
        </a>
        <div className="lobby-header__meta">
          <span className="build-label">原型构建 · {String(launchableCount).padStart(2, "0")}</span>
          <button type="button" className="sound-button" onClick={onToggleSound}>
            <span aria-hidden="true">{soundEnabled ? "♪" : "×"}</span>
            {soundEnabled ? "声音开" : "声音关"}
          </button>
        </div>
      </header>

      <section className="lobby-hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span /> 一个大厅，多种牌桌</p>
          <h1>把下一种玩法<br />放上桌面。</h1>
          <p className="hero-intro">
            CardForge 是为不同卡牌规则准备的游戏平台。每个游戏独立生长，共用可靠的牌桌、交互与基础能力。
          </p>
          <dl className="platform-notes">
            <div><dt>现有牌桌</dt><dd>{launchableCount} 套独立规则可游玩</dd></div>
            <div><dt>设备方向</dt><dd>手机竖屏优先</dd></div>
            <div><dt>当前版本</dt><dd>可完整开始与结束</dd></div>
          </dl>
        </div>

        {featured && (
          <button type="button" className="featured-game" onClick={() => onLaunch(featured.manifest.id)}>
            <span className="featured-game__edge">现可游玩</span>
            <span className="featured-game__top">
              <span>{featured.manifest.genre}</span>
              <i>{featuredCode}</i>
            </span>
            <span className="featured-game__sigil" aria-hidden="true">
              <b>{featured.manifest.mark ?? "CF"}</b>
            </span>
            <span className="featured-game__copy">
              <small>{featured.manifest.tagline ?? featured.manifest.genre}</small>
              <strong>{featured.manifest.name}</strong>
              <span>{featured.manifest.description}</span>
            </span>
            <span className="featured-game__footer">
              <span>{featured.manifest.players}<i />{featured.manifest.sessionLength}</span>
              <b>揭牌进入 <i>→</i></b>
            </span>
          </button>
        )}
      </section>

      {continueGames.length > 0 && (
        <section className="continue-strip" aria-labelledby="continue-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow"><span /> 断点续玩</p>
              <h2 id="continue-title">牌桌还亮着</h2>
            </div>
            <p>平台只读取存档时间，不解读任何游戏内容。</p>
          </div>
          <div className="continue-grid">
            {continueGames.map(({ game, summary }) => (
              <button
                type="button"
                className="continue-game"
                key={game.manifest.id}
                onClick={() => onLaunch(game.manifest.id)}
                aria-label={`继续${game.manifest.name}，上次更新${formatSavedAgo(summary.savedAt)}`}
              >
                <span className="continue-game__mark" aria-hidden="true">{game.manifest.mark ?? "CF"}</span>
                <span className="continue-game__copy">
                  <small>{game.manifest.genre}</small>
                  <strong>{game.manifest.name}</strong>
                  <span>上次更新 {formatSavedAgo(summary.savedAt)} · 第 {summary.revision} 次变化</span>
                </span>
                <b>续玩 <i aria-hidden="true">→</i></b>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="game-shelf" aria-labelledby="shelf-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><span /> 牌桌索引</p>
            <h2 id="shelf-title">每套规则，都有自己的位置</h2>
          </div>
          <p>这些牌桌只共享平台能力，不共享玩法假设。</p>
        </div>
        <div className="planned-grid">
          {shelfGames.map((game) => {
            const isPlayable = isLaunchable(game);
            return (
            <button
              type="button"
              className={`planned-game ${isPlayable ? "is-playable" : ""}`}
              key={game.manifest.id}
              onClick={() => isPlayable && onLaunch(game.manifest.id)}
              disabled={!isPlayable}
            >
              <span className="planned-game__status">{isPlayable ? "现可游玩" : "筹备中"}</span>
              <span className="planned-game__glyph" aria-hidden="true">
                <b>{isPlayable ? (game.manifest.mark ?? "CF") : "筹"}</b>
              </span>
              <small>{game.manifest.genre}</small>
              <h3>{game.manifest.name}</h3>
              <p>{game.manifest.description}</p>
              <footer>
                <span>{game.manifest.players}</span>
                <span>{isPlayable ? "揭牌进入 →" : game.manifest.sessionLength}</span>
              </footer>
            </button>
          );})}
        </div>
      </section>

      <footer className="lobby-footer">
        <span className="wordmark wordmark--small">
          <span className="wordmark__mark" aria-hidden="true">牌</span>
          <span><strong>CardForge</strong><small>规则各自独立，体验彼此相通</small></span>
        </span>
        <p>第三次架构验证 · 本地单机 · 无账号 · 无商城</p>
      </footer>
    </main>
  );
}
