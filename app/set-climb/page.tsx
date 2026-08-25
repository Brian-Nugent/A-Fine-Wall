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
  loadClimb,
  saveClimb as saveClimbToApp,
  updateClimb as updateClimbInApp,
} from "../climbs/climb-api";
import {
  buildFilteredHref,
  parseClimbFilters,
} from "../climbs/climb-filters";
import {
  CLIMB_GRADES,
  nextSavedHoldRole,
  persistSavedClimb,
  type SavedClimb,
  type SavedHoldRole,
} from "../climbs/saved-climbs";
import {
  loadWallHoldMap,
  type WallHold,
  type WallHoldMap,
} from "../climbs/wall-holds";
import { useActiveUser } from "../user-profile-provider";
import WallPhoto from "../climbs/wall-photo";

type DraftHold = {
  holdId: string;
  role: SavedHoldRole;
};

const holdRoleAccessibleLabels: Record<SavedHoldRole, string> = {
  hand: "Blue climbing hold",
  foot: "Yellow foothold",
  start: "Green start hold",
  finish: "Red finish hold",
};

const holdRoleActions: Record<SavedHoldRole, string> = {
  hand: "add it as a blue climbing hold",
  foot: "make it a yellow foothold",
  start: "make it a green start",
  finish: "make it a red finish",
};

const MAX_LEGACY_HOLD_MATCH_DISTANCE = 3;
const MIN_LEGACY_HOLD_MATCH_GAP = 0.75;

function restoreDraftHolds(
  climb: SavedClimb,
  wallHolds: readonly WallHold[],
): DraftHold[] | null {
  const wallHoldsById = new Map(wallHolds.map((hold) => [hold.id, hold]));
  const usedIds = new Set<string>();
  const restored: DraftHold[] = [];

  for (const climbHold of climb.holds) {
    const savedSpot = climbHold.holdId
      ? wallHoldsById.get(climbHold.holdId)
      : undefined;
    if (savedSpot && !usedIds.has(savedSpot.id)) {
      usedIds.add(savedSpot.id);
      restored.push({ holdId: savedSpot.id, role: climbHold.role });
      continue;
    }

    const matches = wallHolds
      .filter((hold) => !usedIds.has(hold.id))
      .map((hold) => ({
        hold,
        distance: Math.hypot(hold.x - climbHold.x, hold.y - climbHold.y),
      }))
      .sort((left, right) => left.distance - right.distance);
    const match = matches[0];
    const runnerUp = matches[1];
    if (
      !match ||
      match.distance > MAX_LEGACY_HOLD_MATCH_DISTANCE ||
      (runnerUp &&
        runnerUp.distance - match.distance < MIN_LEGACY_HOLD_MATCH_GAP)
    ) {
      return null;
    }

    usedIds.add(match.hold.id);
    restored.push({ holdId: match.hold.id, role: climbHold.role });
  }

  return restored;
}

