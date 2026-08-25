"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useActiveUser } from "../../user-profile-provider";
import {
  findClimbActivity,
  type ClimbReference,
} from "../climb-activity";
import { loadClimb } from "../climb-api";
import { loadClimbActivities, saveClimbSend } from "../send-api";

type ClimbSummary = {
  name: string;
  grade: string;
};

type RatingState = {
  profileId: string | null;
  status: "loading" | "ready" | "error";
  existingRating: number | null;
};

const ratings = [1, 2, 3, 4, 5] as const;

export default function SentClimbClient({
  backHref,
  initialClimb,
  reference,
}: {
  backHref: string;
  initialClimb: ClimbSummary | null;
  reference: ClimbReference;
}) {
  const { profile } = useActiveUser();
  const { climbId, climbKind } = reference;
  const [climb, setClimb] = useState<ClimbSummary | null | undefined>(
    climbKind === "demo" ? initialClimb : undefined,
  );
  const [ratingState, setRatingState] = useState<RatingState>({
    profileId: null,
    status: "loading",
    existingRating: null,
  });
  const [rating, setRating] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (climbKind !== "saved") return;
    const controller = new AbortController();

    void loadClimb(climbId, controller.signal)
      .then((savedClimb) =>
        setClimb(
          savedClimb
            ? { name: savedClimb.name, grade: savedClimb.grade }
            : null,
        ),
      )
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setClimb(null);
      });

    return () => controller.abort();
  }, [climbId, climbKind]);

  useEffect(() => {
    if (!profile) return;
    const controller = new AbortController();
    let isActive = true;

    void loadClimbActivities(profile.id, controller.signal)
      .then((activities) => {
        if (!isActive) return;
        const existingRating =
          findClimbActivity(activities, { climbId, climbKind })?.userRating ??
          null;
        setSaveError("");
        setRating(existingRating ?? 0);
        setRatingState({
          profileId: profile.id,
          status: "ready",
          existingRating,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!isActive) return;
        setSaveError("");
        setRating(0);
        setRatingState({
          profileId: profile.id,
          status: "error",
          existingRating: null,
        });
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [climbId, climbKind, profile]);

  const ratingStatus =
    ratingState.profileId === profile?.id ? ratingState.status : "loading";
  const existingRating =
    ratingStatus === "ready" ? ratingState.existingRating : null;
  const displayedRating =
    ratingState.profileId === profile?.id ? rating : 0;
  const visibleSaveError =
    ratingState.profileId === profile?.id ? saveError : "";

  async function saveSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !profile ||
      displayedRating < 1 ||
      displayedRating > 5 ||
      isSaving
    ) {
      return;
    }

    setIsSaving(true);
    setSaveError("");
    try {
      await saveClimbSend(reference, profile.id, displayedRating);
      window.location.replace(backHref);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Your send could not be saved. Please try again.",
      );
      setIsSaving(false);
    }
  }

  return (
    <main className="app-page sent-page">
      <header className="detail-header">
        <a className="back-link" href={backHref}>
          <span aria-hidden="true">&larr;</span>
          Climb
        </a>
        <span>Sent</span>
      </header>

      {climb === undefined ? (
        <div className="empty-state" role="status">
          <p>Loading climb&hellip;</p>
        </div>
      ) : climb === null ? (
        <div className="empty-state">
          <h1>Climb not found</h1>
          <p>This climb may have been removed or is temporarily unavailable.</p>
          <a className="primary-button" href={backHref}>
            Back to Climb
          </a>
        </div>
      ) : (
        <section className="sent-content" aria-labelledby="sent-heading">
          <div className="sent-climb-heading">
            <div>
              <p className="step-label">Log your climb</p>
              <h1 id="sent-heading">Rate your send</h1>
              <p>{climb.name}</p>
            </div>
            <strong>{climb.grade}</strong>
          </div>

          {ratingStatus === "loading" ? (
            <p className="sent-load-status" role="status">
              Loading your rating&hellip;
            </p>
          ) : ratingStatus === "error" ? (
            <p className="sent-load-status" role="status">
              Your previous rating could not be loaded. You can still save a
              rating now.
            </p>
          ) : null}

          <form className="sent-form" onSubmit={saveSend}>
            <fieldset disabled={isSaving || ratingStatus === "loading"}>
              <legend>How many stars would you give this climb?</legend>
              <div className="star-rating-options">
                {ratings.map((value) => (
                  <span className="star-rating-choice" key={value}>
                    <input
                      aria-label={`${value} ${value === 1 ? "star" : "stars"}`}
                      checked={displayedRating === value}
                      className="star-radio-input"
                      id={`send-rating-${value}`}
                      name="rating"
                      onChange={() => {
                        setRating(value);
                        setSaveError("");
                      }}
                      type="radio"
                      value={value}
                    />
                    <label
                      className={`star-rating-label${value <= displayedRating ? " star-rating-label--filled" : ""}`}
                      htmlFor={`send-rating-${value}`}
                    >
                      <span aria-hidden="true">&#9733;</span>
                    </label>
                  </span>
                ))}
              </div>
            </fieldset>

            <p className="selected-rating" aria-live="polite">
              {displayedRating === 0
                ? "Choose a rating from 1 to 5."
                : `${displayedRating} out of 5 stars`}
            </p>

            {visibleSaveError ? (
              <p className="form-error" role="alert">
                {visibleSaveError}
              </p>
            ) : null}

            <button
              className="primary-button sent-save-button"
              disabled={
                displayedRating === 0 ||
                isSaving ||
                ratingStatus === "loading"
              }
              type="submit"
            >
              {isSaving
                ? "Saving..."
                : existingRating
                  ? "Update Rating"
                  : "Save Send"}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
