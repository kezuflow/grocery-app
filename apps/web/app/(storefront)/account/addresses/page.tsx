import { env } from "cloudflare:workers";
import { AddressBookClient } from "./address-book-client";
import { googleMapsBrowserConfiguration } from "@/lib/maps/google-maps-runtime";

export default function AddressBookPage() {
  const googleMaps = googleMapsBrowserConfiguration(env);
  return <AddressBookClient browserApiKey={googleMaps.browserApiKey} mapId={googleMaps.mapId} />;
}
