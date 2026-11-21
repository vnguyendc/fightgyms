/** Plain form post, so it works without client JS. The route answers with a 303 to Stripe Checkout. */
export function GetFeaturedButton({ slug, className = "" }: { slug: string; className?: string }) {
  return (
    <form action="/api/stripe/checkout" method="post" className={className}>
      <input type="hidden" name="gym" value={slug} />
      <button type="submit" className="rounded-md bg-accent px-4 py-2 font-medium text-white">Get featured</button>
    </form>
  );
}
