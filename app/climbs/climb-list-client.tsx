"use client";

import { useEffect, useState } from "react";
import { climbs } from "./data";
import { readSavedClimbs, type SavedClimb } from "./saved-climbs";

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
    try {
      // Browser storage is the external source for this prototype list.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSavedClimbs(readSavedClimbs(window.localStorage));
    } catch {
      setSavedClimbs([]);
    }
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
            Wall Photo
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
