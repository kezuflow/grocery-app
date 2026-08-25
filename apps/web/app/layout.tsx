import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FreshMarkets Cebu Grocery Delivery",
  description: "Subscription grocery commerce with scheduled Cebu delivery",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
