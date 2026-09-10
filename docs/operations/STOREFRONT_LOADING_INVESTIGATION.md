# Storefront loading investigation — CA-7.22

Investigated 2026-09-10. Source plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. The owner requested a deeper investigation of long browser loading, repeated address work and unnecessary calls. The subsequent instruction restricts further browser work to the Codex in-app browser on `http://localhost:3000`.

This is investigation evidence and a proposed repair order, not implementation acceptance. No application code, configuration or business data was changed in this task. No deployment, customer address confirmation, cart mutation, payment, courier operation or outbound message was performed.

## Result

Repeated delivery checks contribute to latency, but they are not repeated Mapbox address searches. The remembered header label is read from local storage. With a remembered point, catalog requests resolve current delivery coverage in Core/D1 before reading current catalog data. A separate dismissal defect can reopen the address dialog and initialize its map again.

The largest confirmed sources of avoidable work are eager offscreen images, this repeated map prompt, redundant cart refreshes and client-only product-page fetching. The remaining location-aware read path is serial and expensive against remote development bindings. No infinite address-search loop was found in the inspected storefront path; this is not an assertion about every application route.

## Revision and environment

- Started on `main` at `f035675021568b0a19697730819fa5ec89ed0646`, with pre-existing catalog/geography batching and product-prefetch edits in the working tree. During investigation those changes landed separately as `25e90ef3e90547f2342c84060e57aa46ef0e33f0` (CA-7.21). They are not work performed by this investigation.
- Unrelated deletions, deployment/configuration edits, counted-stock browser work, the protected discussion and older checkpoint edits were preserved. No subagents were used.
- `pnpm dev` runs local Web/Core against shared remote D1/R2 under `apps/web/vite.config.ts`. Its timings include the development proxy and should not be described as deployed Worker latency. No storage mode or resource binding was changed.
- Initial Chrome inspection and public-site samples preceded the owner's correction. All subsequent browser interactions used the in-app browser on localhost. In-app inspection exposes UI/DOM and console logs, but its read-only evaluation scope did not expose `performance`; no in-app Core Web Vitals figures are claimed. Local API timings came from Node HTTP probes and dev-server request logs.

## Local measurements and executed observations

Three sequential HTTP samples per condition used `node --input-type=module`, built-in `fetch`, `performance.now()` and `AbortSignal.timeout(20000)`. Product requests were `GET http://localhost:3000/api/catalog/product?slug=abiu`. The location-aware condition supplied only a synthetic browsing cookie using the existing `CEBU_CENTER` constant from `address-editor.tsx`; it did not save a customer address or call a geocoding provider. The coverage probe was `POST http://localhost:3000/api/serviceability` with that same sample point. Only status, success, location-awareness/serviceability flags and elapsed time were printed.

| Local read | Samples (ms) | Median (ms) |
| --- | --- | --- |
| Abiu without a browsing point | 559, 402, 432 | 432 |
| Abiu with the sample browsing point | 1414, 2172, 1303 | 1414 |
| Coverage resolution alone | 393, 423, 336 | 393 |

All 9 responses were HTTP 200 with `ok: true`; the sample point was serviceable and the location-aware product result identified itself as location-aware. These samples used the CA-7.21 source changes that were subsequently committed above. They are a small diagnostic sample, not a percentile, controlled benchmark or isolated attribution of the entire 982 ms median difference to geography. Location-aware reads additionally evaluate location, prices, stock/mode and applicable sales.

After restarting the existing dev topology, the in-app browser executed:

1. Load home and observe the address prompt. Close it with X.
2. Open **Abiu details**. Observe the immediately visible loading dialog, then completed product detail. The server recorded one product API GET, 200 in 424 ms, without a browsing point.
3. Activate **View full details**. The product page loaded and the address prompt reopened.
4. Use **Skip for now — browse groceries**, then **Back to groceries**. Home loaded without reopening the prompt.
5. Inspect home images: **81 product images**, **0 images with `loading="lazy"`**. No cart quantities or account information were changed.

## Seven actionable findings

### 1. Every product image loads eagerly — high impact

`apps/web/components/storefront/product-media.tsx:20` emits an ordinary `<img>` without `loading="lazy"`. Home requests up to 12 items for every category (`apps/web/app/page.tsx:49`), and every rail renders all its cards, including horizontally and vertically offscreen cards. The in-app home DOM contained 81 product images, all eager.

