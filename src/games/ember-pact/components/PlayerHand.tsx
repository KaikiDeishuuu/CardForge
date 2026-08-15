import { CardFrame } from "../../../shared/cards/CardFrame";
import { getCard } from "../domain/engine";
import type { CardInstance } from "../domain/types";

interface PlayerHandProps {
  cards: readonly CardInstance[];
  selectedUid?: string;
  enabled: boolean;
  playableUids?: readonly string[];
  onSelect: (uid: string) => void;
}

const KIND_LABELS = {
  attack: "进攻",
  guard: "防御",
  restore: "回复",
  tactic: "战术",
} as const;

export function PlayerHand({ cards, selectedUid, enabled, playableUids, onSelect }: PlayerHandProps) {
  if (cards.length === 0) {
    return <p className="empty-hand">手中没有牌，可以结束当前行动。</p>;
  }

  return (
    <div className="player-hand" role="list" aria-label="你的手牌">
      {cards.map((instance) => {
        const card = getCard(instance);
        const playable = enabled && (playableUids === undefined || playableUids.includes(instance.uid));
        return (
          <div key={instance.uid} className="player-hand__item" role="listitem">
            <CardFrame
              eyebrow={KIND_LABELS[card.kind]}
              title={card.name}
              symbol={card.symbol}
              tone={card.tone}
              selected={selectedUid === instance.uid}
              disabled={!enabled}
              ariaDisabled={enabled && !playable}
              onClick={() => onSelect(instance.uid)}
              className={`battle-card battle-card--${card.kind}`}
            >
              <span className="battle-card__description">{card.description}</span>
              <span className="battle-card__facts">
                <span><b>{card.cost}</b><small>行动力</small></span>
                {card.responsePower !== undefined && (
                  <span className="is-response"><small>响应</small><b>{card.responsePower}</b></span>
                )}
              </span>
            </CardFrame>
          </div>
        );
      })}
    </div>
  );
}
