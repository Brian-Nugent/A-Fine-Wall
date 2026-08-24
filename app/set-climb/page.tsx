"use client";

import {
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  nextSavedHoldRole,
  persistSavedClimb,
  type SavedClimb,
  type SavedHoldRole,
} from "../climbs/saved-climbs";
import WallPhoto from "../climbs/wall-photo";

const grades = Array.from({ length: 11 }, (_, index) => `V${index}`);

type DraftHold = {
  id: string;
  x: number;
  y: number;
  size: number;
  role: SavedHoldRole;
};

function makeClimbId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function makeDraftHoldId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export default function SetClimbPage() {
  const [step, setStep] = useState<"holds" | "details">("holds");
  const [selectedHolds, setSelectedHolds] = useState<DraftHold[]>([]);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [saveError, setSaveError] = useState("");

  function addHold(event: ReactMouseEvent<HTMLButtonElement>) {
    if (event.detail === 0) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Number(
      (((event.clientX - bounds.left) / bounds.width) * 100).toFixed(2),
    );
    const y = Number(
      (((event.clientY - bounds.top) / bounds.height) * 100).toFixed(2),
    );

    setSelectedHolds((current) => [
      ...current,
      { id: makeDraftHoldId(), x, y, size: 7, role: "hand" },
    ]);
  }

  function cycleHold(id: string) {
    setSelectedHolds((current) =>
      current.flatMap((hold) => {
        if (hold.id !== id) return [hold];

        const nextRole = nextSavedHoldRole(hold.role);
        return nextRole ? [{ ...hold, role: nextRole }] : [];
      }),
    );
  }

  const startCount = selectedHolds.filter(
    (hold) => hold.role === "start",
  ).length;
  const finishCount = selectedHolds.filter(
    (hold) => hold.role === "finish",
  ).length;
  const canFinish = startCount > 0 && finishCount > 0;

  function saveClimb(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError("");

    const trimmedName = name.trim();
    if (!trimmedName || !grade || !canFinish) return;

    const climb: SavedClimb = {
      id: makeClimbId(),
      name: trimmedName,
      grade,
      setter: "You",
      createdAt: Date.now(),
      holds: selectedHolds.map((hold) => ({
        x: hold.x,
        y: hold.y,
        size: hold.size,
        role: hold.role,
      })),
    };

    try {
      persistSavedClimb(window.localStorage, climb);
      window.location.assign(`/climbs/saved?id=${encodeURIComponent(climb.id)}`);
    } catch {
      setSaveError("This climb could not be saved on this device. Please try again.");
    }
  }

  return (
    <main className="app-page set-page">
      <header className="detail-header">
        <a className="back-link" href="/climbs">
          <span aria-hidden="true">&larr;</span>
          Climbs
        </a>
        <span>Set Climb</span>
      </header>

      {step === "holds" ? (
        <>
          <section className="set-intro" aria-labelledby="set-climb-heading">
            <p className="step-label">Step 1 of 2</p>
            <h1 id="set-climb-heading">Choose your holds</h1>
            <p>
              Tap once for a blue climb hold, twice for a green start, and
              three times for a red finish. Tap a red circle again to remove it.
            </p>
            <a
              className="change-photo-link"
              href="/wall-photo"
              onClick={(event) => {
                if (
                  selectedHolds.length > 0 &&
                  !window.confirm(
                    "Changing the wall photo will clear the holds you selected. Continue?",
                  )
                ) {
                  event.preventDefault();
                }
              }}
            >
              Change Wall Photo
            </a>
          </section>

          <figure className="wall-map set-wall">
            <WallPhoto
              className="wall-photo"
              alt="Climbing wall used to set the route"
              width="1086"
              height="1448"
              draggable="false"
            />
            <button
              aria-label="Tap the wall to add a hold"
              className="wall-tap-layer"
              onClick={addHold}
              tabIndex={-1}
              type="button"
            />
            {selectedHolds.map((hold) => {
              const nextAction =
                hold.role === "hand"
                  ? "make it a start"
                  : hold.role === "start"
                    ? "make it a finish"
                    : "remove it";
              const accessibleLabel = `${hold.role === "hand" ? "Blue climb" : hold.role === "start" ? "Green start" : "Red finish"} hold. Tap to ${nextAction}.`;

              return (
                <button
                  aria-label={accessibleLabel}
                  aria-pressed="true"
                  className={`hold-choice hold-choice--${hold.role}`}
                  key={hold.id}
                  onClick={() => cycleHold(hold.id)}
                  style={{
                    left: `${hold.x}%`,
                    top: `${hold.y}%`,
                    width: `max(${hold.size}%, 2.75rem)`,
                  }}
                  type="button"
                />
              );
            })}
            <figcaption className="sr-only">
              Selectable holds on A Fine Wall. Choose one or more green start
              holds and one or more red finish holds.
            </figcaption>
          </figure>

          <div className="set-toolbar">
            <div className="selection-status" aria-live="polite">
              <strong>{selectedHolds.length} holds</strong>
              <span>
                {canFinish
                  ? `${startCount} start / ${finishCount} finish`
                  : "Need a start and finish"}
              </span>
            </div>
            <div className="set-toolbar-actions">
              <button
                className="text-button"
                disabled={selectedHolds.length === 0}
                onClick={() => setSelectedHolds((current) => current.slice(0, -1))}
                type="button"
              >
                Remove Last
              </button>
              <button
                className="text-button"
                disabled={selectedHolds.length === 0}
                onClick={() => setSelectedHolds([])}
                type="button"
              >
                Clear
              </button>
              <button
                className="compact-primary-button"
                disabled={!canFinish}
                onClick={() => setStep("details")}
                type="button"
              >
                Done
              </button>
            </div>
          </div>
        </>
      ) : (
        <section className="finish-step" aria-labelledby="finish-heading">
          <p className="step-label">Step 2 of 2</p>
          <h1 id="finish-heading">Name your climb</h1>
          <p>{selectedHolds.length} holds selected</p>

          <form className="climb-form" onSubmit={saveClimb}>
            <label htmlFor="climb-name-input">Name</label>
            <input
              autoComplete="off"
              id="climb-name-input"
              maxLength={50}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Corner Pocket"
              required
              type="text"
              value={name}
            />

            <label htmlFor="climb-grade-select">Grade</label>
            <select
              id="climb-grade-select"
              onChange={(event) => setGrade(event.target.value)}
              required
              value={grade}
            >
              <option value="">Choose a grade</option>
              {grades.map((gradeOption) => (
                <option key={gradeOption} value={gradeOption}>
                  {gradeOption}
                </option>
              ))}
            </select>

            {saveError ? (
              <p className="form-error" role="alert">
                {saveError}
              </p>
            ) : null}

            <div className="form-actions">
              <button
                className="secondary-button"
                onClick={() => setStep("holds")}
                type="button"
              >
                Back to holds
              </button>
              <button className="primary-button" type="submit">
                Save Climb
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
