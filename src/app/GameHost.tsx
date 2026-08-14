import { Component, lazy, Suspense, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import type { GameRegistration } from "../core/games/types";

interface GameHostProps {
  registration: GameRegistration;
  onExit: () => void;
  reloadPage?: () => void;
}

interface BoundaryProps {
  gameName: string;
  onExit: () => void;
  onRetry: (error: Error) => void;
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

  render() {
    if (this.state.error) {
      return (
        <GameErrorView
          gameName={this.props.gameName}
          onExit={this.props.onExit}
          onRetry={() => this.props.onRetry(this.state.error!)}
        />
      );
    }
    return this.props.children;
  }
}

interface GameLoadingProps {
  gameName: string;
  retrying?: boolean;
}

export function GameLoading({ gameName, retrying = false }: GameLoadingProps) {
  return (
    <main className="game-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="forge-spinner" aria-hidden="true"><i /><i /><i /></span>
      <span className="game-loading__copy">
        <small>{retrying ? "正在重新接驳" : "正在展开牌桌"}</small>
        <strong>{gameName}</strong>
        <p>正在准备规则、牌面与交互。</p>
      </span>
      <span className="game-loading__rail" aria-hidden="true"><i /><b>CF · GAME HOST</b><i /></span>
    </main>
  );
}

interface GameErrorViewProps {
  gameName: string;
  onExit: () => void;
  onRetry: () => void;
}

export function GameErrorView({ gameName, onExit, onRetry }: GameErrorViewProps) {
  return (
    <main className="game-error" role="alert" aria-labelledby="game-error-title" aria-describedby="game-error-description">
      <div className="game-error__card">
        <span className="game-error__seal" aria-hidden="true">断</span>
        <small>牌桌未能展开</small>
        <h1 id="game-error-title">“{gameName}”暂时无法打开</h1>
        <p id="game-error-description">重试会保留当前牌桌入口，并重新连接所需资源；大厅和其他游戏不受影响。</p>
        <div>
          <button type="button" className="game-error__reload" onClick={onRetry} autoFocus>重试牌桌</button>
          <button type="button" className="game-error__exit" onClick={onExit}>返回大厅</button>
        </div>
      </div>
    </main>
  );
}

const MODULE_LOAD_ERROR_PATTERNS = [
  /dynamically imported module/i,
  /importing a module script failed/i,
  /failed to fetch module script/i,
  /chunkloaderror/i,
  /loading chunk .* failed/i,
];

export function isModuleLoadError(error: Error): boolean {
  return error.name === "ChunkLoadError"
    || MODULE_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
}

export function GameHost({ registration, onExit, reloadPage = () => window.location.reload() }: GameHostProps) {
  const [attempt, setAttempt] = useState(0);
  // `attempt` is a cache key, not a value the loader reads: bumping it is what
  // discards React's memo of a failed lazy component so a retry re-imports.
  const LoadedGame = useMemo(() => {
    if (!registration.load) return null;
    return lazy(async () => {
      const module = await registration.load!();
      return { default: module.Game };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, registration]);

  if (!LoadedGame) return null;
  const gameName = registration.manifest.shortName;
  return (
    <GameErrorBoundary
      key={`${registration.manifest.id}:${attempt}`}
      gameName={gameName}
      onExit={onExit}
      onRetry={(error) => {
        if (isModuleLoadError(error)) {
          reloadPage();
          return;
        }
        setAttempt((current) => current + 1);
      }}
    >
      <Suspense fallback={
        <GameLoading gameName={gameName} retrying={attempt > 0} />
      }>
        {/*
          Rebuilding the lazy component is the retry: a fresh component type is
          what discards the failed import so the browser re-fetches the chunk.
          This subtree is meant to lose its state, and the boundary key above
          forces that too, so static-components is knowingly violated here.
        */}
        {/* eslint-disable-next-line react-hooks/static-components */}
        <LoadedGame onExit={onExit} />
      </Suspense>
    </GameErrorBoundary>
  );
}
