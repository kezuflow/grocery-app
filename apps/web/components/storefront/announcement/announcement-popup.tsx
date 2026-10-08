"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FreshMarketsMark } from "../../brand/freshmarkets-mark";
import { welcomeAnnouncementPages } from "./announcement-campaign";
import { DELIVERY_LOCATION_REQUEST_EVENT } from "../../../lib/storefront/browsing-location";
import "./announcement-popup.css";

export function AnnouncementPopup() {
  const pages = welcomeAnnouncementPages();
  const [pageIndex, setPageIndex] = useState(0);
  const [open, setOpen] = useState(true);
  const popoverRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const playbackRef = useRef<HTMLButtonElement>(null);
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(true);
  const page = pages[pageIndex];

  useEffect(() => {
    const popover = popoverRef.current;
    if (!open || !popover) return;
    // Opening a non-modal popover leaves browsing and keyboard focus available.
    // Removing the element automatically removes it from the browser's top layer.
    popover.showPopover();
  }, [open]);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setPlaying(!motion.matches);
    const updateVisibility = () => setVisible(!document.hidden);
    updateMotion();
    updateVisibility();
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      motion.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  const autoplay = open && playing && !hovered && visible;
  useEffect(() => {
    if (!autoplay || pages.length < 2) return;
    const timer = window.setTimeout(
      () => setPageIndex((index) => (index + 1) % pages.length),
      6_000,
    );
    return () => window.clearTimeout(timer);
  }, [autoplay, pageIndex, pages.length]);

  function selectPage(index: number) {
    setPlaying(false);
    setPageIndex(index);
    requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
  }

  function dismiss(destination: "home" | "catalog" | "delivery-address") {
    popoverRef.current?.hidePopover();
    setOpen(false);
    requestAnimationFrame(() => {
      if (destination === "delivery-address") {
        document
          .querySelector<HTMLButtonElement>('header button[aria-label="Choose delivery address"]')
          ?.focus({ preventScroll: true });
        window.dispatchEvent(new Event(DELIVERY_LOCATION_REQUEST_EVENT));
        return;
      }
      const shop = destination === "catalog";
      const target = shop
        ? document.getElementById("catalog")
        : document.querySelector<HTMLAnchorElement>('header a[href="/"]');
      if (target instanceof HTMLElement) {
        if (shop) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
        if (shop)
          target.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
            block: "start",
          });
      }
    });
  }

  if (!open || !page) return null;
  const lastPage = pageIndex === pages.length - 1;

  return (
    <div
      ref={popoverRef}
      popover="auto"
      role="region"
      aria-roledescription="carousel"
      aria-label="FreshMarkets welcome"
      className="fm-announcement-popover"
      onBeforeToggle={(event) => {
        if (event.newState !== "closed") return;
        if (popoverRef.current?.contains(document.activeElement)) {
          document
            .querySelector<HTMLAnchorElement>('header a[href="/"]')
            ?.focus({ preventScroll: true });
        }
        setOpen(false);
      }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        if (!playbackRef.current?.contains(event.target)) setPlaying(false);
      }}
    >
      <div className="fm-announcement-topbar">
        <span className="fm-announcement-topbar-spacer" aria-hidden="true" />
        <div className="fm-announcement-brand" aria-label="FreshMarkets">
          <FreshMarketsMark className="size-6" />
          <span>freshmarkets</span>
        </div>
        <button
          type="button"
          className="fm-announcement-close"
          aria-label="Close welcome announcement"
          onClick={() => dismiss("home")}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="fm-announcement-media">
        <img
          src={page.image.src}
          alt={page.image.alt}
          width={1536}
          height={1024}
          className="fm-announcement-scene"
        />
      </div>
      <div className="fm-announcement-content">
        <h2 id="fm-announcement-heading" ref={headingRef} tabIndex={-1}>
          {page.title}
        </h2>
        <p id="fm-announcement-body" className="fm-announcement-body">
          {page.body.map((segment, index) =>
            segment.emphasis ? (
              <strong key={index} className="fm-announcement-emphasis">
                {segment.text}
              </strong>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>
        {pages.length > 1 ? (
          <div className="fm-announcement-pagination">
            <div className="fm-announcement-pages" role="group" aria-label="Announcement pages">
              {pages.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className="fm-announcement-page"
                  aria-label={`Show page ${index + 1}: ${item.title}`}
                  aria-current={index === pageIndex ? "true" : undefined}
                  onClick={() => selectPage(index)}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
            <button
              ref={playbackRef}
              type="button"
              aria-label={playing ? "Pause announcements" : "Play announcements"}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? "Pause" : "Play"}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="fm-announcement-action"
          onClick={() => {
            if (lastPage) dismiss(page.action);
            else selectPage(pageIndex + 1);
          }}
        >
          {lastPage ? page.actionLabel : "Next"}
        </button>
      </div>
    </div>
  );
}
