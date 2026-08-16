import { useState } from "react";
import { evaluateHand } from "../domain/engine";
import type { PlayerHandState } from "../domain/types";
import { PlayingCard } from "./PlayingCard";

const STATUS_COPY: Record<Exclude<PlayerHandState["status"], "playing">, string> = {
  stood: "已停牌",
  busted: "爆牌",
  surrendered: "已投降",
};

function handStatusCopy(
  hand: PlayerHandState,
  index: number,
  activeHandIndex: number | null,
): string {
  if (hand.status === "playing") {
    return index === activeHandIndex ? "行动中" : "等待行动";
  }
  return STATUS_COPY[hand.status];
}

function handDisplayKey(hands: readonly PlayerHandState[], activeHandIndex: number | null): string {
  return [
    activeHandIndex ?? "none",
    ...hands.map((hand) => [
      hand.id,
      hand.status,
      hand.wager,
      hand.doubled ? "doubled" : "single",
      hand.fromSplit ? "split" : "original",
      hand.splitAces ? "aces" : "regular",
      hand.cards.map((card) => card.id).join(","),
    ].join(":")),
  ].join("|");
}

interface PlayerHandsProps {
  hands: readonly PlayerHandState[];
  activeHandIndex: number | null;
  latestCardId?: string;
}

export function PlayerHands({ hands, activeHandIndex, latestCardId }: PlayerHandsProps) {
  const [inspection, setInspection] = useState<{
    readonly index: number;
    readonly displayKey: string;
  }>();

  if (hands.length === 0) {
    return <div className="playing-hand playing-hand--player is-empty" aria-label="尚未发牌" />;
  }

  const displayKey = handDisplayKey(hands, activeHandIndex);
  const inspectedHandIndex = inspection?.displayKey === displayKey ? inspection.index : null;
  const visibleHandIndex = inspectedHandIndex ?? activeHandIndex ?? hands.length - 1;
  return (
    <>
      {hands.length > 1 && (
        <ol className="hand-rail" aria-label="玩家手牌进度">
          {hands.map((hand, index) => {
            const value = evaluateHand(hand.cards);
            const status = handStatusCopy(hand, index, activeHandIndex);
            return (
              <li key={hand.id} className={index === visibleHandIndex ? "is-current" : ""}>
                <button
                  type="button"
                  aria-label={`查看第 ${index + 1} 手牌，${value.total} 点，${status}`}
                  aria-pressed={index === visibleHandIndex}
                  onClick={() => setInspection({ index, displayKey })}
                >
                  <span>{index + 1}</span>
                  <strong>{value.total}</strong>
                  <small>{index === activeHandIndex ? "●" : hand.status === "stood" ? "✓" : hand.status === "busted" ? "×" : hand.status === "surrendered" ? "退" : "待"}</small>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <div className={`player-hands-grid player-hands-grid--${hands.length}`}>
        {hands.map((hand, handIndex) => {
          const value = evaluateHand(hand.cards);
          const status = handStatusCopy(hand, handIndex, activeHandIndex);
          const active = handIndex === activeHandIndex;
          const current = handIndex === visibleHandIndex;
          return (
            <section
              key={hand.id}
              className={`tw-player-hand ${active ? "is-active" : ""} ${current ? "is-current" : ""} is-${hand.status}`}
              aria-label={`手牌 ${handIndex + 1}，${value.total} 点，${status}`}
            >
              <header>
                <span>手牌 {handIndex + 1}</span>
                <strong>{value.total}</strong>
                <small>{hand.doubled ? `加倍 · ${hand.wager}` : `押 ${hand.wager}`}</small>
              </header>
              <div className="playing-hand playing-hand--player">
                {hand.cards.map((card, cardIndex) => (
                  <PlayingCard
                    key={card.id}
                    card={card}
                    index={cardIndex}
                    fresh={latestCardId === card.id}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
