import { Component, lazy, Suspense, useMemo, type ErrorInfo, type ReactNode } from "react";
import type { GameRegistration } from "../core/games/types";

interface GameHostProps {
  registration: GameRegistration;
  onExit: () => void;
}

interface BoundaryProps {
  gameName: string;
  resetKey: string;
  onExit: () => void;
  children: ReactNode;
}

interface BoundaryState {
  error?: Error;
}

class GameErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = {};

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`CardForge failed to run ${this.props.gameName}.`, error, info);
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: undefined });
  }

  render() {
    if (this.state.error) {
      return (
        <main className="game-error" role="alert">
          <div className="game-error__card">
            <span className="game-error__seal" aria-hidden="true">断</span>
            <small>牌桌连接中断</small>
            <h1>“{this.props.gameName}”没有成功展开</h1>
            <p>游戏模块加载失败，或运行时遇到了未处理的问题。你的其他牌桌不受影响。</p>
            <div>
              <button type="button" className="game-error__reload" onClick={() => window.location.reload()}>重新加载</button>
              <button type="button" className="game-error__exit" onClick={this.props.onExit}>返回大厅</button>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

export function GameHost({ registration, onExit }: GameHostProps) {
  const LoadedGame = useMemo(() => {
    if (!registration.load) return null;
    return lazy(async () => {
      const module = await registration.load!();
      return { default: module.Game };
    });
  }, [registration]);

  if (!LoadedGame) return null;
  const gameName = registration.manifest.shortName;
  return (
    <GameErrorBoundary gameName={gameName} resetKey={registration.manifest.id} onExit={onExit}>
      <Suspense fallback={
        <main className="game-loading" role="status" aria-live="polite">
          <span className="forge-spinner" aria-hidden="true"><i /><i /><i /></span>
          <span><small>正在装载</small><strong>{gameName}</strong></span>
        </main>
      }>
        <LoadedGame onExit={onExit} />
      </Suspense>
    </GameErrorBoundary>
  );
}
