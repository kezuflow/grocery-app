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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const page = pages[pageIndex];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    // The open attribute supplies the initial server-rendered visual gate.
    // Promote it to a native modal as soon as the client hydrates.
    if (dialog.open) dialog.close();
    dialog.showModal();
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [pageIndex]);

  function dismiss(destination: "home" | "catalog" | "delivery-address") {
    dialogRef.current?.close();
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
    <>
      <div className="fm-announcement-overlay" aria-hidden="true" />
      <dialog
        ref={dialogRef}
        open
        aria-labelledby="fm-announcement-heading"
        aria-describedby="fm-announcement-body"
        className="fm-announcement-dialog"
        onCancel={(event) => {
          event.preventDefault();
          dismiss("home");
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
              <span>{`${pageIndex + 1} of ${pages.length}`}</span>
              {pageIndex > 0 ? (
                <button type="button" onClick={() => setPageIndex(pageIndex - 1)}>
                  Back
                </button>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className="fm-announcement-action"
            onClick={() => {
              if (lastPage) dismiss(page.action);
              else setPageIndex(pageIndex + 1);
            }}
          >
            {lastPage ? page.actionLabel : "Next"}
          </button>
        </div>
      </dialog>
    </>
  );
}
