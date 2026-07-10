"use client";

import { useState } from "react";
import type { Lot } from "@/lib/auction-data";

type LotTabsProps = {
  lot: Lot;
};

const tabLabels = ["Description", "Condition Report", "Shipping & Info"] as const;

export function LotTabs({ lot }: LotTabsProps) {
  const [activeTab, setActiveTab] = useState<(typeof tabLabels)[number]>("Description");

  const content = {
    Description: lot.description,
    "Condition Report": lot.conditionReport,
    "Shipping & Info": lot.shippingInfo,
  }[activeTab];

  return (
    <section className="rounded-lg border border-white/10 bg-black/[0.68] backdrop-blur-sm">
      <div className="flex gap-1 overflow-x-auto border-b border-white/10 px-3 pt-3">
        {tabLabels.map((label) => {
          const isActive = activeTab === label;
          return (
            <button
              key={label}
              type="button"
              onClick={() => setActiveTab(label)}
              className={`min-h-11 shrink-0 border-b px-3 text-sm transition ${
                isActive
                  ? "border-auction-gold text-auction-ivory"
                  : "border-transparent text-auction-muted hover:text-auction-ivory"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="space-y-3 p-4 text-sm leading-7 text-auction-muted sm:p-5">
        <p>{content}</p>
        <button
          type="button"
          className="text-sm font-medium text-auction-gold transition hover:text-auction-goldSoft"
        >
          Read More
        </button>
      </div>
    </section>
  );
}
