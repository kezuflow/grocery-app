import type { Metadata } from "next";
import { env } from "cloudflare:workers";
import { StorefrontRuntimeProvider } from "../components/storefront/storefront-runtime";
import { googleMapsBrowserConfiguration } from "../lib/maps/google-maps-runtime";
import "./globals.css";

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
          {children}
        </StorefrontRuntimeProvider>
      </body>
    </html>
  );
}
