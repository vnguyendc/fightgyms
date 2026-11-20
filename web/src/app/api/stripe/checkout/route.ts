import { sameOrigin } from "@/lib/auth";
import { getGymCard } from "@/lib/data";
import { checkoutConfig, slugOrNull } from "@/lib/featured";
import { readBody } from "@/lib/forms";
import { SITE, runtimePolicy } from "@/lib/site";
import { stripeClient } from "@/lib/stripe";

const see = (path: string) => Response.redirect(new URL(path, SITE.url), 303);

/**
 * "Get featured" form target. Opens a Stripe Checkout subscription for one real gym and redirects there.
 * The gym slug rides on the session and the subscription so every later webhook can find the gym.
 * Without Stripe config it sends the visitor to /for-gyms, which shows the email contact instead.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused." }, { status: 403 });
  const body = await readBody(request);
  if (body === null) return Response.json({ error: "Request too large." }, { status: 413 });
  const slug = slugOrNull(body.gym);
  if (!slug) return Response.json({ error: "Invalid gym." }, { status: 400 });
  const config = checkoutConfig();
  if (!config || runtimePolicy().mode !== "live") return see("/for-gyms");
  const gym = await getGymCard(slug).catch(() => null);
  if (!gym) return Response.json({ error: "Gym not found." }, { status: 404 });
  try {
    const session = await stripeClient(config.secretKey).checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: config.priceId, quantity: 1 }],
      client_reference_id: gym.slug,
      metadata: { gym_slug: gym.slug },
      subscription_data: { metadata: { gym_slug: gym.slug }, description: `Featured listing: ${gym.name}`.slice(0, 500) },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      success_url: new URL("/for-gyms/thanks", SITE.url).href,
      cancel_url: new URL(`/gym/${gym.slug}`, SITE.url).href,
    });
    if (!session.url) throw new Error("no checkout url");
    return Response.redirect(session.url, 303);
  } catch {
    console.warn("featured checkout not created");
    return see("/for-gyms");
  }
}
