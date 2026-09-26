import type { NextConfig } from "next";

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;

const nextConfig: NextConfig = {
  images: {
    // gym photos live in the public gym-photos bucket; sample data ships under /public/sample
    remotePatterns: supabase ? [new URL(`${supabase}/storage/v1/object/public/gym-photos/**`)] : [],
  },
};

export default nextConfig;
