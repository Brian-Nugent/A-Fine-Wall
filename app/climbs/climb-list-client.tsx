"use client";

import { useEffect, useState } from "react";
import {
  climbActivityKey,
  formatAverageRating,
  type ClimbActivity,
} from "./climb-activity";
import { climbs } from "./data";
import {
  activeClimbFilterCount,
  buildFilteredHref,
  filterClimbs,
  hasActiveClimbFilters,
  type ClimbFilters,
} from "./climb-filters";
import { getClimbListState } from "./climb-list-state";
import type { SavedClimb } from "./saved-climbs";
import { loadClimbActivities } from "./send-api";
import { loadSyncedClimbs } from "./synced-climbs";
import { useActiveUser } from "../user-profile-provider";

function ClimbRow({
  activity,
  activityStatus,
  climb,
  href,
}: {
  activity: ClimbActivity | null;
  activityStatus: "loading" | "ready" | "error";
  climb: Pick<SavedClimb, "name" | "grade" | "setter">;
  href: string;
}) {
  let ratingLabel = "Rating loading";
  let ratingContent = (
    <>
      <span aria-hidden="true">&#9733;</span> &mdash;
    </>
  );
  if (activityStatus === "error") {
    ratingLabel = "Rating unavailable";
    ratingContent = <>Rating unavailable</>;
  } else if (activityStatus === "ready" && activity) {
    const average = formatAverageRating(activity.averageRating);
    ratingLabel = `Average rating ${average} out of 5 from ${activity.ratingCount} ${activity.ratingCount === 1 ? "rating" : "ratings"}`;
    ratingContent = (
      <>
        <span aria-hidden="true">&#9733;</span> {average} ({activity.ratingCount})
      </>
    );
  } else if (activityStatus === "ready") {
    ratingLabel = "No ratings yet";
    ratingContent = (
      <>
        <span aria-hidden="true">&#9734;</span> No ratings
      </>
    );
  }

  return (
    <li>
      <a className="climb-row" href={href}>
        <span className="climb-row-copy">
          <strong>
            <span className="climb-name-text">{climb.name}</span>
            {activity?.userRating ? (
              <span
                aria-label="Sent by you"
                className="sent-check"
                title="Sent by you"
              >
                <span aria-hidden="true">&#10003;</span>
              </span>
            ) : null}
          </strong>
          <span className="climb-row-subline">
            <span className="climb-row-setter">Set by {climb.setter}</span>
            <span aria-hidden="true">&middot;</span>
            <span aria-label={ratingLabel} className="climb-row-rating">
              {ratingContent}
            </span>
          </span>
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
  const [activityState, setActivityState] = useState<{
    profileId: string | null;
    status: "loading" | "ready" | "error";
    activities: ClimbActivity[];
  }>({ profileId: null, status: "loading", activities: [] });

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

  useEffect(() => {
    if (!profile) return;
    const controller = new AbortController();
    let isActive = true;

    void loadClimbActivities(profile.id, controller.signal)
      .then((activities) => {
        if (!isActive) return;
        setActivityState({
          profileId: profile.id,
          status: "ready",
          activities,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!isActive) return;
        setActivityState({
          profileId: profile.id,
          status: "error",
          activities: [],
        });
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
  const listState = getClimbListState({
    hasActiveFilters,
    isLoading: isLoadingClimbs,
    totalClimbs,
    visibleClimbs,
  });
  const activityStatus =
    activityState.profileId === profile?.id
      ? activityState.status
      : "loading";
  const activitiesByClimb = new Map(
    (activityStatus === "ready" ? activityState.activities : []).map(
      (activity) => [climbActivityKey(activity), activity],
    ),
  );

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

        {activityStatus === "error" ? (
          <div className="climb-rating-notice" role="status">
            Ratings could not be loaded. The climb list is still available.
          </div>
        ) : null}

        {visibleClimbs > 0 ? (
          <ul className="climb-list">
            {filteredSavedClimbs.map((climb) => (
              <ClimbRow
                activity={
                  activitiesByClimb.get(
                    climbActivityKey({
                      climbKind: "saved",
                      climbId: climb.id,
                    }),
                  ) ?? null
                }
                activityStatus={activityStatus}
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
                activity={
                  activitiesByClimb.get(
                    climbActivityKey({
                      climbKind: "demo",
                      climbId: climb.slug,
                    }),
                  ) ?? null
                }
                activityStatus={activityStatus}
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

        {listState === "loading" ? (
          <div className="climb-filter-loading" role="status">
            Loading climbs&hellip;
          </div>
        ) : listState === "empty" ? (
          <div className="climb-filter-empty">
            <h2>No climbs yet</h2>
            <p>Set the first climb on this wall to get started.</p>
            <a className="primary-button" href="/set-climb">
              Set Climb
            </a>
          </div>
        ) : listState === "filtered-empty" ? (
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
