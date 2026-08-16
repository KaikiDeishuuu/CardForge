import { useId, type ReactNode } from "react";
import { useModalFocus } from "./useModalFocus";
import "./GameShell.css";

export interface GameToolAction {
  id: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  disabled?: boolean;
  pressed?: boolean;
  tone?: "default" | "danger";
  onSelect: () => void;
}

export interface GameShellProps {
  children: ReactNode;
  topBar: ReactNode;
  status?: ReactNode;
  actionDock?: ReactNode;
  overlay?: ReactNode;
  overlayActive?: boolean;
  statusAriaLive?: "off" | "polite" | "assertive";
  contentLabel?: string;
  contentRole?: "main" | "region";
  className?: string;
  contentClassName?: string;
  actionDockClassName?: string;
  actionDockLabel?: string;
}

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/**
 * A viewport-bound game layout. When an overlay is active the complete game
 * surface becomes inert while the overlay remains independently interactive.
 */
export function GameShell({
  children,
  topBar,
  status,
  actionDock,
  overlay,
  overlayActive = false,
  statusAriaLive = "polite",
  contentLabel,
  contentRole,
  className,
  contentClassName,
  actionDockClassName,
  actionDockLabel = "牌局操作",
}: GameShellProps) {
  return (
    <div className={classes("cf-game-shell", className)} data-overlay-active={overlayActive || undefined}>
      <div className="cf-game-shell__surface" inert={overlayActive || undefined}>
        {topBar}
        {status !== undefined && status !== null && (
          <div className="cf-game-shell__status" role="status" aria-live={statusAriaLive}>
            {status}
          </div>
        )}
        <main
          className={classes("cf-game-shell__content", contentClassName)}
          aria-label={contentLabel}
          role={contentRole}
        >
          {children}
        </main>
        {actionDock !== undefined && actionDock !== null && (
          <ActionDock className={actionDockClassName} label={actionDockLabel}>
            {actionDock}
          </ActionDock>
        )}
      </div>
      {overlay}
    </div>
  );
}

export interface ActionDockProps {
  children: ReactNode;
  label?: string;
  className?: string;
}

/** A persistent, safe-area-aware container for the current turn actions. */
export function ActionDock({ children, label = "牌局操作", className }: ActionDockProps) {
  return (
    <section className={classes("cf-game-shell__action-dock", className)} aria-label={label}>
      {children}
    </section>
  );
}

export interface GameTopBarProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack: () => void;
  backLabel?: string;
  actions?: readonly GameToolAction[];
  onMore?: () => void;
  moreOpen?: boolean;
  moreLabel?: string;
  className?: string;
}

function ActionIcon({ icon }: { icon?: ReactNode }) {
  return icon === undefined || icon === null
    ? null
    : <span className="cf-game-topbar__action-icon" aria-hidden="true">{icon}</span>;
}

/** A compact back/title/more header with optional desktop shortcuts. */
export function GameTopBar({
  title,
  subtitle,
  onBack,
  backLabel = "返回大厅",
  actions = [],
  onMore,
  moreOpen = false,
  moreLabel = "更多选项",
  className,
}: GameTopBarProps) {
  return (
    <header className={classes("cf-game-topbar", className)}>
      <button type="button" className="cf-game-topbar__back" onClick={onBack} aria-label={backLabel}>
        <span className="cf-game-topbar__back-icon" aria-hidden="true">←</span>
        <span className="cf-game-topbar__back-label">{backLabel}</span>
      </button>

      <div className="cf-game-topbar__heading">
        <h1>{title}</h1>
        {subtitle !== undefined && subtitle !== null && <p>{subtitle}</p>}
      </div>

      <div className="cf-game-topbar__tools">
        {actions.length > 0 && (
          <div className="cf-game-topbar__actions" aria-label="常用工具">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                className={classes("cf-game-topbar__action", action.tone === "danger" && "is-danger")}
                onClick={action.onSelect}
                disabled={action.disabled}
                aria-pressed={action.pressed}
              >
                <ActionIcon icon={action.icon} />
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        )}
        {onMore ? (
          <button
            type="button"
            className="cf-game-topbar__more"
            onClick={onMore}
            aria-label={moreLabel}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
          >
            <span aria-hidden="true">•••</span>
          </button>
        ) : (
          <span className="cf-game-topbar__more-placeholder" aria-hidden="true" />
        )}
      </div>
    </header>
  );
}

