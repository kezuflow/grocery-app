"use client";

import Link from "next/link";
import { X } from "lucide-react";
import type { MembershipExperienceView } from "@freshmarkets/contracts";
import { useEffect, useState } from "react";

export function MembershipCtaBar({
  experience: suppliedExperience,
}: {
  experience?: MembershipExperienceView;
}) {
  const [visible, setVisible] = useState(true);
  const [experience, setExperience] = useState(suppliedExperience);

  useEffect(() => {
    if (suppliedExperience) return;
    let active = true;
    void fetch("/api/membership")
      .then(
        async (response) =>
          (await response.json()) as { ok: boolean; value?: MembershipExperienceView },
      )
      .then((result) => {
        if (active && result.ok && result.value) setExperience(result.value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [suppliedExperience]);

  if (!visible || !experience || experience.subscription) return null;

  const offer = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: experience.offer.currency,
    maximumFractionDigits: 0,
  }).format(experience.offer.amountMinor / 100);
  const trialAvailable = experience.introductoryTrial.eligible;

  return (
    <aside
      aria-label="FreshMarkets membership offer"
      className="fixed inset-x-0 bottom-[60px] z-40 bg-[#111111] text-white shadow-[0_-8px_24px_rgba(0,0,0,0.16)] lg:bottom-0"
    >
      <div className="relative mx-auto flex min-h-[76px] max-w-[var(--fm-container-content)] items-center gap-2 px-3 pr-11 sm:min-h-[72px] sm:gap-4 sm:px-6 sm:pr-14 lg:px-8">
        <div
          className="relative h-[76px] w-11 shrink-0 sm:h-[72px] sm:w-20 lg:w-24"
          aria-hidden="true"
        >
          <img
            src="/illustrations/produce-box-cta.webp"
            alt=""
            width={292}
            height={320}
            className="pointer-events-none absolute bottom-0 left-1/2 h-14 w-auto max-w-none -translate-x-1/2 select-none sm:h-24 lg:h-28"
          />
        </div>

        <p className="min-w-0 flex-1 text-[11px] leading-4 font-semibold sm:text-sm sm:leading-5">
          <span className="sm:hidden">
            {trialAvailable ? (
              <>Introductory trial available, then {offer}/month.</>
            ) : (
              <>
                {experience.offer.name} is {offer}/month.
              </>
            )}
          </span>
          <span className="hidden sm:inline">
            {trialAvailable
              ? `Start the available introductory trial, then ${offer}/month.`
              : `${experience.offer.name} is ${offer}/month.`}
          </span>
        </p>

        <Link
          href="/account"
          className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-lime)] px-2 text-[11px] font-bold text-[var(--fm-primary-dark)] transition-colors hover:bg-[#c4fa69] focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:outline-none sm:px-4 sm:text-sm"
        >
          {trialAvailable ? "Review introductory trial" : "Review membership"}
        </Link>
      </div>

      <button
        type="button"
        aria-label="Dismiss membership offer"
        onClick={() => setVisible(false)}
        className="absolute top-1/2 right-2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:right-4"
      >
        <X className="size-5" aria-hidden="true" />
      </button>
    </aside>
  );
}
