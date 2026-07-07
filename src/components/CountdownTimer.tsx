"use client";

import { useEffect, useMemo, useState } from "react";

type CountdownTimerProps = {
  initialSeconds: number;
  compact?: boolean;
};

function formatSeconds(totalSeconds: number) {
  const safeSeconds = Math.max(totalSeconds, 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export function CountdownTimer({ initialSeconds, compact = false }: CountdownTimerProps) {
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  const label = useMemo(() => formatSeconds(secondsLeft), [secondsLeft]);

  return (
    <span
      className={
        compact
          ? "inline-block whitespace-nowrap font-mono text-sm font-semibold leading-none tabular-nums text-auction-ember"
          : "inline-block min-w-[8.2ch] whitespace-nowrap font-mono text-[1.5rem] font-semibold leading-none tabular-nums text-auction-danger sm:text-[1.75rem] lg:text-[1.6rem] xl:text-[1.45rem] 2xl:text-[1.55rem]"
      }
    >
      {label}
    </span>
  );
}
