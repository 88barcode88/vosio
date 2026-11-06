// Tiny DOM builder for the popup/options pages (textContent only, so untrusted titles can never inject markup).

export interface ElementProps {
  class?: string;
  text?: string;
  type?: string;
  href?: string;
  target?: string;
  title?: string;
  disabled?: boolean;
  checked?: boolean;
  value?: string;
  placeholder?: string;
  id?: string;
  onclick?: (event: Event) => void;
  onchange?: (event: Event) => void;
}

// Creates an element with the given props and children (strings become text nodes, null/false are skipped).
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: ElementProps = {}, ...children: Array<Node | string | null | false>): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  const { class: className, text, onclick, onchange, ...rest } = props;
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    if (key === "disabled" || key === "checked") (element as unknown as Record<string, unknown>)[key] = value;
    else if (key === "value") (element as unknown as { value: string }).value = String(value);
    else element.setAttribute(key, String(value));
  }
  if (onclick) element.addEventListener("click", onclick);
  if (onchange) element.addEventListener("change", onchange);
  for (const child of children) {
    if (child === null || child === false) continue;
    element.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return element;
}

// Replaces all children of a container.
export function mount(container: HTMLElement, ...children: Node[]): void {
  container.replaceChildren(...children);
}
