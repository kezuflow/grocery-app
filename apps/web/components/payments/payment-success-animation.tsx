"use client";

import { DotLottieReact, setWasmUrl, type DotLottie } from "@lottiefiles/dotlottie-react";
import { useEffect, useState } from "react";

function StaticSuccessMark() {
  return (
    <svg
      aria-hidden="true"
      className="h-32 w-32 text-emerald-700"
      viewBox="0 0 128 128"
      fill="none"
    >
      <circle cx="64" cy="64" r="56" fill="currentColor" opacity="0.12" />
      <circle cx="64" cy="64" r="42" fill="currentColor" />
      <path
        d="m43 65 14 14 29-31"
        stroke="white"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="9"
      />
    </svg>
  );
}

export function PaymentSuccessAnimation() {
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const [player, setPlayer] = useState<DotLottie | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    setWasmUrl("/animations/dotlottie-player.wasm");
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!player) return;
    const showFallback = () => setFailed(true);
    player.addEventListener("loadError", showFallback);
    player.addEventListener("renderError", showFallback);
    return () => {
      player.removeEventListener("loadError", showFallback);
      player.removeEventListener("renderError", showFallback);
    };
  }, [player]);

  if (reducedMotion !== false || failed) return <StaticSuccessMark />;

  return (
    <DotLottieReact
      aria-hidden="true"
      autoplay
      className="h-48 w-48"
      dotLottieRefCallback={setPlayer}
      layout={{ fit: "contain", align: [0.5, 0.5] }}
      loop={false}
      src="/animations/payment-success.lottie"
    />
  );
}
