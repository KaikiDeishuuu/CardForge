import type { CSSProperties, ReactNode } from "react";

interface CardFrameProps {
  eyebrow?: string;
  title: string;
  symbol?: ReactNode;
  children?: ReactNode;
  tone?: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

export function CardFrame({
  eyebrow,
  title,
  symbol,
  children,
  tone = "#b84b3d",
  selected = false,
  disabled = false,
  onClick,
  className = "",
}: CardFrameProps) {
  const style = { "--card-tone": tone } as CSSProperties;

  return (
    <button
      type="button"
      className={`card-frame ${selected ? "is-selected" : ""} ${className}`}
      style={style}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
    >
      <span className="card-frame__topline">
        <span>{eyebrow}</span>
        <span className="card-frame__pip" aria-hidden="true" />
      </span>
      <span className="card-frame__symbol" aria-hidden="true">{symbol}</span>
      <strong className="card-frame__title">{title}</strong>
      <span className="card-frame__body">{children}</span>
    </button>
  );
}
