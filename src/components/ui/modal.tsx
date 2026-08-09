"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from "react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
};

const focusableSelector = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[tabindex]",
  "[contenteditable='true']"
].join(",");

const dialogOpeners = new WeakMap<HTMLElement, HTMLElement | null>();

// hasHiddenAncestor checks visibility through the candidate's dialog boundary without relying on layout rects.
function hasHiddenAncestor(element: HTMLElement, surface: HTMLElement) {
  let current: HTMLElement | null = element;

  while (current) {
    if (current.matches("[hidden], [inert], [aria-hidden='true']")) return true;

    const computedStyle = window.getComputedStyle(current);
    if (computedStyle.display === "none" || ["hidden", "collapse"].includes(computedStyle.visibility)) {
      return true;
    }

    if (current === surface) return false;
    current = current.parentElement;
  }

  return false;
}

// hasClosedDetailsAncestor excludes closed details content while preserving that details element's first summary.
function hasClosedDetailsAncestor(element: HTMLElement, surface: HTMLElement) {
  let current: HTMLElement | null = element.parentElement;

  while (current) {
    if (current.tagName === "DETAILS" && !current.hasAttribute("open")) {
      const firstSummary = Array.from(current.children).find((child) => child.tagName === "SUMMARY");
      if (element !== firstSummary) return true;
    }

    if (current === surface) return false;
    current = current.parentElement;
  }

  return false;
}

// belongsToDialog keeps an outer trap from treating controls in nested modal dialogs as its own.
function belongsToDialog(element: HTMLElement, surface: HTMLElement) {
  return element.closest<HTMLElement>("[role='dialog'][aria-modal='true']") === surface;
}

// isNamedRadio identifies radio controls whose mutual exclusion changes their tab-stop behavior.
function isNamedRadio(element: HTMLElement): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.type === "radio" && element.name !== "";
}

// normalizeRadioGroups retains the checked eligible radio, or the first eligible radio when none is checked.
function normalizeRadioGroups(elements: HTMLElement[]) {
  const groupsByForm = new Map<HTMLFormElement | null, Map<string, HTMLInputElement[]>>();
  const retainedRadios = new Set<HTMLInputElement>();

  for (const element of elements) {
    if (!isNamedRadio(element)) continue;

    const groupsByName = groupsByForm.get(element.form) ?? new Map<string, HTMLInputElement[]>();
    const group = groupsByName.get(element.name) ?? [];
    group.push(element);
    groupsByName.set(element.name, group);
    groupsByForm.set(element.form, groupsByName);
  }

  for (const groupsByName of groupsByForm.values()) {
    for (const group of groupsByName.values()) {
      retainedRadios.add(group.find((radio) => radio.checked) ?? group[0]);
    }
  }

  return elements.filter((element) => !isNamedRadio(element) || retainedRadios.has(element));
}

// isTabbableElement keeps only visible, semantically enabled destinations in a dialog's tab order.
function isTabbableElement(element: HTMLElement, surface: HTMLElement) {
  if (element.tabIndex < 0 || element.matches(":disabled, input[type='hidden']")) return false;
  if (!belongsToDialog(element, surface) || hasHiddenAncestor(element, surface)) return false;
  if (hasClosedDetailsAncestor(element, surface)) return false;

  return true;
}

// getFocusableElements finds enabled keyboard destinations that belong directly to one dialog surface.
function getFocusableElements(surface: HTMLElement) {
  const candidates = Array.from(surface.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => isTabbableElement(element, surface)
  );
  return normalizeRadioGroups(candidates);
}

// focusDialogSurface gives a dialog's own first destination focus, with a surface fallback for empty dialogs.
function focusDialogSurface(surface: HTMLElement) {
  (getFocusableElements(surface)[0] ?? surface).focus();
}

// hasOpenNestedDialog lets the innermost currently rendered modal own initial focus.
function hasOpenNestedDialog(surface: HTMLElement) {
  return surface.querySelector("[role='dialog'][aria-modal='true']") !== null;
}

// getNestedDialog finds a nested open dialog so an outer surface can preserve its external opener.
function getNestedDialog(surface: HTMLElement) {
  return surface.querySelector<HTMLElement>("[role='dialog'][aria-modal='true']");
}

// getAncestorDialog returns the closest still-connected dialog that can receive focus after an inner closes.
function getAncestorDialog(surface: HTMLElement) {
  const ancestor = surface.parentElement?.closest<HTMLElement>("[role='dialog'][aria-modal='true']");
  return ancestor?.isConnected ? ancestor : null;
}

// isUsableDialogOpener preserves a still-available direct outer control after a sequential inner dialog closes.
function isUsableDialogOpener(opener: HTMLElement | null, ancestorDialog: HTMLElement): opener is HTMLElement {
  return opener?.isConnected === true
    && belongsToDialog(opener, ancestorDialog)
    && isTabbableElement(opener, ancestorDialog);
}

// useDialogFocusTrap manages focus ownership shared by the modal and drawer surfaces.
export function useDialogFocusTrap(open: boolean, onClose: () => void) {
  // openerAtOpen captures the active owner during render before a newly mounted child can claim autoFocus.
  const openerAtOpen = useMemo(() => (
    open && typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  ), [open]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const openerRef = useRef<HTMLElement | null>(openerAtOpen);
  const hasCapturedOpenerRef = useRef(openerAtOpen !== null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open) {
      hasCapturedOpenerRef.current = false;
      openerRef.current = null;
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) return;

    const ancestorDialog = getAncestorDialog(dialog);
    if (!hasCapturedOpenerRef.current) {
      const nestedDialog = getNestedDialog(dialog);
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      openerRef.current = openerAtOpen ?? (nestedDialog ? (dialogOpeners.get(nestedDialog) ?? activeElement) : activeElement);
      hasCapturedOpenerRef.current = true;
    }
    dialogOpeners.set(dialog, openerRef.current);
    if (!hasOpenNestedDialog(dialog)) focusDialogSurface(dialog);

    return () => {
      dialogOpeners.delete(dialog);

      if (ancestorDialog?.isConnected) {
        const opener = openerRef.current;
        if (isUsableDialogOpener(opener, ancestorDialog)) {
          opener.focus();
        } else {
          focusDialogSurface(ancestorDialog);
        }
      } else if (openerRef.current?.isConnected) {
        openerRef.current.focus();
      }
    };
  }, [open, openerAtOpen]);

  // handleKeyDown owns Escape and cycles Tab navigation within its current dialog surface.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
      return;
    }

    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusableElements = getFocusableElements(dialog);
    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusableElements[0];
    const last = focusableElements.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { dialogRef, handleKeyDown };
}

// Modal renders a labelled, focus-managed dialog above a dismissible backdrop.
export function Modal({ open, onClose, label, children, className }: ModalProps) {
  const { dialogRef, handleKeyDown } = useDialogFocusTrap(open, onClose);

  if (!open) return null;

  return (
    <div className="ui-modal-backdrop" onPointerDown={onClose} onKeyDown={handleKeyDown}>
      <div
        ref={dialogRef}
        className={["ui-modal", className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
