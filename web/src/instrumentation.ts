import type { Instrumentation } from "next";
import { formatRequestError } from "@/lib/monitoring";

// Server errors (RSC renders, route handlers) → one JSON line on stderr → Vercel runtime logs.
// No external provider; keep this synchronous and cheap.
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  console.error(JSON.stringify(formatRequestError(err, request, context)));
};
