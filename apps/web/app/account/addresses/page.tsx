import { env } from "cloudflare:workers";
import { AddressBookClient } from "./address-book-client";

export default function AddressBookPage() {
  return <AddressBookClient publicAccessToken={env.MAPBOX_BROWSER_TOKEN || undefined} />;
}
