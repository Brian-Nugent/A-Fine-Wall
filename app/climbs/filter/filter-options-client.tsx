"use client";

import { useEffect, useMemo, useState } from "react";
import { loadUserProfiles } from "../../user-api";
import { useActiveUser } from "../../user-profile-provider";
import {
  activeClimbFilterCount,
  buildFilteredHref,
  DEFAULT_CLIMB_FILTERS,
  filterClimbs,
  MAX_FILTER_GRADE,
  MIN_FILTER_GRADE,
  uniqueFilterAuthors,
  type ClimbFilters,
  type FilterableClimb,
} from "../climb-filters";
import { climbs } from "../data";
import { loadSyncedClimbs } from "../synced-climbs";

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
  const [availableClimbs, setAvailableClimbs] = useState<FilterableClimb[]>(
    climbs,
  );
  const [loadedAuthors, setLoadedAuthors] = useState<string[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const [climbLoadFailed, setClimbLoadFailed] = useState(false);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!profile) return;

    const controller = new AbortController();
    let isActive = true;

    Promise.allSettled([
      loadSyncedClimbs(profile, window.localStorage, controller.signal),
      loadUserProfiles(controller.signal),
    ]).then(([climbResult, profileResult]) => {
      if (!isActive) return;

      const syncedClimbs =
        climbResult.status === "fulfilled" ? climbResult.value.climbs : [];
      const profiles =
        profileResult.status === "fulfilled" ? profileResult.value : [];
      setAvailableClimbs([...climbs, ...syncedClimbs]);
      setLoadedAuthors([
        ...profiles.map((item) => item.name),
        ...syncedClimbs.map((climb) => climb.setter),
      ]);
      setClimbLoadFailed(
        climbResult.status === "rejected" ||
          climbResult.value.sharedUnavailable,
      );
      setProfileLoadFailed(profileResult.status === "rejected");
      setIsLoadingMatches(false);
    });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [profile, refreshKey]);

  const currentFilters = useMemo<ClimbFilters>(
    () => ({ minGrade, maxGrade, authors, holdIds }),
    [authors, holdIds, maxGrade, minGrade],
  );
  const authorOptions = uniqueFilterAuthors([
    ...climbs.map((climb) => climb.setter),
    ...loadedAuthors,
    ...authors,
    ...(profile ? [profile.name] : []),
  ]);
  const matchingCount = filterClimbs(availableClimbs, currentFilters).length;
  const activeFilterCount = activeClimbFilterCount(currentFilters);

  function toggleAuthor(author: string) {
    setAuthors((current) =>
      current.includes(author)
        ? current.filter((item) => item !== author)
        : [...current, author],
    );
  }

  function resetFilters() {
    setMinGrade(DEFAULT_CLIMB_FILTERS.minGrade);
    setMaxGrade(DEFAULT_CLIMB_FILTERS.maxGrade);
    setAuthors([]);
    setHoldIds([]);
  }

  function retrySharedData() {
    setIsLoadingMatches(true);
    setClimbLoadFailed(false);
    setProfileLoadFailed(false);
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

      <section className="filter-intro" aria-labelledby="filter-heading">
        <h1 id="filter-heading">Filter climbs</h1>
        <p>Narrow the list by grade, holds, and who set the climb.</p>
      </section>

      {climbLoadFailed || profileLoadFailed ? (
        <div className="filter-data-notice" role="status">
          <p>
            {climbLoadFailed && profileLoadFailed
              ? "Shared climbs and the full author list could not be refreshed."
              : climbLoadFailed
                ? "Shared climb matches could not be checked."
                : "The full author list could not be loaded."}
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

      <fieldset className="filter-section filter-author-section">
        <legend>Author</legend>
        <p className="filter-help">No selection includes every author.</p>
        <div className="filter-author-list">
          {authorOptions.map((author) => (
            <label className="filter-author-choice" key={author}>
              <input
                checked={authors.includes(author)}
                onChange={() => toggleAuthor(author)}
                type="checkbox"
              />
              <span>{author}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="set-toolbar filter-toolbar">
        <div className="selection-status">
          <strong>
            {activeFilterCount === 0
              ? "All climbs"
              : `${activeFilterCount} active`}
          </strong>
          <span>
            {isLoadingMatches
              ? "Checking matches..."
              : climbLoadFailed
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
          <a
            className="compact-primary-button filter-apply-button"
            href={buildFilteredHref("/climbs", currentFilters)}
          >
            {isLoadingMatches || climbLoadFailed
              ? "View Climbs"
              : `Show ${matchingCount}`}
          </a>
        </div>
      </div>
    </main>
  );
}
