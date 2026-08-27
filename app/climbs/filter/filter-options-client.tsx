"use client";

import { useEffect, useMemo, useState } from "react";
import { useActiveUser } from "../../user-profile-provider";
import {
  activeClimbFilterCount,
  buildFilteredHref,
  DEFAULT_CLIMB_FILTERS,
  MAX_FILTER_GRADE,
  MAX_FILTER_STARS,
  MIN_FILTER_GRADE,
  matchesClimbActivityFilters,
  matchesClimbFilters,
  uniqueFilterAuthors,
  type ClimbFilters,
  type FilterableClimb,
} from "../climb-filters";
import {
  climbActivityKey,
  type ClimbActivity,
} from "../climb-activity";
import { climbs } from "../data";
import { loadClimbActivities } from "../send-api";
import { loadSyncedClimbs } from "../synced-climbs";

type AvailableClimb = {
  climb: FilterableClimb;
  key: string;
};

function isSameAuthor(left: string, right: string) {
  return (
    left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
  );
}

export default function FilterOptionsClient({
  initialFilters,
}: {
  initialFilters: ClimbFilters;
}) {
  const { profile } = useActiveUser();
  const [minGrade, setMinGrade] = useState(initialFilters.minGrade);
  const [maxGrade, setMaxGrade] = useState(initialFilters.maxGrade);
  const [authors, setAuthors] = useState(initialFilters.authors);
  const [holdIds, setHoldIds] = useState(initialFilters.holdIds);
  const [hideSent, setHideSent] = useState(initialFilters.hideSent);
  const [minStars, setMinStars] = useState(initialFilters.minStars);
  const [order, setOrder] = useState(initialFilters.order);
  const [availableClimbs, setAvailableClimbs] = useState<AvailableClimb[]>(
    climbs.map((climb) => ({ climb, key: `demo:${climb.slug}` })),
  );
  const [activities, setActivities] = useState<ClimbActivity[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const [loadedProfileId, setLoadedProfileId] = useState<string | null>(null);
  const [climbLoadFailed, setClimbLoadFailed] = useState(false);
  const [activityLoadFailed, setActivityLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!profile) return;

    const controller = new AbortController();
    let isActive = true;

    Promise.allSettled([
      loadSyncedClimbs(profile, window.localStorage, controller.signal),
      loadClimbActivities(profile.id, controller.signal),
    ]).then(([climbResult, activityResult]) => {
      if (!isActive) return;

      const syncedClimbs =
        climbResult.status === "fulfilled" ? climbResult.value.climbs : [];
      setAvailableClimbs([
        ...climbs.map((climb) => ({
          climb,
          key: `demo:${climb.slug}`,
        })),
        ...syncedClimbs.map((climb) => ({
          climb,
          key: `saved:${climb.id}`,
        })),
      ]);
      setActivities(
        activityResult.status === "fulfilled" ? activityResult.value : [],
      );
      setClimbLoadFailed(
        climbResult.status === "rejected" ||
          climbResult.value.sharedUnavailable,
      );
      setActivityLoadFailed(activityResult.status === "rejected");
      setLoadedProfileId(profile.id);
      setIsLoadingMatches(false);
    });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [profile, refreshKey]);

  const currentFilters = useMemo<ClimbFilters>(
    () => ({
      minGrade,
      maxGrade,
      authors,
      holdIds,
      hideSent,
      minStars,
      order,
    }),
    [authors, hideSent, holdIds, maxGrade, minGrade, minStars, order],
  );
  const authorOptions = uniqueFilterAuthors(
    availableClimbs.map(({ climb }) => climb.setter),
  );
  const activitiesByClimb = new Map(
    activities.map((activity) => [climbActivityKey(activity), activity]),
  );
  const matchingCount = availableClimbs.filter(
    (entry) =>
      matchesClimbFilters(entry.climb, currentFilters) &&
      matchesClimbActivityFilters(
        activitiesByClimb.get(entry.key) ?? null,
        currentFilters,
      ),
  ).length;
  const activeFilterCount = activeClimbFilterCount(currentFilters);
  const needsActivityData =
    hideSent || minStars > 0 || order === "ascents";
  const matchCountUnavailable =
    climbLoadFailed || (needsActivityData && activityLoadFailed);
  const isMatchCountLoading =
    isLoadingMatches || !profile || loadedProfileId !== profile.id;
  const applyButtonState = isMatchCountLoading
    ? "loading"
    : matchCountUnavailable
      ? "unavailable"
      : "ready";
  const applyButtonLabel = applyButtonState === "unavailable"
    ? "View Climbs"
    : `Show ${matchingCount}`;
  const applyButtonKey =
    applyButtonState === "ready"
      ? `${applyButtonState}-${matchingCount}`
      : applyButtonState;
  const applyButtonHref = buildFilteredHref("/climbs", currentFilters);

  function toggleAuthor(author: string) {
    setAuthors((current) =>
      current.some((item) => isSameAuthor(item, author))
        ? current.filter((item) => !isSameAuthor(item, author))
        : [...current, author],
    );
  }

  function resetFilters() {
    setMinGrade(DEFAULT_CLIMB_FILTERS.minGrade);
    setMaxGrade(DEFAULT_CLIMB_FILTERS.maxGrade);
    setAuthors([]);
    setHoldIds([]);
    setHideSent(DEFAULT_CLIMB_FILTERS.hideSent);
    setMinStars(DEFAULT_CLIMB_FILTERS.minStars);
    setOrder(DEFAULT_CLIMB_FILTERS.order);
  }

  function retrySharedData() {
    setIsLoadingMatches(true);
    setClimbLoadFailed(false);
    setActivityLoadFailed(false);
    setRefreshKey((current) => current + 1);
  }

  return (
    <main className="app-page filter-page">
      <header className="detail-header">
        <a
          className="back-link"
          href={buildFilteredHref("/climbs", initialFilters)}
        >
          <span aria-hidden="true">&larr;</span>
          Climbs
        </a>
        <span>Filter</span>
      </header>

      <div className="filter-scroll-region">
        <section className="filter-intro" aria-labelledby="filter-heading">
          <h1 id="filter-heading">Filter climbs</h1>
          <p>Narrow the list by grade, sends, stars, holds, and author.</p>
        </section>

        {climbLoadFailed || activityLoadFailed ? (
          <div className="filter-data-notice" role="status">
            <p>
              {climbLoadFailed && activityLoadFailed
                ? "Shared climbs, sends, and ratings could not be refreshed."
                : activityLoadFailed && needsActivityData
                  ? "Sends and ratings could not be loaded, so those options cannot be checked yet."
                  : climbLoadFailed
                    ? "Shared climb matches could not be checked."
                    : "Sends and ratings could not be refreshed."}
            </p>
            <button
              className="climb-reload-button"
              onClick={retrySharedData}
              type="button"
            >
              Retry
            </button>
          </div>
        ) : null}

        <section className="filter-section" aria-labelledby="grade-filter-heading">
          <div className="filter-section-heading">
            <div>
              <h2 id="grade-filter-heading">Grade range</h2>
              <p>Include climbs from V{minGrade} through V{maxGrade}.</p>
            </div>
            <strong>V{minGrade}&ndash;V{maxGrade}</strong>
          </div>

          <div className="grade-filter-control">
            <div className="grade-filter-label">
              <label htmlFor="minimum-grade">Minimum</label>
              <output htmlFor="minimum-grade">V{minGrade}</output>
            </div>
            <input
              aria-valuetext={`V${minGrade}`}
              id="minimum-grade"
              max={maxGrade}
              min={MIN_FILTER_GRADE}
              onChange={(event) => setMinGrade(Number(event.target.value))}
              type="range"
              value={minGrade}
            />
          </div>

          <div className="grade-filter-control">
            <div className="grade-filter-label">
              <label htmlFor="maximum-grade">Maximum</label>
              <output htmlFor="maximum-grade">V{maxGrade}</output>
            </div>
            <input
              aria-valuetext={`V${maxGrade}`}
              id="maximum-grade"
              max={MAX_FILTER_GRADE}
              min={minGrade}
              onChange={(event) => setMaxGrade(Number(event.target.value))}
              type="range"
              value={maxGrade}
            />
          </div>
        </section>

        <section className="filter-section" aria-labelledby="activity-filter-heading">
          <div className="filter-section-heading">
            <div>
              <h2 id="activity-filter-heading">Sends &amp; stars</h2>
            </div>
          </div>

          <div className="filter-toggle-choice">
            <input
              checked={hideSent}
              id="hide-sent-climbs"
              onChange={(event) => setHideSent(event.target.checked)}
              type="checkbox"
            />
            <label htmlFor="hide-sent-climbs">Hide climbs I have sent</label>
          </div>

          <label className="filter-select-control" htmlFor="minimum-stars">
            <span>Minimum community rating</span>
            <select
              id="minimum-stars"
              onChange={(event) => setMinStars(Number(event.target.value))}
              value={minStars}
            >
              <option value="0">Any number of stars</option>
              {Array.from({ length: MAX_FILTER_STARS }, (_, index) => index + 1).map(
                (stars) => (
                  <option key={stars} value={stars}>
                    At least {stars} {stars === 1 ? "star" : "stars"}
                  </option>
                ),
              )}
            </select>
          </label>
        </section>

        <section
          aria-labelledby="order-filter-heading"
          className="filter-section filter-order-section"
        >
          <h2 id="order-filter-heading">Order</h2>
          <div
            aria-labelledby="order-filter-heading"
            className="filter-order-choices"
            role="radiogroup"
          >
            <label className="filter-radio-choice">
              <input
                checked={order === "newest"}
                name="climb-order"
                onChange={() => setOrder("newest")}
                type="radio"
              />
              <span>Newest first</span>
            </label>
            <label className="filter-radio-choice">
              <input
                checked={order === "ascents"}
                name="climb-order"
                onChange={() => setOrder("ascents")}
                type="radio"
              />
              <span>Most ascents</span>
            </label>
          </div>
        </section>

        <section className="filter-section" aria-labelledby="hold-filter-heading">
          <div className="filter-section-heading">
            <div>
              <h2 id="hold-filter-heading">Holds</h2>
              <p>
                {holdIds.length === 0
                  ? "Any holds"
                  : `${holdIds.length} ${holdIds.length === 1 ? "hold" : "holds"} selected`}
              </p>
            </div>
            {holdIds.length > 0 ? (
              <button
                className="text-button"
                onClick={() => setHoldIds([])}
                type="button"
              >
                Clear
              </button>
            ) : null}
          </div>
          <a
            className="filter-hold-link"
            href={buildFilteredHref("/climbs/filter/holds", currentFilters)}
          >
            <span>{holdIds.length > 0 ? "Edit Holds" : "Choose Holds"}</span>
            <span aria-hidden="true">&rarr;</span>
          </a>
          <p className="filter-help">Matching climbs must use every selected hold.</p>
        </section>

        <section
          aria-labelledby="author-filter-heading"
          className="filter-section filter-author-section"
        >
          <h2 id="author-filter-heading">Setter</h2>
          <p className="filter-help">No selection includes every setter.</p>
          <div
            aria-labelledby="author-filter-heading"
            className="filter-author-list"
            role="group"
          >
            {authorOptions.map((author) => (
              <label className="filter-author-choice" key={author}>
                <input
                  checked={authors.some((item) => isSameAuthor(item, author))}
                  onChange={() => toggleAuthor(author)}
                  type="checkbox"
                />
                <span>{author}</span>
              </label>
            ))}
          </div>
        </section>
      </div>

      <div className="set-toolbar filter-toolbar">
        <div className="selection-status">
          <strong>
            {activeFilterCount === 0
              ? "All climbs"
              : `${activeFilterCount} active`}
          </strong>
          <span aria-live="polite">
            {isMatchCountLoading
              ? "Checking matches..."
              : matchCountUnavailable
                ? "Match count unavailable"
                : `${matchingCount} ${matchingCount === 1 ? "match" : "matches"}`}
          </span>
        </div>
        <div className="set-toolbar-actions">
          <button
            className="text-button"
            disabled={activeFilterCount === 0}
            onClick={resetFilters}
            type="button"
          >
            Reset
          </button>
          {applyButtonState === "loading" ? (
            <a
              aria-busy="true"
              aria-label="View climbs; checking matches"
              className="compact-primary-button filter-apply-button"
              href={applyButtonHref}
              key={applyButtonKey}
            >
              <svg
                aria-hidden="true"
                className="filter-apply-spinner"
                focusable="false"
                viewBox="0 0 24 24"
              >
                <circle
                  className="filter-apply-spinner-track"
                  cx="12"
                  cy="12"
                  pathLength="100"
                  r="9"
                />
                <circle
                  className="filter-apply-spinner-indicator"
                  cx="12"
                  cy="12"
                  pathLength="100"
                  r="9"
                />
              </svg>
            </a>
          ) : (
            <a
              className="compact-primary-button filter-apply-button"
              href={applyButtonHref}
              key={applyButtonKey}
            >
              {applyButtonLabel}
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
