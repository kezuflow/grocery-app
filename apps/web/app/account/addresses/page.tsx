import { env } from "cloudflare:workers";
import { AddressBookClient } from "./address-book-client";

export default function AddressBookPage() {
  return <AddressBookClient publicAccessToken={env.MAPBOX_PUBLIC_ACCESS_TOKEN || undefined} />;
}
