"use client";

import { useEffect, useState } from "react";
import { loadClimb } from "../climb-api";
import {
  readSavedClimbs,
  type SavedClimb,
} from "../saved-climbs";
import {
  loadWallHolds,
  resolveSavedHold,
  type WallHold,
} from "../wall-holds";
import WallPhoto from "../wall-photo";

function DetailShell({ children, status }: { children: React.ReactNode; status: string }) {
  return (
    <main className="app-page detail-page">
      <header className="detail-header">
        <a className="back-link" href="/climbs">
          <span aria-hidden="true">&larr;</span>
          Climbs
        </a>
        <span>{status}</span>
      </header>
      {children}
    </main>
  );
}

export default function SavedClimbDetail({ climbId }: { climbId: string }) {
  const [climb, setClimb] = useState<SavedClimb | null | undefined>(undefined);
  const [wallHolds, setWallHolds] = useState<WallHold[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    let browserClimb: SavedClimb | null = null;

    try {
      browserClimb = readSavedClimbs(window.localStorage).find(
        (item) => item.id === climbId,
      ) ?? null;
    } catch {
      browserClimb = null;
    }

    loadClimb(climbId, controller.signal)
      .then((savedClimb) => setClimb(savedClimb ?? browserClimb))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setClimb(browserClimb);
      });

    loadWallHolds(controller.signal)
      .then(setWallHolds)
      .catch(() => {
        // Coordinate snapshots keep the climb view usable if spots are offline.
      });

    return () => controller.abort();
  }, [climbId]);

  if (climb === undefined) {
    return (
      <DetailShell status="Loading">
        <div className="empty-state">
          <p>Loading climb&hellip;</p>
        </div>
      </DetailShell>
    );
  }

  if (climb === null) {
    return (
      <DetailShell status="Not found">
        <div className="empty-state">
          <h1>Climb not found</h1>
          <p>This climb may have been removed or is temporarily unavailable.</p>
          <a className="primary-button" href="/climbs">
            View Climbs
          </a>
        </div>
      </DetailShell>
    );
  }

  const resolvedHolds = climb.holds.map((hold) =>
    resolveSavedHold(hold, wallHolds),
  );
  const startCount = resolvedHolds.filter((hold) => hold.role === "start").length;
  const handCount = resolvedHolds.filter((hold) => hold.role === "hand").length;
  const finishCount = resolvedHolds.filter((hold) => hold.role === "finish").length;

  return (
    <DetailShell status={climb.grade}>
      <section aria-labelledby="climb-name">
        <div className="detail-title">
          <div>
            <h1 id="climb-name">{climb.name}</h1>
            <p>Set by {climb.setter}</p>
          </div>
          <strong>{climb.grade}</strong>
        </div>

        <figure className="wall-map">
          <WallPhoto
            className="wall-photo"
            alt="Climbing wall with the route holds marked"
            width="1086"
            height="1448"
          />
          {resolvedHolds.map((hold, index) => (
            <span
              aria-hidden="true"
              className={`hold-marker hold-marker--${hold.role}`}
              key={hold.holdId || `${hold.x}-${hold.y}-${index}`}
              style={{
                left: `${hold.x}%`,
                top: `${hold.y}%`,
                width: `${hold.size}%`,
              }}
            />
          ))}
          <figcaption className="sr-only">
            {climb.name} uses {startCount} green-circled start{" "}
            {startCount === 1 ? "hold" : "holds"}, {handCount} blue-circled
            climbing {handCount === 1 ? "hold" : "holds"}, and {finishCount}{" "}
            red-circled finish {finishCount === 1 ? "hold" : "holds"}.
          </figcaption>
        </figure>

        <div className="hold-legend" aria-label="Hold marker legend">
          <span><i className="legend-dot legend-dot--start" />Start</span>
          <span><i className="legend-dot legend-dot--hand" />Climb</span>
          <span><i className="legend-dot legend-dot--finish" />Finish</span>
        </div>
      </section>
    </DetailShell>
  );
}
