"use client";

import { useCallback, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

type DisclosureProps = {
  label: string;
  triggerLabel: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  disabled?: boolean;
  keepMounted?: boolean;
  onOpenChange?: (open: boolean) => void;
};

// Disclosure exposes inline details without treating ordinary page clicks as a dismissal signal.
export function Disclosure({
  label,
  triggerLabel,
  children,
  className,
  defaultOpen = false,
  disabled = false,
  keepMounted = false,
  onOpenChange
}: DisclosureProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // changeOpenFromUser keeps the callback reserved for direct user interactions.
  const changeOpenFromUser = useCallback((nextOpen: boolean) => {
    setIsOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange]);

  // handleTriggerClick toggles the inline details from the native button.
  const handleTriggerClick = () => changeOpenFromUser(!isOpen);

  // handleKeyDown closes only this open inline disclosure and keeps Escape from bubbling outward.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isOpen || event.key !== "Escape") return;

    event.preventDefault();
    event.stopPropagation();
    changeOpenFromUser(false);
    triggerRef.current?.focus();
  };

  return (
    <div className={["ui-disclosure", className].filter(Boolean).join(" ")} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="ui-disclosure-trigger"
        aria-expanded={isOpen}
        aria-controls={panelId}
        disabled={disabled}
        onClick={handleTriggerClick}
      >
        {triggerLabel}
      </button>
      {isOpen || keepMounted ? (
        <div
          aria-hidden={!isOpen || undefined}
          aria-label={label}
          className="ui-disclosure-panel"
          hidden={!isOpen}
          id={panelId}
          role="region"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
