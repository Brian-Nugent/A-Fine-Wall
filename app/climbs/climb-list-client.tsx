"use client";

import { useEffect, useState } from "react";
import { loadClimbs, saveClimb as saveClimbToApp } from "./climb-api";
import { climbs } from "./data";
import { readSavedClimbs, type SavedClimb } from "./saved-climbs";
import { loadWallHoldMap } from "./wall-holds";

function ClimbRow({
  climb,
  href,
}: {
  climb: Pick<SavedClimb, "name" | "grade" | "setter">;
  href: string;
}) {
  return (
    <li>
      <a className="climb-row" href={href}>
        <span className="climb-row-copy">
          <strong>{climb.name}</strong>
          <span>Set by {climb.setter}</span>
        </span>
        <span className="climb-row-meta">
          <strong>{climb.grade}</strong>
          <span aria-hidden="true">&rarr;</span>
        </span>
      </a>
    </li>
  );
}

export default function ClimbListClient() {
  const [savedClimbs, setSavedClimbs] = useState<SavedClimb[]>([]);

  useEffect(() => {
    let isActive = true;
    let browserClimbs: SavedClimb[] = [];

    try {
      browserClimbs = readSavedClimbs(window.localStorage);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSavedClimbs(browserClimbs);
    } catch {
      browserClimbs = [];
    }

    async function syncClimbs() {
      const wallMap = await loadWallHoldMap();
      await Promise.allSettled(
        browserClimbs.map((climb) =>
          saveClimbToApp(climb, wallMap.updatedAt),
        ),
      );
      const appClimbs = await loadClimbs();
      if (!isActive) return;

      const appIds = new Set(appClimbs.map((climb) => climb.id));
      setSavedClimbs([
        ...appClimbs,
        ...browserClimbs.filter((climb) => !appIds.has(climb.id)),
      ]);
    }

    syncClimbs().catch(() => {
      // Keep showing the browser copies when the shared store is unavailable.
    });

    return () => {
      isActive = false;
    };
  }, []);

  const totalClimbs = climbs.length + savedClimbs.length;

  return (
    <main className="app-page">
      <header className="list-header">
        <a className="small-brand" href="/">
          A Fine Wall
        </a>
        <div className="list-header-actions">
          <a className="wall-photo-link" href="/wall-photo">
            Wall Setup
          </a>
          <a className="set-climb-link" href="/set-climb">
            Set Climb
          </a>
        </div>
      </header>

      <section aria-labelledby="climbs-heading">
        <div className="section-heading">
          <h1 id="climbs-heading">Climbs</h1>
          <p aria-live="polite">{totalClimbs} climbs</p>
        </div>

        <ul className="climb-list">
          {savedClimbs.map((climb) => (
            <ClimbRow
              climb={climb}
              href={`/climbs/saved?id=${encodeURIComponent(climb.id)}`}
              key={`saved-${climb.id}`}
            />
          ))}
          {climbs.map((climb) => (
            <ClimbRow
              climb={climb}
              href={`/climbs/${climb.slug}`}
              key={climb.slug}
            />
          ))}
        </ul>
      </section>
    </main>
  );
}
