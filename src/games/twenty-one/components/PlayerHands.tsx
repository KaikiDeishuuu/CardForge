import { evaluateHand } from "../domain/engine";
import type { PlayerHandState } from "../domain/types";
import { PlayingCard } from "./PlayingCard";

const STATUS_COPY: Record<PlayerHandState["status"], string> = {
  playing: "行动中",
  stood: "已停牌",
  busted: "爆牌",
  surrendered: "已投降",
};

interface PlayerHandsProps {
  hands: readonly PlayerHandState[];
  activeHandIndex: number | null;
  latestCardId?: string;
}

export function PlayerHands({ hands, activeHandIndex, latestCardId }: PlayerHandsProps) {
  if (hands.length === 0) {
    return <div className="playing-hand playing-hand--player is-empty" aria-label="尚未发牌" />;
  }

  const visibleHandIndex = activeHandIndex ?? hands.length - 1;
  return (
    <>
      {hands.length > 1 && (
        <ol className="hand-rail" aria-label="玩家手牌进度">
          {hands.map((hand, index) => {
            const value = evaluateHand(hand.cards);
            return (
              <li key={hand.id} className={index === visibleHandIndex ? "is-current" : ""}>
                <span>{index + 1}</span>
                <strong>{value.total}</strong>
                <small>{index === activeHandIndex ? "●" : hand.status === "stood" ? "✓" : hand.status === "busted" ? "×" : hand.status === "surrendered" ? "退" : "·"}</small>
              </li>
            );
          })}
        </ol>
      )}
      <div className={`player-hands-grid player-hands-grid--${hands.length}`}>
        {hands.map((hand, handIndex) => {
          const value = evaluateHand(hand.cards);
          const active = handIndex === activeHandIndex;
          const current = handIndex === visibleHandIndex;
          return (
            <section
              key={hand.id}
              className={`tw-player-hand ${active ? "is-active" : ""} ${current ? "is-current" : ""} is-${hand.status}`}
              aria-label={`手牌 ${handIndex + 1}，${value.total} 点，${STATUS_COPY[hand.status]}`}
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
