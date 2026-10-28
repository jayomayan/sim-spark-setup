import type { ReactNode } from "react";

export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">{kicker}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
      </div>
      {children}
    </div>
  );
}

export const meta = (title: string, description: string) => ({
  meta: [
    { title: `${title} — Field Ops Console` },
    { name: "description", content: description },
    { property: "og:title", content: `${title} — Field Ops Console` },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ],
});
