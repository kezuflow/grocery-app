"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FreshMarketsMark } from "../../brand/freshmarkets-mark";
import { welcomeAnnouncementPages } from "./announcement-campaign";
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
    if (pageIndex > 0) headingRef.current?.focus({ preventScroll: true });
  }, [pageIndex]);

  function dismiss(shop: boolean) {
    dialogRef.current?.close();
    setOpen(false);
    requestAnimationFrame(() => {
      const destination = shop
        ? document.getElementById("catalog")
        : document.querySelector<HTMLAnchorElement>('header a[href="/"]');
      if (destination instanceof HTMLElement) {
        if (shop) destination.setAttribute("tabindex", "-1");
        destination.focus({ preventScroll: true });
        if (shop)
          destination.scrollIntoView({
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
          dismiss(false);
        }}
      >
        <div className="fm-announcement-topbar">
          <button
            type="button"
            className="fm-announcement-close"
            aria-label="Close welcome announcement"
            onClick={() => dismiss(false)}
          >
            <X aria-hidden="true" size={18} />
          </button>
          <div className="fm-announcement-brand" aria-label="FreshMarkets">
            <FreshMarketsMark className="size-6" />
            <span>freshmarkets</span>
          </div>
          <span className="fm-announcement-topbar-spacer" aria-hidden="true" />
        </div>
        <div className="fm-announcement-media">
          <img
            src="/announcements/welcome-market-scene.webp"
            alt="Smiling FreshMarkets shopper holding a branded produce bag in a supermarket"
            width={1536}
            height={1024}
            className="fm-announcement-scene"
          />
        </div>
        <div className="fm-announcement-content">
          <img
            src="/announcements/grass-mascot.png"
            alt=""
            aria-hidden="true"
            width={1254}
            height={1254}
            className="fm-announcement-mascot"
          />
          <h2 id="fm-announcement-heading" ref={headingRef} tabIndex={-1}>
            {page.title}
          </h2>
          <p id="fm-announcement-body" className="fm-announcement-body">
            {page.body}
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
              if (lastPage) dismiss(true);
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
