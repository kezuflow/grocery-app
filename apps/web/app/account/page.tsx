import Link from "next/link";
import {
  ChevronRight,
  UserRound,
  MapPin,
  ShoppingBag,
  ShoppingCart,
  KeyRound,
  Headphones,
  LogOut,
  BadgeCheck,
} from "lucide-react";
import { StorefrontShell } from "../../components/storefront/storefront-shell";
import "./account.css";

const shortcuts = [
  {
    href: "/account/profile",
    title: "Profile",
    description: "Your name, contact details and preferences",
    icon: UserRound,
  },
  {
    href: "/account/addresses",
    title: "Delivery addresses",
    description: "Manage your saved delivery destinations",
    icon: MapPin,
  },
  {
    href: "/orders",
    title: "Order history",
    description: "View your grocery orders and their progress",
    icon: ShoppingBag,
  },
  {
    href: "/cart",
    title: "Your cart",
    description: "Pick up where you left off",
    icon: ShoppingCart,
  },
];
const settings = [
  { href: "/auth/forgot-password", title: "Reset password", icon: KeyRound },
  { href: "/staff-invitation", title: "Staff invitation", icon: BadgeCheck },
  { href: "mailto:support@freshmarkets.ph", title: "Help and support", icon: Headphones },
  { href: "/auth/logout", title: "Sign out", icon: LogOut },
];
export default function AccountPage() {
  return (
    <StorefrontShell>
      <div className="fm-account-page">
        <header className="fm-account-heading">
          <h1>Your account</h1>
          <p>Everything you need for your next grocery delivery.</p>
        </header>
        <nav aria-label="Your account" className="fm-account-grid">
          {shortcuts.map(({ href, title, description, icon: Icon }) => (
            <Link key={href} href={href} className="fm-account-tile">
              <Icon aria-hidden="true" className="fm-account-icon" />
              <h2>{title}</h2>
              <p>{description}</p>
              <ChevronRight aria-hidden="true" className="fm-account-chevron" />
            </Link>
          ))}
        </nav>
        <section className="fm-account-panel">
          <header>
            <h2>Account settings</h2>
          </header>
          <nav aria-label="Account settings">
            {settings.map(({ href, title, icon: Icon }) => (
              <Link key={href} href={href} prefetch={false} className="fm-account-row">
                <Icon aria-hidden="true" className="size-5" />
                <span>{title}</span>
                <ChevronRight aria-hidden="true" className="ml-auto size-4" />
              </Link>
            ))}
          </nav>
        </section>
      </div>
    </StorefrontShell>
  );
}
