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
          ? "font-mono text-sm font-semibold text-auction-ember"
          : "font-mono text-2xl font-semibold text-auction-danger sm:text-3xl"
      }
    >
      {label}
    </span>
  );
}
