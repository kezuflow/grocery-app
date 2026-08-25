// Canonical subscription state machine per docs/architecture/STATE_MACHINES.md.
// CANCELED and EXPIRED are terminal and have no outgoing transitions.

export const subscriptionLifecycleStates = [
  "PENDING",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "PAUSED",
  "CANCELED",
  "EXPIRED",
] as const;

export type SubscriptionLifecycleState = (typeof subscriptionLifecycleStates)[number];

const transitions: Readonly<
  Record<SubscriptionLifecycleState, readonly SubscriptionLifecycleState[]>
> = {
  PENDING: ["TRIALING", "ACTIVE", "CANCELED", "EXPIRED"],
  TRIALING: ["ACTIVE", "CANCELED", "EXPIRED"],
  ACTIVE: ["PAST_DUE", "PAUSED", "CANCELED", "EXPIRED"],
  PAST_DUE: ["ACTIVE", "PAUSED", "CANCELED", "EXPIRED"],
  PAUSED: ["ACTIVE", "CANCELED", "EXPIRED"],
  CANCELED: [],
  EXPIRED: [],
};

export class IllegalSubscriptionTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`ILLEGAL_TRANSITION: ${from} -> ${to}`);
    this.name = "IllegalSubscriptionTransitionError";
  }
}

export function canTransitionSubscription(
  from: SubscriptionLifecycleState,
  to: SubscriptionLifecycleState,
): boolean {
  return transitions[from].includes(to);
}

export function transitionSubscription(
  from: SubscriptionLifecycleState,
  to: SubscriptionLifecycleState,
): SubscriptionLifecycleState {
  if (!canTransitionSubscription(from, to)) throw new IllegalSubscriptionTransitionError(from, to);
  return to;
}

/**
 * Shortest legal path between lifecycle states, used by reconciliation-style
 * commands; returns null when no legal route exists.
 */
export function findSubscriptionTransitionPath(
  from: SubscriptionLifecycleState,
  to: SubscriptionLifecycleState,
): SubscriptionLifecycleState[] | null {
  if (from === to) return [];
  const queue: SubscriptionLifecycleState[][] = [[from]];
  const visited = new Set<SubscriptionLifecycleState>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1];
    for (const next of transitions[last]) {
      if (next === to) return [...path, next];
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return null;
}
