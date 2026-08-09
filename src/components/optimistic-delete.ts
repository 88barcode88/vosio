// markNearestOptimisticDeleteTarget immediately hides a deleted UI row while the server action finishes.
export function markNearestOptimisticDeleteTarget(element: Element, selector: string) {
  const target = element.closest(selector);

  if (target instanceof HTMLElement) {
    target.dataset.optimisticDeleted = "true";
    return target;
  }

  return null;
}

// restoreOptimisticDeleteTarget reveals one exact card after a failed destructive action.
export function restoreOptimisticDeleteTarget(target: HTMLElement | null) {
  target?.removeAttribute("data-optimistic-deleted");
}
