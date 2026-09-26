import type { Instrumentation } from "next";

type RequestInfo = Parameters<Instrumentation.onRequestError>[1];
type RequestContext = Parameters<Instrumentation.onRequestError>[2];

export type RequestErrorLine = {
  level: "error";
  event: "request_error";
  message: string;
  name: string;
  digest?: string;
  stack?: string;
  method: string;
  path: string;
  route: string;
  routerKind: RequestContext["routerKind"];
  routeType: RequestContext["routeType"];
  renderSource?: RequestContext["renderSource"];
  revalidateReason?: RequestContext["revalidateReason"];
};

const MAX_STACK = 2000;

/**
 * One flat JSON line per server error, for Vercel runtime logs / observability. Deliberately excludes
 * request headers (cookies, client IPs) and the query string; the digest matches the reference shown by
 * the error boundary so a user report can be tied back to the failing request.
 */
export function formatRequestError(err: unknown, request: RequestInfo, context: RequestContext): RequestErrorLine {
  const error = err instanceof Error ? err : undefined;
  const digest = typeof err === "object" && err !== null && "digest" in err && err.digest != null ? String(err.digest) : undefined;
  return {
    level: "error",
    event: "request_error",
    message: error ? error.message : String(err),
    name: error ? error.name : typeof err,
    digest,
    stack: error?.stack ? error.stack.slice(0, MAX_STACK) : undefined,
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    routerKind: context.routerKind,
    routeType: context.routeType,
    renderSource: context.renderSource,
    revalidateReason: context.revalidateReason,
  };
}
