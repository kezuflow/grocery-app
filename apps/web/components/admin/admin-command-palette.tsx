"use client";

import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { groupAdminNavigation, type AdminNavigationEntry } from "./admin-navigation";

/**
 * Keyboard palette (Ctrl/Cmd+K) over the authorized workspaces. It only
 * navigates; it never widens access — the item list is the same
 * capability-filtered navigation Core supplied to the shell.
 */
export function AdminCommandPalette({
  items,
  open,
  onOpenChange,
}: {
  items: ReadonlyArray<AdminNavigationEntry>;
  open: boolean;
  onOpenChange(next: boolean): void;
}) {
  const router = useRouter();
  const groups = groupAdminNavigation(items);

  function select(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-[rgb(15_23_42_/_0.4)] duration-(--fm-motion-base) ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        />
        <DialogPrimitive.Content
          aria-label="Admin command palette"
          className="fixed left-1/2 top-[20%] z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-[var(--fm-radius-overlay)] border border-[var(--fm-border)] bg-[var(--fm-background)] text-[var(--fm-text)] shadow-[var(--fm-shadow-overlay)] duration-(--fm-motion-base) ease-out focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          <DialogPrimitive.Title className="sr-only">Admin command palette</DialogPrimitive.Title>
          <CommandPrimitive label="Admin command palette" className="flex flex-col">
            <div className="flex h-12 items-center gap-2.5 border-b border-[var(--fm-border)] px-4">
              <Search className="size-4 shrink-0 text-[var(--fm-text-muted)]" aria-hidden="true" />
              <CommandPrimitive.Input
                autoFocus
                placeholder="Search workspaces..."
                className="h-full w-full bg-transparent text-sm text-[var(--fm-text)] outline-none placeholder:text-[var(--fm-text-muted)]"
              />
            </div>
            <CommandPrimitive.List className="max-h-80 overflow-y-auto overflow-x-hidden p-1">
              <CommandPrimitive.Empty className="px-3 py-6 text-center text-sm text-[var(--fm-text-muted)]">
                No matching workspaces.
              </CommandPrimitive.Empty>
              {groups.map((group) => (
                <CommandPrimitive.Group
                  key={group.code}
                  heading={group.label}
                  className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-[var(--fm-text-muted)]"
                >
                  {group.items.flatMap((item) => [item, ...item.children]).map((entry) => (
                    <CommandPrimitive.Item
                      key={entry.code}
                      value={entry.label}
                      onSelect={() => select(entry.href)}
                      className="flex min-h-9 cursor-default items-center gap-2.5 rounded-[var(--fm-radius-control)] px-2.5 text-sm text-[var(--fm-text)] data-[selected=true]:bg-[var(--fm-hover)] data-[selected=true]:outline-none"
                    >
                      <entry.icon className="size-4 shrink-0 text-[var(--fm-text-muted)]" aria-hidden="true" />
                      {entry.label}
                    </CommandPrimitive.Item>
                  ))}
                </CommandPrimitive.Group>
              ))}
            </CommandPrimitive.List>
          </CommandPrimitive>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
