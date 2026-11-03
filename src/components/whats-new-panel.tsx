"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  WHATS_NEW_KIND_LABELS,
  whatsNewReleases,
  type WhatsNewKind
} from "@/lib/whats-new/entries";
import { markWhatsNewSeen } from "@/lib/whats-new/use-whats-new-unseen";

type KindFilter = "all" | WhatsNewKind;

const FILTERS: ReadonlyArray<{ id: KindFilter; label: string }> = [
  { id: "all", label: "Vše" },
  { id: "new", label: WHATS_NEW_KIND_LABELS.new },
  { id: "improved", label: WHATS_NEW_KIND_LABELS.improved },
  { id: "fixed", label: WHATS_NEW_KIND_LABELS.fixed }
];

// WhatsNewPanel lists user-facing release notes grouped by release with a kind filter, and marks them as read for this user.
export function WhatsNewPanel({ userEmail }: { userEmail: string }) {
  const [filter, setFilter] = useState<KindFilter>("all");

  // Opening the page counts as reading it; the sidebar dot listens for this marker.
  useEffect(() => {
    markWhatsNewSeen(userEmail);
  }, [userEmail]);

  const visibleReleases = useMemo(
    () => whatsNewReleases
      .map((release) => ({
        ...release,
        items: release.items.filter((item) => filter === "all" || item.kind === filter)
      }))
      .filter((release) => release.items.length > 0),
    [filter]
  );

  return (
    <section className="whats-new-panel" data-utility-surface="whats-new" aria-label="Novinky">
      <header className="whats-new-header">
        <h1>Novinky</h1>
        <p>Co se ve Vosiu změnilo a kde to uvidíte.</p>
      </header>
      <div className="whats-new-filters ui-segmented" role="group" aria-label="Druh změny">
        {FILTERS.map((item) => (
          <button
            aria-pressed={filter === item.id}
            key={item.id}
            onClick={() => setFilter(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      {visibleReleases.length === 0 ? <p className="whats-new-empty">V této kategorii zatím nic není.</p> : null}
      {visibleReleases.map((release) => (
        <section className="whats-new-release" key={release.id} aria-labelledby={`whats-new-${release.id}`}>
          <h2 id={`whats-new-${release.id}`}>
            {release.label}
            <time>{release.date}</time>
          </h2>
          <ul>
            {release.items.map((item) => (
              <li className="whats-new-item" data-kind={item.kind} key={item.id}>
                <div className="whats-new-item-head">
                  <span className="whats-new-badge">{WHATS_NEW_KIND_LABELS[item.kind]}</span>
                  <strong>{item.title}</strong>
                </div>
                <p>{item.summary}</p>
                {item.detail ? (
                  <details>
                    <summary>Více podrobností</summary>
                    <p>{item.detail}</p>
                  </details>
                ) : null}
                {item.href ? (
                  <Link className="whats-new-link" href={item.href}>
                    Ukázat v aplikaci
                    <ArrowRight aria-hidden="true" size={15} />
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
