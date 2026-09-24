"use client";

export default function DirectoryError({ retry }: { retry: () => void }) {
  return <section className="mx-auto max-w-6xl px-4 py-16" role="alert">
    <meta name="robots" content="noindex, nofollow" />
    <h1 className="text-3xl font-semibold">Directory temporarily unavailable</h1>
    <p className="mt-3 text-muted">We could not load the listings. Please try again later. No sample results have been substituted.</p>
    <button onClick={() => retry()} className="mt-6 rounded-md border border-line px-4 py-2">Try again</button>
  </section>;
}
