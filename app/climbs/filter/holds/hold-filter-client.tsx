"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  buildFilteredHref,
  MAX_FILTER_HOLDS,
  type ClimbFilters,
} from "../../climb-filters";
import { loadWallHoldMap, type WallHold } from "../../wall-holds";
import WallPhoto from "../../wall-photo";
import { isAdminUser } from "../../../user-access";
import { useActiveUser } from "../../../user-profile-provider";

export default function HoldFilterClient({
  initialFilters,
}: {
  initialFilters: ClimbFilters;
}) {
  const { profile } = useActiveUser();
  const [wallHolds, setWallHolds] = useState<WallHold[]>([]);
  const [selectedHoldIds, setSelectedHoldIds] = useState(
    initialFilters.holdIds,
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    const controller = new AbortController();

    loadWallHoldMap(controller.signal)
      .then((wallMap) => {
        const availableIds = new Set(wallMap.holds.map((hold) => hold.id));
        setWallHolds(wallMap.holds);
        setSelectedHoldIds((current) =>
          current.filter((holdId) => availableIds.has(holdId)),
        );
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("error");
      });

    return () => controller.abort();
  }, []);

  const currentFilters = useMemo<ClimbFilters>(
    () => ({ ...initialFilters, holdIds: selectedHoldIds }),
    [initialFilters, selectedHoldIds],
  );

  function toggleHold(holdId: string) {
    setSelectedHoldIds((current) =>
      current.includes(holdId)
        ? current.filter((item) => item !== holdId)
        : current.length < MAX_FILTER_HOLDS
          ? [...current, holdId]
          : current,
    );
  }

  function chooseNearestHold(event: ReactMouseEvent<HTMLButtonElement>) {
    if (event.detail === 0 || status !== "ready") return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const clientX = event.clientX - bounds.left;
    const clientY = event.clientY - bounds.top;
    const nearest = wallHolds
      .map((hold) => {
        const holdX = (hold.x / 100) * bounds.width;
        const holdY = (hold.y / 100) * bounds.height;
        return {
          hold,
          distance: Math.hypot(clientX - holdX, clientY - holdY),
          targetRadius: Math.max(
            22,
            (hold.size / 200) * bounds.width + 8,
          ),
        };
      })
      .sort((left, right) => left.distance - right.distance)[0];

    if (nearest && nearest.distance <= nearest.targetRadius) {
      toggleHold(nearest.hold.id);
    }
  }

  return (
    <main className="app-page set-page filter-hold-page">
      <header className="detail-header">
        <a
          className="back-link"
          href={buildFilteredHref("/climbs/filter", initialFilters)}
        >
          <span aria-hidden="true">&larr;</span>
          Cancel
        </a>
        <span>Select Holds</span>
      </header>

      <section className="set-intro" aria-labelledby="hold-filter-heading">
        <p className="step-label">Hold filter</p>
        <h1 id="hold-filter-heading">Choose holds</h1>
        <p>Choose holds every matching climb must use.</p>
      </section>

      {status === "loading" ? (
        <div className="set-wall-notice" role="status">
          Loading hold spots&hellip;
        </div>
      ) : null}
      {status === "error" ? (
        <div className="set-wall-notice">
          <p>The preset hold spots could not be loaded.</p>
          <a
            className="secondary-button"
            href={buildFilteredHref("/climbs/filter/holds", initialFilters)}
          >
            Retry
          </a>
        </div>
      ) : null}
      {status === "ready" && wallHolds.length === 0 ? (
        <div className="set-wall-notice">
          <p>Mark the holds on your wall before filtering by hold.</p>
          {isAdminUser(profile) ? (
            <a
              className="secondary-button"
              href={`/wall-holds?returnTo=${encodeURIComponent(
                buildFilteredHref("/climbs/filter/holds", currentFilters),
              )}`}
            >
              Mark Hold Spots
            </a>
          ) : (
            <p>Ask Admin to mark the wall holds.</p>
          )}
        </div>
      ) : null}

      <figure className="wall-map set-wall filter-hold-wall">
        <WallPhoto
          alt="Climbing wall used to choose holds for the filter"
          className="wall-photo"
          draggable="false"
          height="1448"
          width="1086"
        />
        <button
          aria-label="Tap near a preset hold to add or remove it from the filter"
          className="wall-hold-choice-layer"
          onClick={chooseNearestHold}
          tabIndex={-1}
          type="button"
        />
        {wallHolds.map((hold, index) => {
          const isSelected = selectedHoldIds.includes(hold.id);
          return (
            <button
              aria-label={
                isSelected
                  ? `Hold ${index + 1} of ${wallHolds.length}. Selected; activate to remove it from the filter.`
                  : `Hold ${index + 1} of ${wallHolds.length}. Activate to require it in matching climbs.`
              }
              aria-pressed={isSelected}
              className={`hold-choice hold-choice--${isSelected ? "hand" : "available"}`}
              key={hold.id}
              onClick={() => toggleHold(hold.id)}
              style={{
                left: `${hold.x}%`,
                top: `${hold.y}%`,
                "--hold-size": hold.size,
              } as CSSProperties}
              type="button"
            />
          );
        })}
        <figcaption className="sr-only">
          Preset hold spots on A Fine Wall. {selectedHoldIds.length} of{" "}
          {wallHolds.length} holds selected. Selected holds have blue circles.
        </figcaption>
      </figure>

      <div className="set-toolbar">
        <div className="selection-status" aria-live="polite">
          <strong>
            {selectedHoldIds.length} {selectedHoldIds.length === 1 ? "hold" : "holds"}
          </strong>
          <span>
            {selectedHoldIds.length >= MAX_FILTER_HOLDS
              ? `Maximum ${MAX_FILTER_HOLDS} holds selected`
              : "Every selected hold is required"}
          </span>
        </div>
        <div className="set-toolbar-actions">
          <button
            className="text-button"
            disabled={selectedHoldIds.length === 0}
            onClick={() => setSelectedHoldIds([])}
            type="button"
          >
            Clear
          </button>
          <a
            className="compact-primary-button"
            href={buildFilteredHref("/climbs/filter", currentFilters)}
          >
            Done
          </a>
        </div>
      </div>
    </main>
  );
}
