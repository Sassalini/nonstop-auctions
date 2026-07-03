import type { ReactNode } from "react";

type InteriorShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
};

export function InteriorShell({ eyebrow, title, description, children }: InteriorShellProps) {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <div className="mb-8 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-auction-gold">
          {eyebrow}
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-auction-ivory sm:text-4xl">
          {title}
        </h1>
        <p className="mt-4 text-base leading-7 text-auction-muted">{description}</p>
      </div>
      {children}
    </main>
  );
}
