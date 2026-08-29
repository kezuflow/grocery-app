import { ClipboardList, Home, ShoppingBasket, Tag, UserRound, type LucideIcon } from "lucide-react";

export type StorefrontNavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  tone: string;
};

export const storefrontNavigation: ReadonlyArray<StorefrontNavigationItem> = [
  { label: "Home", href: "/", icon: Home, tone: "home" },
  {
    label: "All groceries",
    href: "/?category=all",
    icon: ShoppingBasket,
    tone: "groceries",
  },
  { label: "Deals", href: "/#daily-deals", icon: Tag, tone: "deals" },
];

export const mobileNavigation = [
  { label: "Home", href: "/", icon: Home },
  { label: "Shop", href: "/?category=produce", icon: ShoppingBasket },
  { label: "Orders", href: "/orders", icon: ClipboardList },
  { label: "Account", href: "/account", icon: UserRound },
] as const;
