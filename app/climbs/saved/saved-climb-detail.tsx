"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import {
  readSavedClimbs,
  type SavedClimb,
} from "../saved-climbs";

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

  useEffect(() => {
    try {
      const savedClimb = readSavedClimbs(window.localStorage).find(
        (item) => item.id === climbId,
      );
      // Browser storage is the external source for this prototype detail.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClimb(savedClimb ?? null);
    } catch {
      setClimb(null);
    }
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
          <p>This climb may have been set in a different browser or device.</p>
          <a className="primary-button" href="/climbs">
            View Climbs
          </a>
        </div>
      </DetailShell>
    );
  }

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
          <img
            className="wall-photo"
            src="/wall-prototype.png"
            alt="A plywood home climbing wall covered with colorful holds"
            width="1086"
            height="1448"
          />
          {climb.holds.map((hold, index) => (
            <span
              aria-hidden="true"
              className={`hold-marker hold-marker--${hold.role}`}
              key={`${hold.x}-${hold.y}-${index}`}
              style={{
                left: `${hold.x}%`,
                top: `${hold.y}%`,
                width: `${hold.size}%`,
              }}
            >
              {hold.role !== "hand" ? (
                <span className="hold-marker-label">
                  {hold.role === "start" ? "S" : "T"}
                </span>
              ) : null}
            </span>
          ))}
          <figcaption className="sr-only">
            {climb.name} starts at the green hold marked S, follows{" "}
            {climb.holds.filter((hold) => hold.role === "hand").length} blue-circled
            climbing holds, and finishes at the red hold marked T.
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
