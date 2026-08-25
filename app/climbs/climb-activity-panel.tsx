"use client";

import { useEffect, useState } from "react";
import { useActiveUser } from "../user-profile-provider";
import {
  findClimbActivity,
  formatAverageRating,
  type ClimbActivity,
  type ClimbReference,
} from "./climb-activity";
import {
  buildFilteredHref,
  type ClimbFilters,
} from "./climb-filters";
import { loadClimbActivities } from "./send-api";

type ActivityState = {
  profileId: string | null;
  status: "loading" | "ready" | "error";
  activities: ClimbActivity[];
};

export default function ClimbActivityPanel({
  filters,
  reference,
}: {
  filters: ClimbFilters;
  reference: ClimbReference;
}) {
  const { profile } = useActiveUser();
  const [state, setState] = useState<ActivityState>({
    profileId: null,
    status: "loading",
    activities: [],
  });

  useEffect(() => {
    if (!profile) return;
    const controller = new AbortController();
    let isActive = true;

    void loadClimbActivities(profile.id, controller.signal)
      .then((activities) => {
        if (!isActive) return;
        setState({ profileId: profile.id, status: "ready", activities });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!isActive) return;
        setState({ profileId: profile.id, status: "error", activities: [] });
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [profile]);

  const isCurrentProfile = state.profileId === profile?.id;
  const status = isCurrentProfile ? state.status : "loading";
  const activity =
    status === "ready"
      ? findClimbActivity(state.activities, reference)
      : null;
  const sentHref = buildFilteredHref("/climbs/sent", filters, {
    kind: reference.climbKind,
    id: reference.climbId,
  });

  return (
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
  );
}
