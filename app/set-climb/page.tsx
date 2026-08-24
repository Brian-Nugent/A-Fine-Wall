"use client";

/* eslint-disable @next/next/no-img-element */

import {
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  persistSavedClimb,
  type SavedClimb,
  type SavedHoldRole,
} from "../climbs/saved-climbs";

const grades = Array.from({ length: 11 }, (_, index) => `V${index}`);

type DraftHold = {
  id: string;
  x: number;
  y: number;
  size: number;
};

function roleForHold(index: number, total: number): SavedHoldRole {
  if (index === 0) return "start";
  if (index === total - 1) return "finish";
  return "hand";
}

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
    const x = Number((((event.clientX - bounds.left) / bounds.width) * 100).toFixed(2));
    const y = Number((((event.clientY - bounds.top) / bounds.height) * 100).toFixed(2));

    setSelectedHolds((current) => [
      ...current,
      { id: makeDraftHoldId(), x, y, size: 7 },
    ]);
  }

  function removeHold(id: string) {
    setSelectedHolds((current) => current.filter((hold) => hold.id !== id));
  }

  function saveClimb(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError("");

    const trimmedName = name.trim();
    if (!trimmedName || !grade || selectedHolds.length < 2) return;

    const climb: SavedClimb = {
      id: makeClimbId(),
      name: trimmedName,
      grade,
      setter: "You",
      createdAt: Date.now(),
      holds: selectedHolds.map((hold, index) => ({
        x: hold.x,
        y: hold.y,
        size: hold.size,
        role: roleForHold(index, selectedHolds.length),
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
              Tap directly on each hold in climbing order. The first is the
              start and the last is the finish. Tap a circle to remove it.
            </p>
          </section>

          <figure className="wall-map set-wall">
            <img
              className="wall-photo"
              src="/wall-prototype.png"
              alt="A plywood home climbing wall covered with colorful holds"
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
            {selectedHolds.map((hold, selectedIndex) => {
              const role = roleForHold(selectedIndex, selectedHolds.length);
              const markerLabel =
                role === "start"
                  ? "S"
                  : role === "finish"
                    ? "T"
                    : String(selectedIndex + 1);
              const accessibleLabel = `Remove ${role === "start" ? "start" : role === "finish" ? "finish" : `hold ${selectedIndex + 1}`}`;

              return (
                <button
                  aria-label={accessibleLabel}
                  aria-pressed="true"
                  className={`hold-choice hold-choice--${role}`}
                  key={hold.id}
                  onClick={() => removeHold(hold.id)}
                  style={{
                    left: `${hold.x}%`,
                    top: `${hold.y}%`,
                    width: `max(${hold.size}%, 2.75rem)`,
                  }}
                  type="button"
                >
                  <span>{markerLabel}</span>
                </button>
              );
            })}
            <figcaption className="sr-only">
              Selectable holds on A Fine Wall. Choose at least a start and a
              finish hold.
            </figcaption>
          </figure>

          <div className="set-toolbar">
            <div className="selection-status" aria-live="polite">
              <strong>{selectedHolds.length} holds</strong>
              <span>
                {selectedHolds.length < 2 ? "Choose at least 2" : "Ready to name"}
              </span>
            </div>
            <div className="set-toolbar-actions">
              <button
                className="text-button"
                disabled={selectedHolds.length === 0}
                onClick={() => setSelectedHolds((current) => current.slice(0, -1))}
                type="button"
              >
                Undo
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
                disabled={selectedHolds.length < 2}
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
