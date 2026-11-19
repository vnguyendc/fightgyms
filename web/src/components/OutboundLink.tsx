"use client";

import type { ClickLink } from "@/lib/clicks";

/** Records the click, then lets the browser follow the link. Tracking never blocks the visit. */
export default function OutboundLink({
  href, slug, type, className, children, external = false,
}: {
  href: string;
  slug: string;
  type: ClickLink;
  className?: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  function track() {
    const body = new URLSearchParams({ slug, type });
    try {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") navigator.sendBeacon("/api/clicks", body);
      else void fetch("/api/clicks", { method: "POST", body, keepalive: true });
    } catch { /* the visit still proceeds */ }
  }
  return external ? (
    <a href={href} rel="nofollow noopener" target="_blank" className={className} onClick={track}>{children}</a>
  ) : (
    <a href={href} className={className} onClick={track}>{children}</a>
  );
}
