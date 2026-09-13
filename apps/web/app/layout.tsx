import type { Metadata } from "next";
import { env } from "cloudflare:workers";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import { StorefrontRuntimeProvider } from "../components/storefront/storefront-runtime";
import { googleMapsBrowserConfiguration } from "../lib/maps/google-maps-runtime";
import "./globals.css";
import { ApplicationQueryProvider } from "../components/query-provider";

export const metadata: Metadata = {
  title: "FreshMarkets Cebu Grocery Delivery",
  description: "Subscription grocery commerce with scheduled Cebu delivery",
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
