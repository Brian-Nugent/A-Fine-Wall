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

export default function ClimbActivityPanel({
  filters,
  reference,
}: {
  filters: ClimbFilters;
  reference: ClimbReference;
}) {
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
  const activity = status === "ready" ? state.activity : null;
  const logbookEntries =
    status === "ready" ? state.logbookEntries : [];
  const sentHref = buildFilteredHref("/climbs/sent", filters, {
    kind: reference.climbKind,
    id: reference.climbId,
  });

  return (
    <>
      <section className="climb-activity-panel" aria-label="Send and rating">
        <div className="climb-activity-summary" aria-live="polite">
          <p>Community rating</p>
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
        <a className="primary-button sent-button" href={sentHref}>
          {activity?.userRating ? "Edit Rating" : "Sent"}
        </a>
      </section>

      <section className="climb-logbook" aria-labelledby="climb-logbook-heading">
        <h2 id="climb-logbook-heading">Logbook</h2>
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
                <span
                  aria-label={`${entry.rating} out of 5 stars`}
                  className="climb-logbook-rating"
                >
                  {Array.from({ length: entry.rating }, (_, starIndex) => (
                    <span aria-hidden="true" key={starIndex}>
                      &#9733;
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
