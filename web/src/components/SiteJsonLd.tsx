import { SITE, jsonLd } from "@/lib/site";

/** Publisher identity and the sitelinks search target. Nothing here depends on directory data. */
export default function SiteJsonLd() {
  const orgId = `${SITE.url}/#organization`;
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": orgId, name: SITE.name, url: SITE.url },
      {
        "@type": "WebSite",
        "@id": `${SITE.url}/#website`,
        name: SITE.name,
        url: SITE.url,
        description: SITE.description,
        publisher: { "@id": orgId },
        potentialAction: { "@type": "SearchAction", target: `${SITE.url}/search?q={search_term_string}`, "query-input": "required name=search_term_string" },
      },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(graph) }} />;
}
