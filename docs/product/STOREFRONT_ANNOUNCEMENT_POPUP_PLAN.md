# Storefront announcement popup — plan and assets

Status: the original popup and rounded Storefront/Admin buttons were deployed and browser-checked on 2026-09-26. The owner's subsequent announcement, image, motion and cart-action revision was committed, pushed and deployed on 2026-09-26; the popup was checked in production at desktop and mobile widths, including repeat display after refresh. This focused presentation slice belongs to [commerce alignment Phase 7](COMMERCE_ALIGNMENT_E2E_PLAN.md#phase-7--complete-journeys-and-activation-evidence). Core remains the authority for actual ordering admission, delivery options, windows and fees.

## Current owner-approved experience

Show a centered welcome announcement on every eligible storefront home visit, before browsing. It does not appear over checkout, payment, order tracking, authentication or Admin. A visible Close action, Escape and the primary action dismiss the current opening; the next home visit shows it again. Focus returns to a sensible storefront target. The shop remains accessible if an image fails to load.

The visual hierarchy follows the attached [X announcement modal](https://mobbin.com/screens/a6a0ed76-312a-4d82-a585-9e1c5912cf8e): white top bar with Close and FreshMarkets mark, a full-width image, concise copy on white and one green action. The centered card must fit a mobile viewport with both Close and action reachable. [Grab's order action](https://mobbin.com/screens/843520c2-c0f1-4f3a-8910-4b8e65347011) informs the fully rounded button shape. The owner extended that shape to Storefront and Admin buttons; fields and other containers retain their own shapes. Grab's published [Duxton account](https://www.figma.com/customers/how-grab-scales-hyperlocal-experiences-across-southeast-asia-with-figma-and-ai/) describes configurable corner radius, not a universal public pill rule.

Use the combined [market scene](../../apps/web/public/announcements/welcome-market-scene.webp): a smiling fictional Filipina shopper on the left, enlarged and cropped around mid-thigh, holding the clearly branded FreshMarkets produce tote. The small wooden vegetable boxes recede in the softly blurred supermarket background on the right. This replaces compositing a separate shopper cutout over a background in the popup. The original [transparent shopper](../../apps/web/public/announcements/welcome-shopper.png) remains a source asset. The separate [grass mascot](../../apps/web/public/announcements/grass-mascot.png) overlaps the lower-right image/copy seam and floats gently up and down. Its motion stops when reduced motion is requested and must not obscure the announcement text.

## Page 1 copy

| Element | Approved copy |
| --- | --- |
| Headline | Welcome to FreshMarkets |
| Body | We're accepting scheduled orders Monday through Friday for delivery on Saturday or Sunday. Stay tuned for updates on instant delivery. |
| Primary action | Shop fresh picks |

The earlier “Fresh goodness, on your schedule” eyebrow, promotional body and small factual note are removed. This is a general launch announcement, not an order-specific promise or checkout authority. Checkout continues to show the currently available Core-backed Scheduled cycle, delivery window and fee; the published weekly cadence and announcement must be revised before the underlying public offer changes. PRODUCT GD-D14 keeps cycle dates configurable.

## Separate announcement system

Keep the announcement in its own storefront module, separate from Featured banners, promotions, notifications and commerce state. A campaign has a stable identity and revision, with ordered pages. A page carries its own title, body and action label. The shell supports later second and third pages with explicit Next/Back and a restrained page count; it never auto-advances. There is one approved page today, so no progress control appears. Do not repurpose Admin Banners or add a content-management write path without a separate owner request.

The owner explicitly replaced remembered dismissal with always showing the popup on an eligible home visit. No cookie or storage key suppresses a later visit. Closing it permits the current visit to continue; opening the home route again remounts it.

## Acceptance for the current revision

1. Replace the first scene with one shopper/market image; inspect desktop and mobile framing so the shopper and branded tote dominate and the wooden produce boxes remain small and soft.
2. Show the approved title, body and CTA with no former eyebrow or small-print line. Keep the announcement independent of the Core home contract's retired announcement-copy selector.
3. Verify close, Escape, focus, CTA, every-home-visit display, mobile reachability, mascot placement and reduced motion. Check the guest Sign in to checkout pill is shorter and centered in the cart drawer and Cart page.
4. Run the relevant Web/Core/contract and browser gates before any separately authorized deployment. Record local behavior separately from production acceptance in the active checkpoint.
