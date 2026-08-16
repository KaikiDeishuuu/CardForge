import type { TexasCard, TexasSuit } from "../domain/types";

const SUIT_MARKS: Readonly<Record<TexasSuit, string>> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

function classes(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export interface PokerCardViewProps {
  readonly card?: TexasCard;
  readonly concealed?: boolean;
  readonly placeholder?: boolean;
  readonly compact?: boolean;
  readonly emphasized?: boolean;
  readonly className?: string;
}

/** A non-interactive, fixed-ratio card face that never exposes concealed card data. */
export function PokerCardView({
  card,
  concealed = false,
  placeholder = false,
  compact = false,
  emphasized = false,
  className,
}: PokerCardViewProps) {
  if (placeholder || (!card && !concealed)) {
    return <span className={classes("poker-card", "poker-card--placeholder", compact && "is-compact", className)} aria-hidden="true" />;
  }

  if (concealed) {
    return (
      <span
        className={classes("poker-card", "poker-card--back", compact && "is-compact", className)}
        role="img"
        aria-label="一张未公开的底牌"
      >
        <span aria-hidden="true">CF</span>
      </span>
    );
  }

  if (!card) return null;
  const mark = SUIT_MARKS[card.suit];
  const red = card.suit === "hearts" || card.suit === "diamonds";
  return (
    <span
      className={classes(
        "poker-card",
        "poker-card--face",
        red && "is-red",
        compact && "is-compact",
        emphasized && "is-emphasized",
        className,
      )}
      role="img"
      aria-label={card.name}
      data-card-id={card.id}
    >
      <span className="poker-card__corner" aria-hidden="true">
        <b>{card.rank}</b>
        <i>{mark}</i>
      </span>
      <span className="poker-card__suit" aria-hidden="true">{mark}</span>
    </span>
  );
}
