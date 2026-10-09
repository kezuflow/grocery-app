import type { Metadata } from "next";
import { env } from "cloudflare:workers";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import { StorefrontRuntimeProvider } from "../components/storefront/storefront-runtime";
import { googleMapsBrowserConfiguration } from "../lib/maps/google-maps-runtime";
import "./globals.css";
import { ApplicationQueryProvider } from "../components/query-provider";

const description =
  "Shop groceries online with Freshmarkets, the delivery platform from Cebu-based startup FreshmarketsPH. Delivery in supported areas of Cebu, Philippines.";

export const metadata: Metadata = {
  title: "Freshmarkets | Cebu Grocery Delivery by FreshmarketsPH",
  description,
  openGraph: {
    title: "Freshmarkets | Cebu Grocery Delivery by FreshmarketsPH",
    description,
    siteName: "Freshmarkets",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const googleMaps = googleMapsBrowserConfiguration(env);
  return (
    <html lang="en">
      <body>
        <StorefrontRuntimeProvider
          googleMapsBrowserApiKey={googleMaps.browserApiKey}
          googleMapsMapId={googleMaps.mapId}
        >
          <ApplicationQueryProvider>{children}</ApplicationQueryProvider>
        </StorefrontRuntimeProvider>
      </body>
    </html>
  );
}
