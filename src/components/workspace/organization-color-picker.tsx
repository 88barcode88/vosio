"use client";

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from "react";

type OrganizationColorPickerProps = {
  label: string;
  onChange: (value: string) => void;
  value: string;
};

const organizationColorSwatches = [
  { label: "Námořnická", value: "#224466" },
  { label: "Tyrkysová", value: "#0F766E" },
  { label: "Modrá", value: "#2563EB" },
  { label: "Fialová", value: "#7C3AED" },
  { label: "Růžová", value: "#BE123C" },
  { label: "Oranžová", value: "#C2410C" }
] as const;

// OrganizationColorPicker exposes a controlled palette without relying on the platform color input.
export function OrganizationColorPicker({ label, onChange, value }: OrganizationColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customColor, setCustomColor] = useState(value);
  const [hasCustomColorError, setHasCustomColorError] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverId = useId();
  const customColorId = useId();
  const customColorErrorId = useId();

  // closePicker optionally restores focus after a keyboard or explicit picker action.
  const closePicker = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    // closeOnOutsidePointer leaves the native pointer target and its focus behavior untouched.
    function closeOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        closePicker();
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [closePicker, isOpen]);

  // closeOnEscape owns Escape before the surrounding editor or disclosure can dismiss itself.
  function closeOnEscape(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!isOpen || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closePicker(true);
  }

  // togglePicker refreshes the local HEX draft from the controlled value whenever it opens.
  function togglePicker() {
    if (isOpen) {
      closePicker();
      return;
    }
    setCustomColor(value);
    setHasCustomColorError(false);
    setIsOpen(true);
  }

  // applyCustomColor commits only a complete CSS hexadecimal color and otherwise keeps the picker open.
  function applyCustomColor() {
    const nextColor = customColor.trim();
    if (!/^#[0-9A-Fa-f]{6}$/u.test(nextColor)) {
      setHasCustomColorError(true);
      return;
    }
    onChange(nextColor);
    setHasCustomColorError(false);
    closePicker(true);
  }

  return (
    <div className="organization-color-picker" onKeyDownCapture={closeOnEscape} ref={containerRef}>
      <button
        aria-controls={popoverId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`Vybrat barvu ${label}`}
        className="organization-color-picker-trigger"
        onClick={togglePicker}
        ref={triggerRef}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`organization-color-preview${value ? " is-colored" : ""}`}
          style={value ? ({ "--organization-picker-color": value } as CSSProperties) : undefined}
        />
        {value ? "Změnit barvu" : "Vybrat barvu"}
      </button>
      {isOpen ? (
        <div aria-label={`Barva ${label}`} className="organization-color-popover" id={popoverId} role="dialog">
          <strong>Barva</strong>
          <div className="organization-color-swatches">
            {organizationColorSwatches.map((swatch) => (
              <button
                aria-label={`${swatch.label} (${swatch.value})`}
                aria-pressed={value.toUpperCase() === swatch.value}
                key={swatch.value}
                onClick={() => {
                  onChange(swatch.value);
                  closePicker(true);
                }}
                style={{ "--organization-picker-color": swatch.value } as CSSProperties}
                type="button"
              >
                <span aria-hidden="true" />
                {swatch.label}
              </button>
            ))}
          </div>
          <div className="organization-custom-color">
            <label htmlFor={customColorId}>Vlastní HEX barva</label>
            <div>
              <input
                aria-describedby={hasCustomColorError ? customColorErrorId : undefined}
                aria-invalid={hasCustomColorError}
                aria-label="Vlastní HEX barva"
                autoComplete="off"
                id={customColorId}
                onChange={(event) => {
                  setCustomColor(event.target.value);
                  setHasCustomColorError(false);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  applyCustomColor();
                }}
                placeholder="#RRGGBB"
                spellCheck={false}
                type="text"
                value={customColor}
              />
              <button onClick={applyCustomColor} type="button">Použít</button>
            </div>
            {hasCustomColorError ? (
              <p id={customColorErrorId} role="alert">Zadejte barvu ve formátu #RRGGBB.</p>
            ) : null}
          </div>
          <button
            aria-pressed={value === ""}
            className="organization-color-neutral"
            onClick={() => {
              onChange("");
              closePicker(true);
            }}
            type="button"
          >
            Bez barvy
          </button>
        </div>
      ) : null}
    </div>
  );
}
