"use client";

import { useEffect, useState } from "react";
import { climbs } from "./data";
import {
  activeClimbFilterCount,
  buildFilteredHref,
  filterClimbs,
  hasActiveClimbFilters,
  type ClimbFilters,
} from "./climb-filters";
import type { SavedClimb } from "./saved-climbs";
import { loadSyncedClimbs } from "./synced-climbs";
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

export default function ClimbListClient({
  initialFilters,
}: {
  initialFilters: ClimbFilters;
}) {
  const { profile, changeUser } = useActiveUser();
  const [savedClimbs, setSavedClimbs] = useState<SavedClimb[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready">(
    "loading",
  );
  const [sharedLoadFailed, setSharedLoadFailed] = useState(false);

  useEffect(() => {
    if (!profile) return;

    const controller = new AbortController();
    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setLoadStatus("loading");
      setSharedLoadFailed(false);
    });

    void loadSyncedClimbs(profile, window.localStorage, controller.signal)
      .then((result) => {
        if (!isActive) return;
        setSavedClimbs(result.climbs);
        setSharedLoadFailed(result.sharedUnavailable);
        setLoadStatus("ready");
      })
      .catch(() => {
        if (!isActive) return;
        setSavedClimbs([]);
        setSharedLoadFailed(true);
        setLoadStatus("ready");
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [profile]);

  const filteredSavedClimbs = filterClimbs(savedClimbs, initialFilters);
  const filteredDemoClimbs = filterClimbs(climbs, initialFilters);
  const totalClimbs = climbs.length + savedClimbs.length;
  const visibleClimbs = filteredDemoClimbs.length + filteredSavedClimbs.length;
  const activeFilterCount = activeClimbFilterCount(initialFilters);
  const hasActiveFilters = hasActiveClimbFilters(initialFilters);
  const isLoadingClimbs = loadStatus === "loading";

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

      <section
        aria-busy={isLoadingClimbs ? "true" : undefined}
        aria-labelledby="climbs-heading"
      >
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
          <div className="section-heading-tools">
            <p aria-live="polite">
              {isLoadingClimbs
                ? "Loading climbs..."
                : hasActiveFilters
                ? `${visibleClimbs} of ${totalClimbs} climbs`
                : `${totalClimbs} climbs`}
            </p>
            <a
              className={`filter-link${hasActiveFilters ? " filter-link--active" : ""}`}
              href={buildFilteredHref("/climbs/filter", initialFilters)}
            >
              Filter
              {activeFilterCount > 0 ? (
                <span aria-label={`${activeFilterCount} active filter groups`}>
                  {activeFilterCount}
                </span>
              ) : null}
            </a>
          </div>
        </div>

        {sharedLoadFailed ? (
          <div className="climb-sync-notice" role="status">
            Showing climbs saved on this device. Shared climbs could not be
            refreshed.
          </div>
        ) : null}

        {visibleClimbs > 0 ? (
          <ul className="climb-list">
            {filteredSavedClimbs.map((climb) => (
              <ClimbRow
                climb={climb}
                href={buildFilteredHref(
                  "/climbs/saved",
                  initialFilters,
                  { id: climb.id },
                )}
                key={`saved-${climb.id}`}
              />
            ))}
            {filteredDemoClimbs.map((climb) => (
              <ClimbRow
                climb={climb}
                href={buildFilteredHref(
                  `/climbs/${climb.slug}`,
                  initialFilters,
                )}
                key={climb.slug}
              />
            ))}
          </ul>
        ) : null}

        {isLoadingClimbs ? (
          <div className="climb-filter-loading" role="status">
            Loading climbs&hellip;
          </div>
        ) : visibleClimbs === 0 ? (
          <div className="climb-filter-empty">
            <h2>No climbs match these filters</h2>
            <p>Try a wider grade range or remove a hold or author.</p>
            <a className="secondary-button" href="/climbs">
              Clear Filters
            </a>
          </div>
        ) : null}
      </section>
    </main>
  );
}
