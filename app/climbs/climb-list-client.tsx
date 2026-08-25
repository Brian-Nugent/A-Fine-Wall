"use client";

import { useEffect, useState } from "react";
import {
  ClimbRequestError,
  loadClimbs,
  saveClimb as saveClimbToApp,
} from "./climb-api";
import { climbs } from "./data";
import {
  attributeSavedClimb,
  persistSavedClimbs,
  readSavedClimbs,
  removeSavedClimb,
  type AttributedSavedClimb,
  type SavedClimb,
} from "./saved-climbs";
import { loadWallHoldMap } from "./wall-holds";
import { useActiveUser } from "../user-profile-provider";

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
  const { profile, changeUser } = useActiveUser();
  const [savedClimbs, setSavedClimbs] = useState<SavedClimb[]>([]);

  useEffect(() => {
    if (!profile) return;

    let isActive = true;
    let browserClimbs: AttributedSavedClimb[] = [];

    try {
      const storedClimbs = readSavedClimbs(window.localStorage);
      browserClimbs = storedClimbs.map((climb) =>
        attributeSavedClimb(climb, profile),
      );
      if (browserClimbs.some((climb, index) => climb !== storedClimbs[index])) {
        persistSavedClimbs(window.localStorage, browserClimbs);
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSavedClimbs(browserClimbs);
    } catch {
      browserClimbs = [];
    }

    async function syncClimbs() {
      const wallMap = await loadWallHoldMap();
      const syncResults = await Promise.allSettled(
        browserClimbs.map((climb) =>
          saveClimbToApp(climb, wallMap.updatedAt, climb.profileId),
        ),
      );
      const deletedBrowserIds = new Set(
        browserClimbs.flatMap((climb, index) => {
          const result = syncResults[index];
          return result.status === "rejected" &&
            result.reason instanceof ClimbRequestError &&
            result.reason.status === 410
            ? [climb.id]
            : [];
        }),
      );
      for (const climbId of deletedBrowserIds) {
        try {
          removeSavedClimb(window.localStorage, climbId);
        } catch {
          // The durable tombstone still prevents this copy from returning.
        }
      }

      const appClimbs = await loadClimbs();
      if (!isActive) return;

      const appIds = new Set(appClimbs.map((climb) => climb.id));
      setSavedClimbs([
        ...appClimbs,
        ...browserClimbs.filter(
          (climb) =>
            !appIds.has(climb.id) && !deletedBrowserIds.has(climb.id),
        ),
      ]);
    }

    syncClimbs().catch(() => {
      // Keep showing the browser copies when the shared store is unavailable.
    });

    return () => {
      isActive = false;
    };
  }, [profile]);

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
          <div className="section-heading-copy">
            <h1 id="climbs-heading">Climbs</h1>
            <button
              aria-label={`Change user. Current user: ${profile?.name ?? "not selected"}`}
              className="user-switch-button"
              onClick={changeUser}
              type="button"
            >
              Using {profile?.name ?? "no user"}
            </button>
          </div>
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
