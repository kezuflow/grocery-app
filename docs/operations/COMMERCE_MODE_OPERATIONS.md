# Commerce mode operations

Use these steps to pause selling, switch the one global fulfillment mode, and reopen commerce.
Core commands remain authoritative; never edit D1 rows directly.

## Pause

1. Record the operational reason and current configuration version.
2. Run `PauseSelling` with `commerce.manage`, the expected version, and a stable idempotency key.
3. Confirm the state is `PAUSED`. New fulfillment options, Quotes, and payment initiation must stop.
4. Confirm provider events, started-payment commitment, committed Orders, refunds, notifications,
   and delivery operations continue.

## Switch mode

1. Keep selling paused.
2. Verify mode readiness: exact store/SKU prices and Instant stock/provider capability, or an open
   Scheduled cycle/window before cutoff with a verified Lalamove quotation capability.
3. Run `ActivateGlobalFulfillmentMode` with the current expected version.
4. Confirm uncommitted commerce was invalidated and committed Orders retained their snapshots.
5. Never configure sourcing behavior or Scheduled capacity; behavior derives from the mode.

## Reopen

1. Resolve every blocker returned by the authoritative readiness query.
2. Run `OpenSelling` with the current expected version and a new stable idempotency key.
3. Confirm the state is `OPEN`, then smoke-test the active mode from fulfillment options through
   quote creation. Do not infer readiness from the Admin screen alone.

## Recovery

- On `STALE_VERSION`, reload and require a newly reviewed operator decision.
- On an ambiguous command response, retry the exact command with the same idempotency key.
- On provider configuration or quotation failure, remain paused; do not substitute a fixed rate.
- Do not switch mode to work around an already-started payment or rewrite a committed Order.

