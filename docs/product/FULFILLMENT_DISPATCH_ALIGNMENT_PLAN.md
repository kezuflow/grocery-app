# Fulfillment and dispatch alignment — completed source plan

Status: **FDP-0–FDP-6 completed source/local work; later 2026-09-22/26/27 corrections supersede the original dispatch and Scheduled preparation matrix.** Actual provider acceptance remains separate. Do not rerun the old slices.

Current journeys, owned by [PRODUCT.md](PRODUCT.md):

- Instant: paid held/reserved goods -> pick/check -> Start packing automatically submits first courier booking using the accepted provider/service -> packed stock consumption -> verified handover/pickup -> delivery. Automatic safe submissions stay bounded. Manual is recovery only after definite prior courier closure and completed packing.
- Scheduled: verified paid demand until saved Procurement starts -> location/week Purchase complete -> each physically packed Order's Finish packing -> staff Lalamove or ordinary Manual choice -> delivery. No routine receiving/allocation/consumption prerequisite or goods movement.
- New Manual confirmation records assignment and physical handover together. Retained older assignments keep separate handover evidence. One active/unknown attempt blocks replacement; staff retries after definite closure have no lifetime count cap.

Legacy preparation compatibility is limited to successful exact command replay and retained preparation already in progress. A new Scheduled Start picking command rejects; use the current purchase/packing journey. Already-started legacy packing still enforces and consumes its explicit cycle-goods evidence; do not remove its conservation, authorization, transaction or refund safeguards.

The [historical original plan](../archive/FULFILLMENT_DISPATCH_ALIGNMENT_PLAN_20260922.md) preserves the previous criteria for evidence only. Current transaction/read semantics are in [API_CONTRACTS.md](../architecture/API_CONTRACTS.md); unfinished release acceptance is in [COMMERCE_ALIGNMENT_E2E_PLAN.md](COMMERCE_ALIGNMENT_E2E_PLAN.md) and the [active checkpoint](../operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md). No deployment/provider/message authorization comes from this completed plan.
