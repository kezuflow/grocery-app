# FreshMarkets Mobile app plan

The owner's 2026-09-30 instruction authorizes Phase 1 implementation. Later phases below are direction, not implementation or release acceptance. Mobile uses FreshMarkets branding and adapts the discovery, search, order-progress and review hierarchy observed in [Foodpanda ordering](https://mobbin.com/flows/0ebe7c18-e52f-46ff-818a-8ed36cd47f54), [tracking](https://mobbin.com/flows/bcdcafeb-295d-40c5-9f3d-b160668bd82a), [review](https://mobbin.com/flows/0ef1fe7f-0006-4b76-a59a-3e2aeb10cca7), and [search](https://mobbin.com/screens/eed3c76a-e5a1-4e9e-8267-ad10fb5a5bd6). Do not copy their assets or wording.

## Phase 1 — Native foundation and anonymous catalog (MOB-1)

Create `/mobile` with Expo Router tabs Home, Search, Cart, Orders and Account, and a lean `apps/mobile-api` Worker with a Core service binding. Home and Search make real anonymous Core catalog reads. Price and availability stay location-neutral until a trusted location context is designed. Incomplete tabs say what is pending; no mock order or payment success. Verify native bundles, Worker build/type checks, and a local Mobile API -> Core -> D1 read. This phase does not authorize deployment.

## Phase 2 — Location, identity and shopping

Add serviceability/address selection, location-aware catalog and product detail, sign-in, favorites, cart and checkout through Core-owned commands and sessions. The mobile adapter owns no separate commerce data or policy. Follow the active Core delivery mode: Scheduled initially, Instant when actually enabled. Do not add customer-selected delivery slots as an enduring mobile concept.

## Phase 3 — Orders and delivery

Add order history, progress and provider tracking from Core read models. Do not add rider chat or drop-off photos. Show an ETA only if Lalamove supplies a supported, reliable estimate and Core exposes it with appropriate unavailable and stale states; current provider integration does not.

## Phase 4 — Retention and feedback

Add saved favorites and “popular with your order” recommendations from actual order patterns, with privacy and sparse-history behavior defined before implementation. After delivery, ask for private order-level feedback about the overall shopping experience; the exact rating/tags/text fields and Admin workflow remain to be decided. Do not attach ratings to individual products or publish customer reviews without a separate owner decision.
