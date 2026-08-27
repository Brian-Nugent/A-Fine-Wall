"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useActiveUser } from "../../user-profile-provider";
import type { ClimbReference } from "../climb-activity";
import { loadClimb } from "../climb-api";
import { clearSessionClimbNavigationSnapshot } from "../climb-navigation-snapshot";
import { loadClimbActivityDetail, saveClimbSend } from "../send-api";
import { CLIMB_GRADES, isClimbGrade } from "../saved-climbs";

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
  const [grade, setGrade] = useState("");
  const [rating, setRating] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!profile) return;
    const controller = new AbortController();
    let isActive = true;

    const climbRequest: Promise<ClimbSummary | null> =
      climbKind === "saved"
        ? loadClimb(climbId, controller.signal).then((savedClimb) =>
            savedClimb
              ? { name: savedClimb.name, grade: savedClimb.grade }
              : null,
          )
        : Promise.resolve(initialClimb);
    const activityRequest = loadClimbActivityDetail(
      { climbId, climbKind },
      profile.id,
      controller.signal,
    );

    void Promise.allSettled([climbRequest, activityRequest]).then(
      ([climbResult, activityResult]) => {
        if (!isActive || controller.signal.aborted) return;
        const loadedClimb =
          climbResult.status === "fulfilled" ? climbResult.value : null;
        setClimb(loadedClimb);
        setSaveError("");
        if (activityResult.status === "fulfilled") {
          const existingRating =
            activityResult.value.activity?.userRating ?? null;
          const existingGrade = activityResult.value.userGrade;
          setGrade(existingGrade ?? loadedClimb?.grade ?? "");
          setRating(existingRating ?? 0);
          setRatingState({
            profileId: profile.id,
            status: "ready",
            existingRating,
          });
        } else {
          setGrade(loadedClimb?.grade ?? "");
          setRating(0);
          setRatingState({
            profileId: profile.id,
            status: "error",
            existingRating: null,
          });
        }
      },
    );

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [climbId, climbKind, initialClimb, profile]);

  const ratingStatus =
    ratingState.profileId === profile?.id ? ratingState.status : "loading";
  const existingRating =
    ratingStatus === "ready" ? ratingState.existingRating : null;
  const displayedGrade =
    ratingState.profileId === profile?.id ? grade : "";
  const displayedRating =
    ratingState.profileId === profile?.id ? rating : 0;
  const visibleSaveError =
    ratingState.profileId === profile?.id ? saveError : "";

  async function saveSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !profile ||
      !isClimbGrade(displayedGrade) ||
      displayedRating < 1 ||
      displayedRating > 5 ||
      isSaving
    ) {
      return;
    }

    setIsSaving(true);
    setSaveError("");
    try {
      await saveClimbSend(
        reference,
        profile.id,
        displayedGrade,
        displayedRating,
      );
      clearSessionClimbNavigationSnapshot(window);
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
        <span>Log Send</span>
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
            <h1 id="sent-heading">{climb.name}</h1>
          </div>

          <form className="sent-form" onSubmit={saveSend}>
            <label className="sent-grade-control" htmlFor="send-grade-select">
              <span>What grade would you give this climb?</span>
              <span className="sent-grade-select">
                <select
                  disabled={isSaving || ratingStatus === "loading"}
                  id="send-grade-select"
                  name="grade"
                  onChange={(event) => {
                    setGrade(event.target.value);
                    setSaveError("");
                  }}
                  required
                  value={displayedGrade}
                >
                  <option disabled value="">
                    Loading grade&hellip;
                  </option>
                  {CLIMB_GRADES.map((gradeOption) => (
                    <option key={gradeOption} value={gradeOption}>
                      {gradeOption}
                    </option>
                  ))}
                </select>
              </span>
            </label>

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
              {displayedRating > 0
                ? `${displayedRating} out of 5 stars`
                : null}
            </p>

            {ratingStatus === "loading" ? (
              <p className="sent-load-status" role="status">
                Loading your send details&hellip;
              </p>
            ) : ratingStatus === "error" ? (
              <p className="sent-load-status" role="status">
                Your previous send details could not be loaded. The consensus
                grade is selected; choose a rating to save.
              </p>
            ) : null}

            {visibleSaveError ? (
              <p className="form-error" role="alert">
                {visibleSaveError}
              </p>
            ) : null}

            <button
              className="primary-button sent-save-button"
              disabled={
                displayedRating === 0 ||
                !isClimbGrade(displayedGrade) ||
                isSaving ||
                ratingStatus === "loading"
              }
              type="submit"
            >
              {isSaving
                ? "Saving..."
                : existingRating
                  ? "Update Send"
                  : "Save Send"}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
