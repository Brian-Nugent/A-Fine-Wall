"use client";

import { formatAverageRating, type ClimbReference } from "./climb-activity";
import { useClimbActivity } from "./climb-activity-context";
import { buildFilteredHref, type ClimbFilters } from "./climb-filters";

export default function ClimbActivityPanel({
  filters,
  reference,
}: {
  filters: ClimbFilters;
  reference: ClimbReference;
}) {
  const { status, activity, logbookEntries, hasSent } = useClimbActivity();
  const sentHref = buildFilteredHref("/climbs/sent", filters, {
    kind: reference.climbKind,
    id: reference.climbId,
  });

  return (
    <>
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
        <a className="primary-button sent-button" href={sentHref}>
          {activity?.userRating ? "Edit Send" : "Log Send"}
        </a>
      </section>

      <section className="climb-logbook" aria-labelledby="climb-logbook-heading">
        <h2 className="climb-section-label" id="climb-logbook-heading">
          Logbook
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
                  {hasSent ? (
                    <span className="climb-logbook-grade">
                      <span className="sr-only">
                        {entry.grade
                          ? `Grade ${entry.grade}`
                          : "Grade not recorded"}
                      </span>
                      <span aria-hidden="true">{entry.grade ?? "—"}</span>
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
