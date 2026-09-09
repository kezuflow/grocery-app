import Link from "next/link";
import { StorefrontShell } from "../../components/storefront/storefront-shell";

export default function AccountPage() {
  return (
    <StorefrontShell>
      <div className="flex min-h-screen w-full flex-col gap-6 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <h1 className="text-3xl font-semibold">Your account</h1>
        <Link href="/staff-invitation" className="font-medium underline">
          Staff invitation
        </Link>
        <Link href="/account/profile" className="font-medium underline">
          Your preferences
        </Link>
        <Link href="/account/addresses" className="font-medium underline">
          Delivery addresses
        </Link>
        <Link href="/cart" className="font-medium underline">
          Open cart
        </Link>
        <Link href="/orders" className="font-medium underline">
          Order history
        </Link>
      </div>
    </StorefrontShell>
  );
}
