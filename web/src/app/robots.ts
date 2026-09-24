import type { MetadataRoute } from "next";
import { SITE, runtimePolicy } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  // Allow crawling of noindex pages so crawlers can observe the directive.
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    ...(runtimePolicy().indexable ? { sitemap: `${SITE.url}/sitemap.xml` } : {}) };
}
