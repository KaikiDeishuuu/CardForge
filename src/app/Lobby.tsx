import type { CSSProperties } from "react";
import type { GameRegistration } from "../core/games/types";

interface LobbyProps {
  games: readonly GameRegistration[];
  soundEnabled: boolean;
  onToggleSound: () => void;
  onLaunch: (id: string) => void;
}

export function Lobby({ games, soundEnabled, onToggleSound, onLaunch }: LobbyProps) {
  const playable = games.find((game) => game.manifest.availability === "playable")!;
  const planned = games.filter((game) => game.manifest.availability === "planned");

  return (
    <main className="lobby">
      <header className="lobby-header">
        <a href="#top" className="wordmark" aria-label="CardForge 首页">
          <span className="wordmark__mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>CardForge</strong><small>卡牌工坊</small></span>
        </a>
        <div className="lobby-header__meta">
          <span className="build-label">原型构建 · 01</span>
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
            <div><dt>首个试炼</dt><dd>原创 2v2 回合对战</dd></div>
            <div><dt>设备方向</dt><dd>手机竖屏优先</dd></div>
            <div><dt>当前版本</dt><dd>可完整开始与结束</dd></div>
          </dl>
        </div>

        <button type="button" className="featured-game" onClick={() => onLaunch(playable.manifest.id)}>
          <span className="featured-game__edge">现可游玩</span>
          <span className="featured-game__top">
            <span>{playable.manifest.genre}</span>
            <i>CF · 001</i>
          </span>
          <span className="featured-game__sigil" aria-hidden="true">
            <i /><i /><i />
            <b>烬</b>
          </span>
          <span className="featured-game__copy">
            <small>架构验证局</small>
            <strong>{playable.manifest.name}</strong>
            <span>{playable.manifest.description}</span>
          </span>
          <span className="featured-game__footer">
            <span>{playable.manifest.players}<i />{playable.manifest.sessionLength}</span>
            <b>揭牌进入 <i>→</i></b>
          </span>
        </button>
      </section>

      <section className="game-shelf" aria-labelledby="shelf-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><span /> 工坊计划</p>
            <h2 id="shelf-title">以后，每套规则都有自己的位置</h2>
          </div>
          <p>这些牌桌只共享平台能力，不共享玩法假设。</p>
        </div>
        <div className="planned-grid">
          {planned.map((game) => (
            <article className="planned-game" key={game.manifest.id} style={{ "--game-accent": game.manifest.accent } as CSSProperties}>
              <span className="planned-game__status">筹备中</span>
              <div className="planned-game__glyph" aria-hidden="true"><i /><i /></div>
              <small>{game.manifest.genre}</small>
              <h3>{game.manifest.name}</h3>
              <p>{game.manifest.description}</p>
              <footer><span>{game.manifest.players}</span><span>{game.manifest.sessionLength}</span></footer>
            </article>
          ))}
        </div>
      </section>

      <footer className="lobby-footer">
        <span className="wordmark wordmark--small">
          <span className="wordmark__mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>CardForge</strong><small>规则各自独立，体验彼此相通</small></span>
        </span>
        <p>第一阶段 · 本地单机 · 无账号 · 无商城</p>
      </footer>
    </main>
  );
}
