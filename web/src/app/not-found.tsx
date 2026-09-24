import Link from "next/link";
export default function NotFound() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold">Not found</h1>
      <p className="text-muted mt-2">That gym or city isn&apos;t listed yet.</p>
      <Link href="/gyms" className="mt-6 inline-block underline">Browse cities</Link>
    </div>
  );
}
