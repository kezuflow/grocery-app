# Storefront announcement popup — plan and assets

Status: **plan and image assets prepared; no popup behavior implemented or accepted**. Owner request `STOREFRONT-ANNOUNCEMENT-POPUP-1`, 2026-09-26. This is a focused storefront presentation plan under [the commerce alignment Phase 7 journey](COMMERCE_ALIGNMENT_E2E_PLAN.md#phase-7--complete-journeys-and-activation-evidence). PRODUCT and the current Core cycle remain the authority for ordering and delivery promises.

## Desired experience

On a customer's first eligible visit to the storefront home, show a centered announcement dialog before the page can be used. The first announcement welcomes the customer, explains the weekly shopping rhythm, and offers **Shop this week's picks**. A visible **Close** action, Escape, and the primary action dismiss it; focus returns to the trigger or a sensible home heading. The customer can still access the shop if announcement data or storage is unavailable. Do not place the dialog over checkout, payment, order tracking, authentication, or Admin.

Use the [Faire image-first announcement](https://mobbin.com/screens/e5373a39-735f-44ed-9430-50c7382715a4) for a compact image, headline, short body and single action. Use the [Walmart grocery explainer](https://mobbin.com/screens/747f1102-6638-4223-8c11-a2387af38c7b) for the clear shop action and delivery explanation. These are layout references, not assets or wording to copy. The two generated FreshMarkets images are:

- [Welcome shopper](../../apps/web/public/announcements/welcome-shopper.png): fictional happy Filipina mixed-heritage model in her 30s with a branded reusable produce bag. Use as the main visual, cropped to keep the face and bag logo visible.
- [Grass mascot](../../apps/web/public/announcements/grass-mascot.png): original happy 3D grass-ball character with transparent PNG alpha. Use as a small overlapping accent; hide it if it obscures text on narrow screens.

## Page 1 copy

| Element | Copy |
| --- | --- |
| Eyebrow | Fresh goodness, on your schedule |
| Headline | Welcome to FreshMarkets |
| Body when the published cycle truly offers the stated week | “Make room for more of the good stuff. Shop your market favorites Monday through Friday, and we'll bring your fresh picks straight to your door on Sunday. Fill your bag with the ingredients for a delicious week ahead.” |
| Primary action | Shop this week's picks |

**Small factual line:** “Delivery availability, exact arrival time and fees are confirmed at checkout.”

The literal Monday–Friday/Sunday copy is **conditional**. PRODUCT GD-D14 treats those weekdays as examples, and current customer guidance says the ordinary Friday 11:59 PM cutoff can lead to a Saturday **or** Sunday arrival range. A published Scheduled cycle's opening, cutoff and delivery window may differ; Instant has a different promise. Before publishing the literal copy, verify the active Scheduled mode and cycle actually accept orders across the stated days and provide a Sunday-only customer arrival window for the relevant audience. If those facts differ or cannot be verified, display safe general copy instead: “Explore fresh market favorites and choose the available delivery option at checkout.” Keep the exact window and fee in Core-backed shopping and checkout UI. Never present this announcement as a delivery guarantee, promotion, or checkout authority.

## Separate announcement system

Keep announcement content in a dedicated storefront module, separate from Featured banners, promotion codes, notifications and commerce state. Model a campaign with a stable `id`, `revision`, `status`, optional active interval, audience/route eligibility, and ordered `pages[]`. Each page has an `id`, eyebrow, headline, body, optional small-print, image references/alt treatment, primary action and optional secondary action. Page one contains the welcome message. Later campaigns or revisions can add page two or three without changing the dialog shell. This plan does **not** define those pages' content or create new business rules.

Initially a reviewed, versioned configuration can supply the page data. If nondeveloper editing is later requested, add a separate Core-owned publish command/read model with image safety, scheduling, audit and authorized preview; do not repurpose Admin Banners or allow arbitrary Web business writes. Treat active cycle facts as inputs to eligibility, never as announcement-owned state.

For one page, show no progress control. For multiple pages, show a restrained “1 of 3” indicator with explicit **Next** and **Back**, keeping the action to enter the shop on the final page. No auto-advance. Dismissal applies to the entire campaign revision. Store a non-sensitive per-browser dismissal key such as campaign ID plus revision so a new campaign/revision can appear once; allow an explicit reopening entry point from the storefront if the message contains operational information. Do not repeatedly interrupt route changes or authenticated sessions.

## Build and acceptance sequence

1. Reconcile the intended public weekly wording with the active product configuration and exact cycle; choose the literal or safe copy from verified facts. Confirm no new delivery policy is being introduced by marketing text.
2. Build an accessible dialog mounted in the storefront home boundary, using current storefront tokens and the generated assets. Desktop: image-led two-column composition; mobile: compact visual over the copy with a bounded, internally scrollable dialog. Lazy-load images after eligibility and retain useful text if they fail.
3. Add the independent campaign/page configuration, revision-based dismissal and route eligibility. Keep SSR/hydration behavior from flashing readable content before the dialog is ready, while preserving a safe path through failures. Manage focus, keyboard navigation, screen-reader title/description, background inertness, Escape/close, and reduced motion.
4. Verify first eligible visit, dismissal and revisit, new revision, multi-page navigation with sample page data, small mobile viewport, image failure, storage denial, and Instant/Scheduled or changed-cycle wording. Check that checkout and existing Deliver to prompt remain usable after dismissal. Complete Worker/browser acceptance before any separately authorized deployment.

Acceptance is a visible, accessible first-visit announcement on eligible storefront home visits, with the correct two images and cycle-accurate copy; dismissal and future page support work without changing commerce authority. This document and the images alone do not satisfy that acceptance.
