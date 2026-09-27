import type { NextConfig } from "next";

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;

// Baseline browser hardening; no CSP yet because inline JSON-LD and Next's runtime would need nonces first.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
  images: {
    // gym photos live in the public gym-photos bucket; sample data ships under /public/sample
    remotePatterns: supabase ? [new URL(`${supabase}/storage/v1/object/public/gym-photos/**`)] : [],
  },
};

export default nextConfig;
