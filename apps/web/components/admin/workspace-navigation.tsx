"use client";

import { usePathname } from "next/navigation";
import type { AdminNavigationItem } from "@freshmarkets/contracts";
import { useAdminContext } from "../../app/admin/admin-context-provider";
import { SettingsTabs, type SettingsTab } from "./admin-compositions";

export function workspaceTabsFromNavigation(
  navigation: ReadonlyArray<AdminNavigationItem>,
  parentCode: string,
  pathname: string,
): { activeId: string; tabs: SettingsTab[] } {
  const candidates = navigation.filter(
    (item) => item.code === parentCode || item.parentCode === parentCode,
  );
  const tabs: SettingsTab[] = [];
  for (const item of candidates) {
    const tab = { id: item.code, label: item.label, href: item.href };
    const duplicateIndex = tabs.findIndex((candidate) => candidate.href === tab.href);
    if (duplicateIndex >= 0) {
      if (item.kind === "destination") tabs[duplicateIndex] = tab;
    } else {
      tabs.push(tab);
    }
  }
  const active = [...tabs]
    .filter(
      (tab) =>
        pathname === tab.href || (tab.href !== "/admin" && pathname.startsWith(`${tab.href}/`)),
    )
    .sort((left, right) => right.href.length - left.href.length)[0];
  return { activeId: active?.id ?? parentCode, tabs };
}

export function WorkspaceNavigation({ parentCode, label }: { parentCode: string; label: string }) {
  const pathname = usePathname();
  const admin = useAdminContext();
  if (admin.state.phase !== "ready") return null;
  const model = workspaceTabsFromNavigation(admin.state.context.navigation, parentCode, pathname);
  return model.tabs.length > 1 ? (
    <SettingsTabs activeId={model.activeId} label={label} tabs={model.tabs} />
  ) : null;
}
