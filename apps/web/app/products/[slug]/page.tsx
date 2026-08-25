import Link from "next/link";
import { ProductView } from "./product-view";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-10">
      <Link href="/" className="text-sm font-semibold text-emerald-800">
        ← Back to groceries
      </Link>
      <div className="mt-8">
        <ProductView slug={slug} />
      </div>
    </main>
  );
}
