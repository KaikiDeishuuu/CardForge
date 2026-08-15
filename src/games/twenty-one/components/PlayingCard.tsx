import type { CSSProperties } from "react";
import type { PlayingCard as PlayingCardData, Suit } from "../domain/types";

const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

interface PlayingCardProps {
  card: PlayingCardData;
  hidden?: boolean;
  fresh?: boolean;
  revealed?: boolean;
  index: number;
}

export function PlayingCard({ card, hidden = false, fresh = false, revealed = false, index }: PlayingCardProps) {
  const symbol = SUIT_SYMBOLS[card.suit];
  const style = { "--card-index": index } as CSSProperties;

  return (
    <div
      className={`tw-card tw-card--${card.suit} ${hidden ? "is-hidden" : ""} ${fresh ? "is-fresh" : ""} ${revealed ? "is-revealed" : ""}`}
      style={style}
      role="img"
      aria-label={hidden ? "庄家的暗牌" : card.name}
    >
      {hidden ? (
        <>
          <span className="tw-card__back-mark" aria-hidden="true"><i /><i /><b>21</b></span>
          <span className="tw-card__back-label">CARDFORGE</span>
        </>
      ) : (
        <>
          <span className="tw-card__corner"><strong>{card.rank}</strong><i>{symbol}</i></span>
          <span className="tw-card__suit" aria-hidden="true">{symbol}</span>
          <span className="tw-card__corner tw-card__corner--bottom"><strong>{card.rank}</strong><i>{symbol}</i></span>
        </>
      )}
    </div>
  );
}
