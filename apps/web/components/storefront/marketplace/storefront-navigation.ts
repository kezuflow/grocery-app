import {
  Apple,
  CakeSlice,
  Beef,
  Boxes,
  ClipboardList,
  Home,
  Milk,
  ShoppingBasket,
  Tag,
  UserRound,
  Wheat,
  type LucideIcon,
} from "lucide-react";

export type StorefrontNavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  tone: string;
};

export const storefrontNavigation: ReadonlyArray<StorefrontNavigationItem> = [
  { label: "Home", href: "/", icon: Home, tone: "home" },
  { label: "Produce", href: "/?category=produce", icon: ShoppingBasket, tone: "produce" },
  { label: "Fruits", href: "/?category=fruits", icon: Apple, tone: "fruits" },
  { label: "Meat & Seafood", href: "/?category=meat-seafood", icon: Beef, tone: "meat" },
  { label: "Dairy & Eggs", href: "/?category=dairy-eggs", icon: Milk, tone: "dairy" },
  { label: "Pantry", href: "/?category=pantry", icon: Wheat, tone: "pantry" },
  { label: "Bakery", href: "/?category=bakery", icon: CakeSlice, tone: "bakery" },
  { label: "Boxes", href: "/?category=boxes", icon: Boxes, tone: "boxes" },
  { label: "Deals", href: "/?category=deals", icon: Tag, tone: "deals" },
];

export const mobileNavigation = [
  { label: "Home", href: "/", icon: Home },
  { label: "Shop", href: "/?category=produce", icon: ShoppingBasket },
  { label: "Orders", href: "/orders", icon: ClipboardList },
  { label: "Account", href: "/account", icon: UserRound },
] as const;
