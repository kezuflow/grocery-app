import Link from "next/link";
import { MarketplaceCatalog } from "./marketplace-catalog";

export default function MarketplaceHome() {
  return (
    <main className="min-h-screen bg-[#f8faf6] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" className="text-xl font-bold tracking-tight text-emerald-800">
            FreshMarkets
          </Link>
          <nav className="flex gap-4 text-sm font-medium">
            <Link href="/serviceability">Delivery area</Link>
            <Link href="/cart">Cart</Link>
            <Link href="/account">Account</Link>
            <Link href="/auth/login">Log in</Link>
          </nav>
        </div>
      </header>
      <section className="border-b border-emerald-100 bg-emerald-50">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-12">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
            Fresh groceries for Cebu
          </p>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            Market-fresh essentials, packed for your next delivery.
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-slate-700">
            Browse fixed weights and packs with transparent PHP pricing. Serviceability and
            fulfillment are confirmed by FreshMarkets.
          </p>
          <MarketplaceCatalog />
        </div>
      </section>
    </main>
  );
}
