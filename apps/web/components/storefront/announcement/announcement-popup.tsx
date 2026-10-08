"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FreshMarketsMark } from "../../brand/freshmarkets-mark";
import { welcomeAnnouncementPages } from "./announcement-campaign";
import { DELIVERY_LOCATION_REQUEST_EVENT } from "../../../lib/storefront/browsing-location";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../../ui/dialog";
import "./announcement-popup.css";

export function AnnouncementPopup() {
  const pages = welcomeAnnouncementPages();
  const [pageIndex, setPageIndex] = useState(0);
  const [open, setOpen] = useState(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeDestinationRef = useRef<"home" | "catalog" | "delivery-address">("home");
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const page = pages[pageIndex];

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setMotionAllowed(!motion.matches);
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

  const autoplay = open && motionAllowed && !hovered && !focused && visible;
  useEffect(() => {
    if (!autoplay || pages.length < 2) return;
    const timer = window.setTimeout(
      () => setPageIndex((index) => (index + 1) % pages.length),
      6_000,
    );
    return () => window.clearTimeout(timer);
  }, [autoplay, pageIndex, pages.length]);

  function selectPage(index: number) {
    setPageIndex(index);
    requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
  }

  function dismiss(destination: "home" | "catalog" | "delivery-address") {
    closeDestinationRef.current = destination;
    setOpen(false);
  }

  function restoreFocus() {
    const destination = closeDestinationRef.current;
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="fm-announcement-dialog"
        overlayClassName="fm-announcement-overlay"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          headingRef.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        onFocusCapture={(event) => setFocused(event.target instanceof HTMLButtonElement)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
      >
        <DialogTitle className="sr-only">FreshMarkets welcome</DialogTitle>
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
          {pages.length > 1 ? (
            <div role="group" aria-label="Announcement pages">
              <button
                type="button"
                className="fm-announcement-arrow fm-announcement-previous"
                aria-label="Previous announcement page"
                onClick={() => selectPage((pageIndex - 1 + pages.length) % pages.length)}
              >
                <ChevronLeft aria-hidden="true" size={22} />
              </button>
              <button
                type="button"
                className="fm-announcement-arrow fm-announcement-next"
                aria-label="Next announcement page"
                onClick={() => selectPage((pageIndex + 1) % pages.length)}
              >
                <ChevronRight aria-hidden="true" size={22} />
              </button>
            </div>
          ) : null}
        </div>
        <div className="fm-announcement-content">
          <div className="fm-announcement-copy">
            <div className="fm-announcement-page">
              <h2 id="fm-announcement-heading" ref={headingRef} tabIndex={-1}>
                {page.title}
              </h2>
              <DialogDescription className="fm-announcement-body">
                {page.body.map((segment, index) =>
                  segment.emphasis ? (
                    <strong key={index} className="fm-announcement-emphasis">
                      {segment.text}
                    </strong>
                  ) : (
                    <span key={index}>{segment.text}</span>
                  ),
                )}
              </DialogDescription>
            </div>
            {pages.map((announcement) => (
              <div key={announcement.id} className="fm-announcement-page" aria-hidden="true">
                <h2>{announcement.title}</h2>
                <p className="fm-announcement-body">
                  {announcement.body.map((segment, index) =>
                    segment.emphasis ? (
                      <strong key={index} className="fm-announcement-emphasis">
                        {segment.text}
                      </strong>
                    ) : (
                      <span key={index}>{segment.text}</span>
                    ),
                  )}
                </p>
              </div>
            ))}
          </div>
          {pages.length > 1 ? (
            <div
              className="fm-announcement-pagination"
              role="group"
              aria-label="Choose announcement page"
            >
              {pages.map((announcement, index) => (
                <button
                  key={announcement.id}
                  type="button"
                  className="fm-announcement-dot"
                  aria-label={`Show announcement page ${index + 1}`}
                  aria-current={index === pageIndex ? "true" : undefined}
                  onClick={() => selectPage(index)}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
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
      </DialogContent>
    </Dialog>
  );
}
