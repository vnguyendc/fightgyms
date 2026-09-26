import Image from "next/image";
import { photoUrl } from "@/lib/data";
import { STYLE_LABEL, type Style } from "@/lib/types";

/** Fills its (relatively positioned, sized) parent. */
export function GymPhoto({
  path,
  alt,
  sizes,
  priority = false,
}: {
  path: string;
  alt: string;
  sizes: string;
  priority?: boolean;
}) {
  return <Image src={photoUrl(path)} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />;
}

/** Shown in place of a thumbnail when a gym has no photo yet. */
export function PhotoFallback({ styles }: { styles: Style[] }) {
  const label = styles[0] ? STYLE_LABEL[styles[0]] : "Gym";
  return (
    <div className="flex h-full w-full items-end bg-gradient-to-br from-panel via-bg to-panel p-3">
      <span className="font-mono text-xs uppercase tracking-wider text-muted/60">{label}</span>
    </div>
  );
}
