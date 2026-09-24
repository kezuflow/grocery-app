/** Browser-only UI protection while an Admin command is pending or unresolved. */
const activeCommands = new Set<object>();

export function setAdminScopeCommandLock(owner: object, locked: boolean): void {
  if (locked) activeCommands.add(owner);
  else activeCommands.delete(owner);
}

export function hasAdminScopeCommandLock(): boolean {
  return activeCommands.size > 0;
}
