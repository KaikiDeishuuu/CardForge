import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface ModalFocusOptions {
  active: boolean;
  initialFocus?: string;
  onDismiss?: () => void;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.getClientRects().length > 0);
}

export function useModalFocus({ active, initialFocus, onDismiss }: ModalFocusOptions) {
  const modalRef = useRef<HTMLDivElement>(null);
  const onDismissRef = useRef(onDismiss);

  // Kept current after commit rather than during render: the keydown listener
  // below only reads it while handling an event, which is always later.
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!active || !modalRef.current) return;

    const modal = modalRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
    const preferred = initialFocus
      ? modal.querySelector<HTMLElement>(initialFocus)
      : undefined;
    (preferred ?? getFocusableElements(modal)[0] ?? modal).focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && onDismissRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onDismissRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(modal);
      if (focusable.length === 0) {
        event.preventDefault();
        modal.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1)!;
      const current = document.activeElement;

      if (event.shiftKey && (current === first || !modal.contains(current))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [active, initialFocus]);

  return modalRef;
}
