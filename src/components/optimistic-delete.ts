// markNearestOptimisticDeleteTarget immediately hides a deleted UI row while the server action finishes.
export function markNearestOptimisticDeleteTarget(element: Element, selector: string) {
  const target = element.closest(selector);

  if (target instanceof HTMLElement) {
    target.dataset.optimisticDeleted = "true";
  }
}
