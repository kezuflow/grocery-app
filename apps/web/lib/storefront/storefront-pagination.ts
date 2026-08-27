import type { PresentationProduct } from "./catalog-presentation";

/** Merge a follow-up page onto what is already shown, dropping duplicate ids. */
export function appendUniqueProducts(
  current: ReadonlyArray<PresentationProduct>,
  incoming: ReadonlyArray<PresentationProduct>,
): PresentationProduct[] {
  const seen = new Set(current.map((product) => product.id));
  const merged = [...current];
  for (const product of incoming) {
    if (!seen.has(product.id)) {
      seen.add(product.id);
      merged.push(product);
    }
  }
  return merged;
}

export function loadMoreAnnouncement({
  added,
  totalShown,
}: {
  added: number;
  totalShown: number;
}): string {
  return added > 0
    ? `Loaded ${added} more products. Showing ${totalShown} in total.`
    : `No more products were added. Showing ${totalShown} in total.`;
}
