import type { Metadata } from "next";
import { env } from "cloudflare:workers";
import { StorefrontRuntimeProvider } from "../components/storefront/storefront-runtime";
import "./globals.css";

export const metadata: Metadata = {
  title: "FreshMarkets Cebu Grocery Delivery",
  description: "Subscription grocery commerce with scheduled Cebu delivery",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <StorefrontRuntimeProvider mapboxPublicAccessToken={env.MAPBOX_BROWSER_TOKEN || undefined}>
          {children}
        </StorefrontRuntimeProvider>
      </body>
    </html>
  );
}
