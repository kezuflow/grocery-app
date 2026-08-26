import type { CoreServiceBinding } from "@freshmarkets/contracts";

/**
 * The single checked boundary between the generated Worker binding and the
 * application contract. Wrangler emits `Cloudflare.Env["CORE"]` as an opaque
 * `Service` handle because RPC shapes are not propagated across wrangler
 * configurations, so this adapter is the only place permitted to assert that
 * the deployed `CoreEntrypoint` implements `CoreServiceBinding`. Route modules
 * must obtain Core exclusively through `coreClient(env.CORE)`.
 */
export function coreClient(binding: Cloudflare.Env["CORE"]): CoreServiceBinding {
  return binding as unknown as CoreServiceBinding;
}