An image-cache miss calls Core, validates publication in D1, fetches the R2 object, buffers its bytes and fills the Web cache before returning. A conditional 304 is decided **after** that load on a cache miss (`cached-public-image.ts:29`; `published-product-media.ts:72`). Consequently, cache expiry or a dev restart can still produce many remote reads even if the browser ultimately receives 304 responses.

Local server logs during the restart contained many 304 image reads taking hundreds of milliseconds to over a second and one image HTTP 500 after **19.7 seconds** with a remote-binding error. That image subsequently returned 200 in 1.7 seconds. The remote error's underlying cause was not isolated; do not claim that concurrency conclusively caused it.

Proposed repair: lazy-load below-the-fold and offscreen rail images while retaining eager loading for initially visible content. Give images stable dimensions and measure cold and warm loads again. Native lazy loading defers requests near the viewport; browser distance thresholds mean it does not guarantee exactly the visible-image count. See [Chrome's image lazy-loading guidance](https://web.dev/articles/browser-level-image-lazy-loading). Preserve the approved publication freshness policy.

### 2. Closing the address prompt does not remember dismissal — high impact

`apps/web/components/storefront/address/delivery-address-dialog.tsx:113` writes the dismissal flag in native `onClose`, but X, backdrop and Escape paths only call `setOpen(false)`. Because the dialog is conditionally rendered, it unmounts before the closing effect can close that element. The flag is not reliably written. The next browsing route's effect sees no point and no dismissal, opens the dialog and mounts a new map.

The X → Abiu popup → full product page sequence reproduced this in the in-app browser. The explicit Skip path writes the flag before unmounting and did not reopen the prompt on returning home.

Proposed repair: use one explicit dismissal function that records the session choice before updating `open`, for X, Escape, backdrop and Skip. Verify all four dismissals across route changes while preserving explicit **Choose delivery address** reopening.

### 3. Location-aware catalog reads still have a serial database path — high impact

The normal product path is:

```text
Product popup HTTP request
  -> Web readBrowsingLocation
     -> Core geography batch
  -> Core getProduct
     -> active location/market query
     -> product/variant/stock/mode/gallery batch
     -> applicable sale query when mode and prices permit
  -> response
```

Relevant sources: `read-browsing-location.ts:12`, `app/api/catalog/product/route.ts:23`, `catalog/service.ts:306`, `:455`, `:619`, and `promotions/application/product-sales.ts:86`.

CA-7.21 already reduced anonymous detail to one batch and geography to one batch. Nevertheless, the location-aware path can still require four sequential D1 stages across two Web-to-Core calls. Home also serially awaits context, categories, product selection and hydration. Campaign reads only start after Web resolves the browsing location, even though their request does not use that location. Search pagination already passes a Core-returned `locationId`, so it does not necessarily repeat geographic resolution on each load-more request; do not generalize the product behavior to every catalog request.

Proposed repair: consolidate the current-point/catalog read within Core and batch independent reads or use scoped subqueries where appropriate. Move independent home work out of the serial chain. Preserve fresh coverage, price, stock, sale and checkout checks; an indefinitely cached browser location ID must not become fulfillment authority. Measure each internal stage before choosing a broader cache. Cloudflare documents that `remote: true` uses remote resources even with local execution: [D1 development guidance](https://developers.cloudflare.com/d1/best-practices/local-development/).

### 4. Full product pages wait for browser JavaScript before reading data — medium impact

`apps/web/app/products/[slug]/page.tsx:6` renders a client `ProductView` with just the slug. `product-view.tsx:18` waits for mount and then calls the local product API, which calls Core. Navigation from an already loaded quick view therefore requests the same product again, and a direct visit incurs a document → JavaScript/hydration → API → Core waterfall. The in-app full product page completed, but its elapsed API timing was not separately isolated.

Proposed repair: read initial product data through the server's Service Binding, supplying typed initial data to the client controls. Retain deliberate refreshes where freshness is required and test deep links, missing products and unavailable variants.

### 5. Cart updates perform redundant reads after receiving the updated cart — medium impact

`cart-client.ts:215` calls `loadCartForLocation()` before a quantity mutation. With an already matching authenticated cart, this is coverage POST → cart GET → quantity POST. The successful POST returns and stores the updated `CartView` (`cart-client.ts:249`). Both `cart-drawer.tsx:60` and `app/cart/page.tsx:59` then invoke the loader again, repeating coverage POST → cart GET: **five browser requests for this ordinary quantity-change path**, before counting internal Core/D1 operations. Location changes or pending recovery can require additional calls.

This count is code-path evidence; no authenticated/shared-data cart mutation was executed. The `loadingCart` promise already deduplicates simultaneous readers, and product steppers subscribe to one cart event. There is no evidence that every product card independently fetches the cart.

Proposed repair: consume the authoritative successful mutation result in the drawer/page rather than rereading it immediately. Keep exact unknown-command replay, current authorization, version conflicts and location transitions intact. Separately consider resolving auth/cart before unnecessary guest geography work.

### 6. Confirming a browsing location forces a full document reload — medium impact

`delivery-address-dialog.tsx:76–84` stores the chosen point and always invokes `window.location.reload()`, including when the same point is confirmed. This remounts the storefront, reruns initial reads and revisits the document/module/media loading path. It does not mean all bytes necessarily redownload; browser caching still applies.

Proposed repair: compare the confirmed point and refresh the affected server catalog/cart context through navigation invalidation instead of a full document reload. Test current mode/price availability, changed fulfillment location and guest-cart preservation. This path was inspected in code, not executed against a real provider confirmation.

### 7. Pending product/cart reads have no application deadline — medium impact

`product-quick-view.tsx:48` uses an AbortController on close or slug change, but no timeout. `load-cart-for-location.ts:32` and subsequent cart reads have no deadline either. A stalled remote read can leave a spinner active until the network or user ends it. The slow failed image read above shows the environment can produce long waits, but it is not proof of an indefinitely stalled product response.

Proposed repair: bound read waits and show a retryable timeout state. Do not automatically retry business writes with a new idempotency identity, and do not report a timed-out write as definitively rejected.

## Separate development-runtime follow-up

The initial localhost process rendered server HTML and then failed with `useQuickView requires QuickViewProvider`. This reproduced in fresh Chrome contexts and in the in-app browser. The in-app console showed the consumer importing a timestamped quick-view module while its ancestor provider came from the unversioned module URL. That supports a hot-reload module identity mismatch rather than a missing JSX provider: the component stack contained `QuickViewProvider`.

A second `pnpm --filter @freshmarkets/web dev --port 3015` was rejected by vinext's existing-server guard and created no new listener. The identified original FreshMarkets dev process was then stopped and `pnpm dev` restarted on port 3000 with the same configuration. The first restart terminated with exit **3221226505**, leaving a failed dynamic-module import in the page. A second start recovered; the in-app home/popup/product/navigation observations above then passed. Repeated generic remote-binding internal errors remained in server output. No library upgrade, optimizer workaround or cache deletion was performed. The cause of the native process exit and generic remote errors remains unresolved.

The earlier localhost trace measured LCP 1620 ms and TTFB 1363 ms, but that page subsequently failed hydration. It is **not** a healthy-page performance acceptance result. A server HTTP 200 and fast first paint alone cannot establish an interactive page.

## Historical public observations, before the owner's browser correction

A fresh public visit loaded 81 product media resources totaling **4,104,962 transfer bytes**, with 12 product images within that viewport, and reached document load at approximately **5.03 seconds**. There were 28 RSC prefetches, including **18 product routes**, while primary product clicks opened a separate API-backed dialog. Map initialization added a roughly 507 KB compressed JS chunk and 15 Mapbox resource requests. No address search or address confirmation was submitted.

The 18 product-page prefetches describe the older deployed build. CA-7.21's current source already sets `prefetch={false}` on both product-card links. Deployment status was not changed or reverified after the owner directed the investigation to localhost. These numbers are not measurements of the current in-app localhost build.

## Completion and proposed repair order

CA-7.22 investigation is complete: seven code findings and one separate development-runtime follow-up are recorded. Zero application fixes from this investigation are claimed. Existing CA-7.21 batching/prefetch improvements remain separate completed source work; the prior deployment/provider obligations remain open.

Start with image demand reduction and consistent address dismissal, then eliminate the redundant cart/full-product-page reads, profile the remaining location-aware stages, replace the full-document refresh and add bounded read errors. Reproduce and diagnose the dev-runtime failures separately. Acceptance should include in-app cold/warm home loads, close/skip/navigation, remembered-location detail, and authenticated cart tests against disposable data; changes to Core queries need relevant actual Worker/D1 tests. No aggregate test suite was run for this documentation-only investigation.
