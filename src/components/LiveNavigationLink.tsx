"use client";
import Link from "next/link";
import { useLiveAudience } from "@/components/LiveAudienceProvider";

export function LiveNavigationLink({ className, onClick }: { className?: string; onClick?: () => void }) {
  const { liveHref } = useLiveAudience();
  return <Link href={liveHref} prefetch={false} onClick={onClick} className={className}>Live</Link>;
}
