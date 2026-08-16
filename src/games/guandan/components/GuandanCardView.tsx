import type { GuandanCard, NumberRank, Suit } from "../domain/types";
import { isWild } from "../domain/engine";

const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  joker: "王",
};

interface GuandanCardViewProps {
  card: GuandanCard;
  levelRank: NumberRank;
  selected?: boolean;
  selectable?: boolean;
  compact?: boolean;
  onSelect?: (id: string) => void;
}

export function GuandanCardView({
  card,
  levelRank,
  selected = false,
  selectable = false,
  compact = false,
  onSelect,
}: GuandanCardViewProps) {
  const wild = isWild(card, levelRank);
  const rank = card.rank === "small-joker" ? "小" : card.rank === "big-joker" ? "大" : card.rank;
  const symbol = SUIT_SYMBOLS[card.suit];
  const className = [
    "gd-card",
    `gd-card--${card.suit}`,
    `gd-card--${card.rank}`,
    selected ? "is-selected" : "",
    compact ? "is-compact" : "",
    wild ? "is-wild" : "",
  ].filter(Boolean).join(" ");

  if (selectable) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => onSelect?.(card.id)}
        aria-pressed={selected}
        aria-label={`${card.name}${wild ? "，百搭级牌" : ""}`}
      >
        <CardFace rank={rank} symbol={symbol} wild={wild} deckIndex={card.deckIndex} />
      </button>
    );
  }

  return (
    <span className={className} role="img" aria-label={card.name}>
      <CardFace rank={rank} symbol={symbol} wild={wild} deckIndex={card.deckIndex} />
    </span>
  );
}

function CardFace({
  rank,
  symbol,
  wild,
  deckIndex,
}: {
  rank: string;
  symbol: string;
  wild: boolean;
  deckIndex: 0 | 1;
}) {
  return (
    <>
      <span className="gd-card__rank">{rank}</span>
      <span className="gd-card__suit" aria-hidden="true">{symbol}</span>
      <span className="gd-card__pip" aria-hidden="true">{symbol}</span>
      {wild && <span className="gd-card__wild">配</span>}
      <i className={`gd-card__deck-dot gd-card__deck-dot--${deckIndex}`} aria-hidden="true" />
    </>
  );
}
