# Storefront announcement popup — plan and assets

Status: **popup and rounded Storefront/Admin buttons implemented locally; release evidence remains in the active checkpoint**. Owner request `STOREFRONT-ANNOUNCEMENT-POPUP-1`, 2026-09-26, with subsequent `STOREFRONT-ADMIN-BUTTON-RADIUS-1` extension. This is a focused presentation slice under [the commerce alignment Phase 7 journey](COMMERCE_ALIGNMENT_E2E_PLAN.md#phase-7--complete-journeys-and-activation-evidence). PRODUCT and the current Core cycle remain the authority for ordering and delivery promises.

## Desired experience

On a customer's first eligible visit to the storefront home, show a centered announcement dialog before the page can be used. The first announcement welcomes the customer, explains the weekly shopping rhythm, and offers **Shop this week's picks**. A visible **Close** action, Escape, and the primary action dismiss it; focus returns to the trigger or a sensible home heading. The customer can still access the shop if announcement data or storage is unavailable. Do not place the dialog over checkout, payment, order tracking, authentication, or Admin.

Owner direction, 2026-09-26: use the attached [X announcement modal](https://mobbin.com/screens/a6a0ed76-312a-4d82-a585-9e1c5912cf8e) as the primary composition reference. Adapt its simple sequence: compact white top bar with Close and FreshMarkets mark, a strong full-width visual area, short headline/body on white, and one wide action anchored at the bottom. Keep FreshMarkets color, typography and imagery; do not copy X's logo, artwork, legal copy or dark CTA. On desktop the dialog remains a compact centered vertical card. On mobile it becomes viewport-clamped with the action reachable without losing access to Close. This replaces the earlier two-column desktop direction. The two generated FreshMarkets images are:

- [Welcome shopper](../../apps/web/public/announcements/welcome-shopper.png): fictional happy Filipina mixed-heritage model in her 30s, shown head to toe with a branded reusable produce bag on a transparent PNG canvas. Use as the main cutout without cropping her body or the bag logo.
- [Grass mascot](../../apps/web/public/announcements/grass-mascot.png): original happy 3D grass-ball character with transparent PNG alpha. Use as a small overlapping accent; hide it if it obscures text on narrow screens.

Place the full-body shopper with `object-fit: contain` in a soft green visual field, leaving all of her body and tote visible. Place the mascot as a small accent away from her face and branding. Let the visual field grow enough to keep both images legible instead of cropping the shopper to match the exact X banner height. The primary CTA uses FreshMarkets' current green fill and a Grab-inspired fully rounded pill shape; [Grab's order action](https://mobbin.com/screens/843520c2-c0f1-4f3a-8910-4b8e65347011) is the shape reference. Keep a visible focus style and at least a 44px touch target.

The owner subsequently approved the rounded storefront treatment and then explicitly extended it to Admin buttons. The shared CSS gives buttons on both surfaces a full pill radius, even where a button had an explicit corner radius, and aligns links that already use `--fm-radius-control`. Fields and non-button containers retain their existing shape. Grab's published [Duxton account](https://www.figma.com/customers/how-grab-scales-hyperlocal-experiences-across-southeast-asia-with-figma-and-ai/) describes configurable component corner radius, not a universal public pill specification.

## Page 1 copy

| Element | Copy |
| --- | --- |
| Eyebrow | Fresh goodness, on your schedule |
| Headline | Welcome to FreshMarkets |
| Body when the published cycle truly offers the stated week | “Make room for more of the good stuff. Shop your market favorites Monday through Friday, and we'll bring your fresh picks straight to your door on Sunday. Fill your bag with the ingredients for a delicious week ahead.” |
| Primary action | Shop this week's picks |

**Small factual line:** “Delivery availability, exact arrival time and fees are confirmed at checkout.”

The literal Monday–Friday/Sunday copy is **conditional**. PRODUCT GD-D14 treats those weekdays as examples, and current customer guidance says the ordinary Friday 11:59 PM cutoff can lead to a Saturday **or** Sunday arrival range. Core's home read returns `MONDAY_FRIDAY_SUNDAY` only while Scheduled selling is Open and every currently offered Open cycle has the matching local weekdays and a Sunday-only arrival window. Web otherwise displays safe general copy: “Explore fresh market favorites and choose the available delivery option at checkout.” Keep the exact window and fee in Core-backed shopping and checkout UI. This announcement is neither a delivery guarantee nor checkout authority.

## Separate announcement system

Keep announcement content in a dedicated storefront module, separate from Featured banners, promotion codes, notifications and commerce state. Model a campaign with a stable `id`, `revision`, `status`, optional active interval, audience/route eligibility, and ordered `pages[]`. Each page has an `id`, eyebrow, headline, body, optional small-print, image references/alt treatment, primary action and optional secondary action. Page one contains the welcome message. Later campaigns or revisions can add page two or three without changing the dialog shell. This plan does **not** define those pages' content or create new business rules.

Initially a reviewed, versioned configuration can supply the page data. If nondeveloper editing is later requested, add a separate Core-owned publish command/read model with image safety, scheduling, audit and authorized preview; do not repurpose Admin Banners or allow arbitrary Web business writes. Treat active cycle facts as inputs to eligibility, never as announcement-owned state.

For one page, show no progress control. For multiple pages, show a restrained “1 of 3” indicator with explicit **Next** and **Back**, keeping the action to enter the shop on the final page. No auto-advance. Dismissal applies to the entire campaign revision. The initial implementation uses a non-sensitive first-party cookie containing campaign ID and revision so the server can suppress repeat visits without a readable-content flash. Do not repeatedly interrupt route changes or authenticated sessions. A future operational message would need a reopening entry point.

## Build and acceptance sequence

1. Reconcile the intended public weekly wording with the active product configuration and exact cycle; choose the literal or safe copy from verified facts. Confirm no new delivery policy is being introduced by marketing text.
2. Build an accessible dialog mounted in the storefront home boundary, using the X-style vertical hierarchy, current storefront tokens and the generated assets. Use a compact visual over the copy at every width, a bounded scroll area on small screens, and the pill-shaped green popup CTA. Lazy-load images after eligibility and retain useful text if they fail.
3. Add the independent campaign/page configuration, revision-based dismissal and route eligibility. Keep SSR/hydration behavior from flashing readable content before the dialog is ready, while preserving a safe path through failures. Manage focus, keyboard navigation, screen-reader title/description, background inertness, Escape/close, and reduced motion.
4. Verify first eligible visit, dismissal and revisit, new revision, multi-page navigation with sample page data, small mobile viewport, image failure, storage denial, and Instant/Scheduled or changed-cycle wording. Check that checkout and existing Deliver to prompt remain usable after dismissal. Complete Worker/browser acceptance before any separately authorized deployment.

Acceptance is a visible, accessible first-visit announcement on eligible storefront home visits, with the correct two images and cycle-accurate copy; dismissal and future page support work without changing commerce authority. This document and the images alone do not satisfy that acceptance.
