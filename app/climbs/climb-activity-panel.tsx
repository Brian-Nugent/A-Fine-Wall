"use client";

import { useEffect, useState } from "react";
import { useActiveUser } from "../user-profile-provider";
import {
  climbActivityKey,
  formatAverageRating,
  type ClimbActivity,
  type ClimbLogbookEntry,
  type ClimbReference,
} from "./climb-activity";
import {
  buildFilteredHref,
  type ClimbFilters,
} from "./climb-filters";
import { loadClimbActivityDetail } from "./send-api";

type ActivityState = {
  profileId: string | null;
  referenceKey: string | null;
  status: "loading" | "ready" | "error";
  activity: ClimbActivity | null;
  logbookEntries: ClimbLogbookEntry[];
};

function useClimbActivityDetail(reference: ClimbReference) {
  const { profile } = useActiveUser();
  const { climbKind, climbId } = reference;
  const referenceKey = climbActivityKey({ climbKind, climbId });
  const [state, setState] = useState<ActivityState>({
    profileId: null,
    referenceKey: null,
    status: "loading",
    activity: null,
    logbookEntries: [],
  });

  useEffect(() => {
    if (!profile) return;
    const controller = new AbortController();
    let isActive = true;

    void loadClimbActivityDetail(
      { climbKind, climbId },
      profile.id,
      controller.signal,
    )
      .then(({ activity, logbookEntries }) => {
        if (!isActive) return;
        setState({
          profileId: profile.id,
          referenceKey,
          status: "ready",
          activity,
          logbookEntries,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!isActive) return;
        setState({
          profileId: profile.id,
          referenceKey,
          status: "error",
          activity: null,
          logbookEntries: [],
        });
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [climbId, climbKind, profile, referenceKey]);

  const isCurrentRequest =
    state.profileId === profile?.id && state.referenceKey === referenceKey;
  const status = isCurrentRequest ? state.status : "loading";

  return {
    activity: status === "ready" ? state.activity : null,
    logbookEntries: status === "ready" ? state.logbookEntries : [],
    status,
  };
}

export default function ClimbActivityPanel({
  filters,
  reference,
}: {
  filters: ClimbFilters;
  reference: ClimbReference;
}) {
  const { activity, status } = useClimbActivityDetail(reference);
  const sentHref = buildFilteredHref("/climbs/sent", filters, {
    kind: reference.climbKind,
    id: reference.climbId,
  });
  const logbookHref = buildFilteredHref("/climbs/logbook", filters, {
    kind: reference.climbKind,
    id: reference.climbId,
  });

  return (
    <section className="climb-activity-panel" aria-label="Send and rating">
      <div className="climb-activity-summary" aria-live="polite">
        <p className="climb-section-label">Community rating</p>
        {status === "loading" ? (
          <strong>Loading&hellip;</strong>
        ) : status === "error" ? (
          <strong>Rating unavailable</strong>
        ) : activity ? (
          <strong
            aria-label={`Average rating ${formatAverageRating(activity.averageRating)} out of 5 from ${activity.ratingCount} ${activity.ratingCount === 1 ? "rating" : "ratings"}`}
          >
            <span aria-hidden="true">&#9733;</span>{" "}
            {formatAverageRating(activity.averageRating)} ({activity.ratingCount})
          </strong>
        ) : (
          <strong>No ratings yet</strong>
        )}
        {activity?.userRating ? (
          <p className="personal-send-status">
            <span aria-hidden="true">&#10003;</span> Sent &middot; Your rating:{" "}
            {activity.userRating}/5
          </p>
        ) : null}
      </div>
      <div className="climb-activity-actions">
        <a className="secondary-button logbook-button" href={logbookHref}>
          Logbook
        </a>
        <a className="primary-button sent-button" href={sentHref}>
          {activity?.userRating ? "Edit Send" : "Log Send"}
        </a>
      </div>
    </section>
  );
}

export function ClimbLogbook({
  reference,
}: {
  reference: ClimbReference;
}) {
  const { logbookEntries, status } = useClimbActivityDetail(reference);

  return (
    <section className="climb-logbook" aria-labelledby="climb-logbook-heading">
      <h2 className="climb-section-label" id="climb-logbook-heading">
        Sends
      </h2>
      {status === "loading" ? (
        <p className="climb-logbook-status" role="status">
          Loading logbook&hellip;
        </p>
      ) : status === "error" ? (
        <p className="climb-logbook-status" role="status">
          Logbook unavailable.
        </p>
      ) : logbookEntries.length === 0 ? (
        <p className="climb-logbook-status">No sends yet.</p>
      ) : (
        <ul className="climb-logbook-list">
          {logbookEntries.map((entry, index) => (
            <li
              className="climb-logbook-entry"
              key={`${entry.profileName}-${index}`}
            >
              <span className="climb-logbook-name">{entry.profileName}</span>
              <span className="climb-logbook-details">
                <span
                  aria-label={`${entry.rating} out of 5 stars`}
                  className="climb-logbook-rating"
                  role="img"
                >
                  {Array.from({ length: entry.rating }, (_, starIndex) => (
                    <span aria-hidden="true" key={starIndex}>
                      &#9733;
                    </span>
                  ))}
                </span>
                <span className="climb-logbook-grade">
                  <span className="sr-only">
                    {entry.grade
                      ? `Grade ${entry.grade}`
                      : "Grade not recorded"}
                  </span>
                  <span aria-hidden="true">{entry.grade ?? "—"}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