function makeClimbId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export default function SetClimbPage() {
  const { profile } = useActiveUser();
  const [editId, setEditId] = useState<string | null>(null);
  const [editingClimb, setEditingClimb] = useState<SavedClimb | null>(null);
  const [editLoadStatus, setEditLoadStatus] = useState<
    "loading" | "ready" | "not-found" | "error"
  >("loading");
  const [editLoadError, setEditLoadError] = useState("");
  const [backHref, setBackHref] = useState("/climbs");
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
    const searchParams = new URLSearchParams(window.location.search);
    const requestedEditId = searchParams.get("edit")?.trim() || null;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setEditId(requestedEditId);
      setBackHref(
        buildFilteredHref("/climbs", parseClimbFilters(searchParams)),
      );
    });

    async function loadEditor() {
      let wallMap: WallHoldMap;
      try {
        wallMap = await loadWallHoldMap(controller.signal);
        setWallHolds(wallMap.holds);
        setWallRevision(wallMap.updatedAt);
        setHoldMapStatus("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHoldMapStatus("error");
        if (requestedEditId) {
          setEditLoadError("The wall hold spots could not be loaded for editing.");
          setEditLoadStatus("error");
        }
        return;
      }

      if (!requestedEditId) {
        setEditLoadStatus("ready");
        return;
      }

      try {
        const savedClimb = await loadClimb(requestedEditId, controller.signal);
        if (!savedClimb) {
          setEditLoadStatus("not-found");
          return;
        }

        const restoredHolds = restoreDraftHolds(savedClimb, wallMap.holds);
        if (!restoredHolds) {
          setEditLoadError(
            "This climb uses an older hold layout that cannot be matched safely. Adjust the preset hold spots and try again.",
          );
          setEditLoadStatus("error");
          return;
        }

        setEditingClimb(savedClimb);
        setSelectedHolds(restoredHolds);
        setName(savedClimb.name);
        setGrade(savedClimb.grade);
        setEditLoadStatus("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setEditLoadError(
          error instanceof Error
            ? error.message
            : "This climb could not be loaded for editing.",
        );
        setEditLoadStatus("error");
      }
    }

    void loadEditor();

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
  const footCount = selectedHolds.filter(
    (hold) => hold.role === "foot",
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
    if (
      !profile ||
      !trimmedName ||
      !grade ||
      !canFinish ||
      wallRevision === null
    ) {
      return;
    }

    const climb: SavedClimb = {
      id: editingClimb?.id ?? makeClimbId(),
      name: trimmedName,
      grade,
      setter: editingClimb?.setter ?? profile.name,
      profileId: editingClimb?.profileId ?? profile.id,
      createdAt: editingClimb?.createdAt ?? Date.now(),
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
      const savedClimb = editingClimb
        ? await updateClimbInApp(climb, wallRevision, profile.id)
        : await saveClimbToApp(climb, wallRevision, profile.id);
      try {
        persistSavedClimb(window.localStorage, {
          ...savedClimb,
          profileId: profile.id,
        });
      } catch {
        // The durable app copy was saved; the browser copy is only a fallback.
      }
      window.location.assign(
        buildFilteredHref(
          "/climbs/saved",
          parseClimbFilters(new URLSearchParams(window.location.search)),
          { id: savedClimb.id },
        ),
      );
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
        <a className="back-link" href={backHref}>
          <span aria-hidden="true">&larr;</span>
          Climbs
        </a>
        <span>{editId ? "Edit Climb" : "Set Climb"}</span>
      </header>

      {editId && editLoadStatus !== "ready" ? (
        <div className="empty-state">
          {editLoadStatus === "loading" ? (
            <p>Loading climb&hellip;</p>
          ) : editLoadStatus === "not-found" ? (
            <>
              <h1>Climb not found</h1>
              <p>This climb may have been removed.</p>
              <a className="primary-button" href={backHref}>
                View Climbs
              </a>
            </>
          ) : (
            <>
              <h1>Climb could not be edited</h1>
              <p>{editLoadError}</p>
              <a className="primary-button" href={backHref}>
                View Climbs
              </a>
            </>
          )}
        </div>
      ) : step === "holds" ? (
        <>
          <section className="set-intro" aria-labelledby="set-climb-heading">
            <h1 id="set-climb-heading">
              {editingClimb ? "Edit the holds" : "Choose your holds"}
            </h1>
            <p>
              Tap a hold for a blue circle, again for a yellow foothold, then
              for a green start and a red finish. A fifth tap clears it.
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
              const nextRole = selection
                ? nextSavedHoldRole(selection.role)
                : "hand";
              const nextAction = nextRole
                ? holdRoleActions[nextRole]
                : "clear it";
              const accessibleLabel = selection
                ? `${holdRoleAccessibleLabels[selection.role]}. Tap to ${nextAction}.`
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
              Preset hold spots on A Fine Wall. Choose blue climbing holds,
              optional yellow footholds, one or more green start holds, and one
              or more red finish holds.
            </figcaption>
          </figure>

          <div className="set-toolbar">
            <div className="selection-status" aria-live="polite">
              <strong>{selectedHolds.length} holds</strong>
              <span>
                {canFinish
                  ? `${startCount} start / ${footCount} ${footCount === 1 ? "foothold" : "footholds"} / ${finishCount} finish`
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
          <h1 id="finish-heading">
            {editingClimb ? "Edit climb details" : "Name your climb"}
          </h1>
          <p>{selectedHolds.length} holds selected</p>
          <p className="setter-attribution">
            Set by{" "}
            <strong>{editingClimb?.setter ?? profile?.name ?? "your user"}</strong>
          </p>

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
                {isSaving
                  ? "Saving..."
                  : editingClimb
                    ? "Save Changes"
                    : "Save Climb"}
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
