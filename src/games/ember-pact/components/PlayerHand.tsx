import { CardFrame } from "../../../shared/cards/CardFrame";
import { getCard } from "../domain/engine";
import type { CardInstance } from "../domain/types";

interface PlayerHandProps {
  cards: readonly CardInstance[];
  selectedUid?: string;
  enabled: boolean;
  onSelect: (uid: string) => void;
}

const KIND_LABELS = {
  attack: "进攻",
  guard: "防御",
  restore: "回复",
  tactic: "战术",
} as const;

export function PlayerHand({ cards, selectedUid, enabled, onSelect }: PlayerHandProps) {
  if (cards.length === 0) {
    return <p className="empty-hand">手中没有牌，可以暂缓行动。</p>;
  }

  return (
    <div className="player-hand" role="list" aria-label="你的手牌">
      {cards.map((instance) => {
        const card = getCard(instance);
        return (
          <CardFrame
            key={instance.uid}
            eyebrow={KIND_LABELS[card.kind]}
            title={card.name}
            symbol={card.symbol}
            tone={card.tone}
            selected={selectedUid === instance.uid}
            disabled={!enabled}
            onClick={() => onSelect(instance.uid)}
            className={`battle-card battle-card--${card.kind}`}
          >
            {card.description}
          </CardFrame>
        );
      })}
    </div>
  );
}
