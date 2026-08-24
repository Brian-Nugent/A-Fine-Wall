"use client";

import {
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ClimbRequestError,
  saveClimb as saveClimbToApp,
} from "../climbs/climb-api";
import {
  CLIMB_GRADES,
  nextSavedHoldRole,
  persistSavedClimb,
  type SavedClimb,
  type SavedHoldRole,
} from "../climbs/saved-climbs";
import { loadWallHoldMap, type WallHold } from "../climbs/wall-holds";
import WallPhoto from "../climbs/wall-photo";

type DraftHold = {
  holdId: string;
  role: SavedHoldRole;
};

function makeClimbId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export default function SetClimbPage() {
  const [step, setStep] = useState<"holds" | "details">("holds");
  const [wallHolds, setWallHolds] = useState<WallHold[]>([]);
  const [wallRevision, setWallRevision] = useState<number | null>(null);
  const [holdMapStatus, setHoldMapStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [selectedHolds, setSelectedHolds] = useState<DraftHold[]>([]);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [saveError, setSaveError] = useState("");
  const [hasSaveConflict, setHasSaveConflict] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    loadWallHoldMap(controller.signal)
      .then((wallMap) => {
        setWallHolds(wallMap.holds);
        setWallRevision(wallMap.updatedAt);
        setHoldMapStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHoldMapStatus("error");
      });

    return () => controller.abort();
  }, []);

  function cycleHold(holdId: string) {
    setSelectedHolds((current) => {
      const selected = current.find((hold) => hold.holdId === holdId);
      if (!selected) return [...current, { holdId, role: "hand" }];

      return current.flatMap((hold) => {
        if (hold.holdId !== holdId) return [hold];
        const nextRole = nextSavedHoldRole(selected.role);
        return nextRole ? [{ ...hold, role: nextRole }] : [];
      });
    });
  }

  function chooseNearestHold(event: ReactMouseEvent<HTMLButtonElement>) {
    if (event.detail === 0 || holdMapStatus !== "ready") return;

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
      .sort((a, b) => a.distance - b.distance)[0];

    if (nearest && nearest.distance <= nearest.targetRadius) {
      cycleHold(nearest.hold.id);
    }
  }

  const startCount = selectedHolds.filter(
    (hold) => hold.role === "start",
  ).length;
  const finishCount = selectedHolds.filter(
    (hold) => hold.role === "finish",
  ).length;
  const canFinish = startCount > 0 && finishCount > 0;

  async function saveClimb(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError("");
    setHasSaveConflict(false);

    const trimmedName = name.trim();
    if (!trimmedName || !grade || !canFinish || wallRevision === null) return;

    const climb: SavedClimb = {
      id: makeClimbId(),
      name: trimmedName,
      grade,
      setter: "You",
      createdAt: Date.now(),
      holds: selectedHolds.flatMap((selection) => {
        const hold = wallHolds.find((item) => item.id === selection.holdId);
        return hold
          ? [{
              holdId: hold.id,
              x: hold.x,
              y: hold.y,
              size: hold.size,
              role: selection.role,
            }]
          : [];
      }),
    };

    setIsSaving(true);
    try {
      await saveClimbToApp(climb, wallRevision);
      try {
        persistSavedClimb(window.localStorage, climb);
      } catch {
        // The durable app copy was saved; the browser copy is only a fallback.
      }
      window.location.assign(`/climbs/saved?id=${encodeURIComponent(climb.id)}`);
    } catch (error) {
      setHasSaveConflict(
        error instanceof ClimbRequestError &&
          error.status === 409 &&
          /wall spots changed/i.test(error.message),
      );
      setSaveError(
        error instanceof Error
          ? error.message
          : "This climb could not be saved. Please try again.",
      );
      setIsSaving(false);
    }
  }

  function reloadWall() {
    if (
      !window.confirm(
        "Reload the latest wall spots? This unsaved climb draft will be discarded.",
      )
    ) {
      return;
    }

    window.location.reload();
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
              Tap a hold for a blue circle, again for a green start, and again
              for a red finish. A fourth tap clears it.
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
              Wall Setup
            </a>
          </section>

          {holdMapStatus === "loading" ? (
            <div className="set-wall-notice" role="status">
              Loading hold spots&hellip;
            </div>
          ) : null}
          {holdMapStatus === "error" ? (
            <div className="set-wall-notice">
              <p>The preset hold spots could not be loaded.</p>
              <a className="secondary-button" href="/set-climb">
                Retry
              </a>
            </div>
          ) : null}
          {holdMapStatus === "ready" && wallHolds.length === 0 ? (
            <div className="set-wall-notice">
              <p>Mark the holds on your wall before setting a climb.</p>
              <a className="secondary-button" href="/wall-holds">
                Mark Hold Spots
              </a>
            </div>
          ) : null}

          <figure className="wall-map set-wall">
            <WallPhoto
              className="wall-photo"
              alt="Climbing wall used to set the route"
              width="1086"
              height="1448"
              draggable="false"
            />
            <button
              aria-hidden="true"
              className="wall-hold-choice-layer"
              onClick={chooseNearestHold}
              tabIndex={-1}
              type="button"
            />
            {wallHolds.map((hold) => {
              const selection = selectedHolds.find(
                (item) => item.holdId === hold.id,
              );
              const nextAction =
                !selection
                  ? "add it as a climb hold"
                  : selection.role === "hand"
                  ? "make it a start"
                  : selection.role === "start"
                    ? "make it a finish"
                    : "clear it";
              const accessibleLabel = selection
                ? `${selection.role === "hand" ? "Blue climb" : selection.role === "start" ? "Green start" : "Red finish"} hold. Tap to ${nextAction}.`
                : `Available hold spot. Tap to ${nextAction}.`;

              return (
                <button
                  aria-label={accessibleLabel}
                  aria-pressed={Boolean(selection)}
                  className={`hold-choice hold-choice--${selection?.role || "available"}`}
                  key={hold.id}
                  onClick={() => cycleHold(hold.id)}
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
              Preset hold spots on A Fine Wall. Choose one or more green start
              holds, blue climbing holds, and one or more red finish holds.
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
                disabled={!canFinish || holdMapStatus !== "ready"}
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
              {CLIMB_GRADES.map((gradeOption) => (
                <option key={gradeOption} value={gradeOption}>
                  {gradeOption}
                </option>
              ))}
            </select>

            {saveError ? (
              <div className="form-error climb-save-error" role="alert">
                <p>{saveError}</p>
                {hasSaveConflict ? (
                  <button
                    className="climb-reload-button"
                    onClick={reloadWall}
                    type="button"
                  >
                    Reload Wall
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="form-actions">
              <button
                className="secondary-button"
                onClick={() => setStep("holds")}
                type="button"
              >
                Back to holds
              </button>
              <button className="primary-button" disabled={isSaving} type="submit">
                {isSaving ? "Saving..." : "Save Climb"}
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