export interface ToolMenuProps {
  open: boolean;
  onClose: () => void;
  actions?: readonly GameToolAction[];
  title?: string;
  closeLabel?: string;
  children?: ReactNode;
  className?: string;
}

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  footer?: ReactNode;
  initialFocus?: string;
  restoreFocus?: string;
  role?: "dialog" | "alertdialog";
  closeLabel?: string;
  dismissOnBackdrop?: boolean;
  className?: string;
  backdropClassName?: string;
}

/** A generic modal dialog. Pair it with GameShell's overlayActive prop. */
export function Dialog({
  open,
  title,
  children,
  onClose,
  footer,
  initialFocus = "[data-cf-dialog-initial], button:not(.cf-dialog__close)",
  restoreFocus,
  role = "dialog",
  closeLabel = "关闭对话框",
  dismissOnBackdrop = true,
  className,
  backdropClassName,
}: DialogProps) {
  const headingId = useId();
  const dialogRef = useModalFocus({ active: open, initialFocus, onDismiss: onClose, restoreFocus });

  if (!open) return null;

  return (
    <div
      className={classes("cf-dialog-backdrop", backdropClassName)}
      onMouseDown={(event) => {
        if (dismissOnBackdrop && onClose && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={classes("cf-dialog", className)}
        role={role}
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <div className="cf-dialog__header">
          <h2 id={headingId} tabIndex={-1}>{title}</h2>
          {onClose && (
            <button type="button" className="cf-dialog__close" onClick={onClose} aria-label={closeLabel}>
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
        <div className="cf-dialog__body">{children}</div>
        {footer !== undefined && footer !== null && <div className="cf-dialog__footer">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Responsive More menu: a bottom sheet on small screens and a compact dialog
 * on larger screens. Selection dismisses the menu after invoking the action.
 */
export function ToolMenu({
  open,
  onClose,
  actions = [],
  title = "更多选项",
  closeLabel = "关闭更多选项",
  children,
  className,
}: ToolMenuProps) {
  const headingId = useId();
  const initialActionIndex = actions.findIndex((action) => !action.disabled);
  const menuRef = useModalFocus({
    active: open,
    initialFocus: "[data-cf-tool-menu-initial]",
    onDismiss: onClose,
  });

  if (!open) return null;

  return (
    <div
      className="cf-tool-menu-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={menuRef}
        className={classes("cf-tool-menu", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <div className="cf-tool-menu__header">
          <h2 id={headingId}>{title}</h2>
          <button
            type="button"
            className="cf-tool-menu__close"
            onClick={onClose}
            aria-label={closeLabel}
            data-cf-tool-menu-initial={initialActionIndex === -1 ? "" : undefined}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {actions.length > 0 && (
          <div className="cf-tool-menu__actions">
            {actions.map((action, index) => (
              <button
                key={action.id}
                type="button"
                className={classes("cf-tool-menu__action", action.tone === "danger" && "is-danger")}
                onClick={() => {
                  action.onSelect();
                  onClose();
                }}
                disabled={action.disabled}
                aria-pressed={action.pressed}
                data-cf-tool-menu-initial={index === initialActionIndex ? "" : undefined}
              >
                <ActionIcon icon={action.icon} />
                <span className="cf-tool-menu__action-copy">
                  <strong>{action.label}</strong>
                  {action.description && <small>{action.description}</small>}
                </span>
              </button>
            ))}
          </div>
        )}
        {children !== undefined && children !== null && <div className="cf-tool-menu__body">{children}</div>}
      </div>
    </div>
  );
}
