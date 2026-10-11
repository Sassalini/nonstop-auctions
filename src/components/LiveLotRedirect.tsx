"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLiveAudience } from "@/components/LiveAudienceProvider";

export function LiveLotRedirect() {
  const router = useRouter();
  const { liveHref } = useLiveAudience();
  useEffect(() => { if (liveHref !== "/live") router.replace(liveHref); }, [liveHref, router]);
  return null;
}
