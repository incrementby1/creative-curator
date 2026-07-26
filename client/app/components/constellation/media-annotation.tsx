"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { MediaObjectUrl } from "../../lib/projects-api";

export function MediaAnnotation({ alt, load }: { alt: string; load: () => Promise<MediaObjectUrl> }) {
  const [handle, setHandle] = useState<MediaObjectUrl | null>(null);
  useEffect(() => {
    let mounted = true;
    let owned: MediaObjectUrl | null = null;
    void load().then((next) => {
      owned = next;
      if (mounted) setHandle(next); else next.revoke();
    }).catch(() => undefined);
    return () => { mounted = false; owned?.revoke(); };
  }, [load]);
  return handle ? <Image alt={alt} draggable="false" fill sizes="180px" src={handle.url} unoptimized /> : <span role="status">Loading media…</span>;
}
