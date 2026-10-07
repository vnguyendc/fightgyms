/** Public correction requests are retired. Historical submissions remain available to reviewers. */
export async function POST(request: Request) {
  void request; // deliberately do not parse retired request bodies
  return Response.json({ error: "Public corrections are retired. Verified gym representatives can edit their listing from /claim." }, { status: 410 });
}
