import {
  CookingPot,
  Fish,
  ClipboardList,
  HeartPulse,
  Home,
  ShoppingBag,
  ShoppingBasket,
  Tag,
  UserRound,
  Wine,
  type LucideIcon,
} from "lucide-react";

export type StorefrontNavigationItem = {
  label: string;
  href?: string;
  disabled?: boolean;
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
  { label: "Retail", href: "/retail", icon: ShoppingBag, tone: "retail" },
  { label: "Pantry", href: "/pantry", icon: CookingPot, tone: "pantry" },
  { label: "Meat & Seafood", href: "/meat-seafood", icon: Fish, tone: "meat-seafood" },
  { label: "Health", disabled: true, icon: HeartPulse, tone: "health" },
  { label: "Alcohol", disabled: true, icon: Wine, tone: "alcohol" },
  { label: "Deals", href: "/#daily-deals", icon: Tag, tone: "deals" },
];

export const mobileNavigation = [
  { label: "Home", href: "/", icon: Home },
  { label: "Shop", href: "/?category=produce", icon: ShoppingBasket },
  { label: "Orders", href: "/orders", icon: ClipboardList },
  { label: "Account", href: "/account", icon: UserRound },
] as const;
