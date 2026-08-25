"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ClimbRequestError,
  saveClimb as saveClimbToApp,
} from "../climbs/climb-api";
import {
  attributeSavedClimb,
  persistSavedClimbs,
  readSavedClimbs,
  type AttributedSavedClimb,
} from "../climbs/saved-climbs";
import WallPhoto from "../climbs/wall-photo";
import { useActiveUser } from "../user-profile-provider";
import {
  MAX_WALL_HOLD_SIZE,
  MIN_WALL_HOLD_SIZE,
  createWallHold,
  loadWallHoldMap,
  saveWallHolds,
  type WallHold,
  wallHoldSizeFromHorizontalDrag,
  wallSetupReturnPath,
  WallHoldMapRequestError,
} from "../climbs/wall-holds";

type HoldDrag = {
  holdId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  moved: boolean;
};

type HoldResize = {
  holdId: string;
  pointerId: number;
  startClientX: number;
  startSize: number;
};

const keyboardDirections: Partial<
  Record<string, readonly [number, number]>
> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampHoldCoordinate(value: number, size: number) {
  const radius = size / 2;
  return clamp(value, radius, 100 - radius);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

type BrowserClimb = AttributedSavedClimb;

function isCompletedClimbMigration(error: unknown) {
  return (
    error instanceof ClimbRequestError &&
    (error.status === 410 ||
      (error.status === 409 &&
        error.message === "A climb with this id already exists."))
  );
}

async function climbsNeedingMigration(
  climbs: readonly BrowserClimb[],
  wallRevision: number,
) {
  const results = await Promise.allSettled(
    climbs.map((climb) =>
      saveClimbToApp(climb, wallRevision, climb.profileId),
    ),
  );

  return climbs.filter((_, index) => {
    const result = results[index];
    return (
      result.status === "rejected" &&
      !isCompletedClimbMigration(result.reason)
    );
  });
}

export default function WallHoldsPage() {
  const { profile } = useActiveUser();
  const wallMap = useRef<HTMLElement | null>(null);
  const activeDrag = useRef<HoldDrag | null>(null);
  const activeResize = useRef<HoldResize | null>(null);
  const allowNavigation = useRef(false);
  const loadedRevision = useRef(0);
  const [holds, setHolds] = useState<WallHold[]>([]);
  const [savedHoldIds, setSavedHoldIds] = useState<Set<string>>(new Set());
  const [selectedHoldId, setSelectedHoldId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    void loadWallHoldMap(controller.signal)
      .then((holdMap) => {
        setSavedHoldIds(new Set(holdMap.holds.map((hold) => hold.id)));
        loadedRevision.current = holdMap.updatedAt;
        setHolds(holdMap.holds);
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        setError(
          errorMessage(loadError, "The existing hold spots could not be loaded."),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!hasChanges) return;

    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      if (allowNavigation.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasChanges]);

  const selectedHold = useMemo(
    () => holds.find((hold) => hold.id === selectedHoldId) ?? null,
    [holds, selectedHoldId],
  );
  const selectedHoldIsSaved = Boolean(
    selectedHold && savedHoldIds.has(selectedHold.id),
  );

  function appendHold(hold: WallHold) {
    setHolds((current) => [...current, hold]);
    setSelectedHoldId(hold.id);
    setHasChanges(true);
    setError("");
  }

  function addHold(event: ReactMouseEvent<HTMLButtonElement>) {
    if (event.detail === 0 || isLoading || loadFailed || isSaving) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const clientX = event.clientX - bounds.left;
    const clientY = event.clientY - bounds.top;
    const nearest = holds
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
      setSelectedHoldId(nearest.hold.id);
      setError("");
      return;
    }

    const draft = createWallHold();
    const x = (clientX / bounds.width) * 100;
    const y = (clientY / bounds.height) * 100;
    const hold = {
      ...draft,
      x: Number(clampHoldCoordinate(x, draft.size).toFixed(2)),
      y: Number(clampHoldCoordinate(y, draft.size).toFixed(2)),
    };

    appendHold(hold);
  }

  function addCenteredHold() {
    if (isLoading || loadFailed || isSaving) return;
    appendHold(createWallHold());
  }

  function beginDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    hold: WallHold,
  ) {
    if (
      isLoading ||
      loadFailed ||
      isSaving ||
      activeResize.current !== null ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeDrag.current = {
      holdId: hold.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: hold.x,
      startY: hold.y,
      moved: false,
    };
    setSelectedHoldId(hold.id);
    setError("");
  }

  function moveHold(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = activeDrag.current;
    const bounds = wallMap.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !bounds) return;

    event.preventDefault();
    event.stopPropagation();

    const clientDistance = Math.hypot(
      event.clientX - drag.startClientX,
      event.clientY - drag.startClientY,
    );
    if (clientDistance < 3 && !drag.moved) return;

    drag.moved = true;
    const deltaX = ((event.clientX - drag.startClientX) / bounds.width) * 100;
    const deltaY = ((event.clientY - drag.startClientY) / bounds.height) * 100;

    setHolds((current) =>
      current.map((hold) =>
        hold.id === drag.holdId
          ? {
              ...hold,
              x: Number(
                clampHoldCoordinate(drag.startX + deltaX, hold.size).toFixed(2),
              ),
              y: Number(
                clampHoldCoordinate(drag.startY + deltaY, hold.size).toFixed(2),
              ),
            }
          : hold,
      ),
    );
    setHasChanges(true);
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = activeDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activeDrag.current = null;
  }

  function moveHoldWithKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    hold: WallHold,
  ) {
    const direction = keyboardDirections[event.key];
    if (!direction || isSaving) return;

    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 2 : 0.5;
    setSelectedHoldId(hold.id);
    setHolds((current) =>
      current.map((item) =>
        item.id === hold.id
          ? {
              ...item,
              x: Number(
                clampHoldCoordinate(
                  item.x + direction[0] * step,
                  item.size,
                ).toFixed(2),
              ),
              y: Number(
                clampHoldCoordinate(
                  item.y + direction[1] * step,
                  item.size,
                ).toFixed(2),
              ),
            }
          : item,
      ),
    );
    setHasChanges(true);
    setError("");
  }

  function resizeHold(holdId: string, size: number) {
    if (isSaving) return;
    setHolds((current) =>
      current.map((hold) =>
        hold.id === holdId
          ? {
              ...hold,
              size,
              x: Number(clampHoldCoordinate(hold.x, size).toFixed(2)),
              y: Number(clampHoldCoordinate(hold.y, size).toFixed(2)),
            }
          : hold,
      ),
    );
    setHasChanges(true);
    setError("");
  }

  function beginResize(
    event: ReactPointerEvent<HTMLSpanElement>,
    hold: WallHold,
  ) {
    if (
      isLoading ||
      loadFailed ||
      isSaving ||
      activeDrag.current !== null ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeResize.current = {
      holdId: hold.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startSize: hold.size,
    };
    setSelectedHoldId(hold.id);
    setError("");
  }

  function resizeHoldFromPointer(event: ReactPointerEvent<HTMLSpanElement>) {
    const resize = activeResize.current;
    const bounds = wallMap.current?.getBoundingClientRect();
    if (!resize || resize.pointerId !== event.pointerId || !bounds) return;

    event.preventDefault();
    event.stopPropagation();
    resizeHold(
      resize.holdId,
      wallHoldSizeFromHorizontalDrag(
        resize.startSize,
        event.clientX - resize.startClientX,
        bounds.width,
      ),
    );
  }

  function finishResize(event: ReactPointerEvent<HTMLSpanElement>) {
    const resize = activeResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activeResize.current = null;
  }

  function resizeHoldWithKeyboard(
    event: ReactKeyboardEvent<HTMLSpanElement>,
    hold: WallHold,
  ) {
    if (isSaving) return;

    let nextSize: number | null = null;
    if (event.key === "Home") nextSize = MIN_WALL_HOLD_SIZE;
    if (event.key === "End") nextSize = MAX_WALL_HOLD_SIZE;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextSize = hold.size - (event.shiftKey ? 1 : 0.5);
    }
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextSize = hold.size + (event.shiftKey ? 1 : 0.5);
    }
    if (nextSize === null) return;

    event.preventDefault();
    event.stopPropagation();
    resizeHold(
      hold.id,
      clamp(nextSize, MIN_WALL_HOLD_SIZE, MAX_WALL_HOLD_SIZE),
    );
  }

  function removeSelectedHold() {
    if (!selectedHold || selectedHoldIsSaved || isSaving) return;

    setHolds((current) => current.filter((hold) => hold.id !== selectedHold.id));
    setSelectedHoldId(null);
    setHasChanges(true);
    setError("");
  }

  function confirmNavigation(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (hasChanges) {
      if (!window.confirm("Discard your unsaved hold spot changes?")) {
        event.preventDefault();
        return;
      }
      allowNavigation.current = true;
    }
  }

  async function saveHoldMap() {
    if (!profile || isLoading || loadFailed || isSaving) return;
    if (
      holds.length === 0 &&
      !window.confirm(
        "Save this wall with no preset hold spots? You will not be able to set a climb until spots are added.",
      )
    ) {
      return;
    }

    setIsSaving(true);
    setHasConflict(false);
    setError("");
    try {
      let browserClimbs: BrowserClimb[] = [];
      try {
        const storedClimbs = readSavedClimbs(window.localStorage);
        browserClimbs = storedClimbs.map((climb) =>
          attributeSavedClimb(climb, profile),
        );
        if (browserClimbs.some((climb, index) => climb !== storedClimbs[index])) {
          persistSavedClimbs(window.localStorage, browserClimbs);
        }
      } catch {
        // Shared climbs already in the app remain the source of truth.
      }

      let climbsToMigrate = browserClimbs;
      if (savedHoldIds.size > 0 && browserClimbs.length > 0) {
        climbsToMigrate = await climbsNeedingMigration(
          browserClimbs,
          loadedRevision.current,
        );
      }

      const savedMap = await saveWallHolds(holds, loadedRevision.current);
      setSavedHoldIds(new Set(savedMap.holds.map((hold) => hold.id)));
      loadedRevision.current = savedMap.updatedAt;
      setHolds(savedMap.holds);
      setHasChanges(false);

      if (climbsToMigrate.length > 0) {
        const remainingClimbs = await climbsNeedingMigration(
          climbsToMigrate,
          savedMap.updatedAt,
        );
        if (remainingClimbs.length > 0) {
          const count = remainingClimbs.length;
          setError(
            `Wall saved, but ${count} older ${count === 1 ? "climb" : "climbs"} could not be connected to the preset spots. ${count === 1 ? "It is" : "They are"} still stored on this device. Adjust the circles and save again.`,
          );
          setIsSaving(false);
          return;
        }
      }

      allowNavigation.current = true;
      window.location.assign(wallSetupReturnPath(window.location.href));
    } catch (saveError) {
      setHasConflict(
        saveError instanceof WallHoldMapRequestError &&
          saveError.status === 409,
      );
      setError(errorMessage(saveError, "The hold spots could not be saved."));
      setIsSaving(false);
    }
  }

  function reloadLatestHoldMap() {
    if (
      !window.confirm(
        "Reload the latest hold spots? Your unsaved changes in this editor will be discarded.",
      )
    ) {
      return;
    }

    allowNavigation.current = true;
    window.location.reload();
  }

  return (
    <main className="app-page wall-holds-page">
      <header className="detail-header">
        <a className="back-link" href="/wall-photo" onClick={confirmNavigation}>
          <span aria-hidden="true">&larr;</span>
          Photo
        </a>
        <span>Wall Setup</span>
      </header>

      <section className="set-intro wall-holds-intro" aria-labelledby="wall-holds-heading">
        <h1 id="wall-holds-heading">Mark every hold</h1>
        <p>
          {holds.length > 0
            ? "Your saved spots carried over. Drag any circle that no longer lines up, then tap newly added holds."
            : "Tap each hold on the photo to add a preset circle. You can drag and resize each circle for a precise fit."}
        </p>
      </section>

      {isLoading ? (
        <div className="set-wall-notice" role="status">
          Loading saved hold spots&hellip;
        </div>
      ) : null}
      {loadFailed ? (
        <div className="set-wall-notice">
          <p>{error}</p>
          <button
            className="secondary-button"
            onClick={() => window.location.reload()}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}

      <figure className="wall-map set-wall wall-holds-map" ref={wallMap}>
        <WallPhoto
          alt="Climbing wall ready for preset hold spots"
          className="wall-photo"
          draggable="false"
          height="1448"
          width="1086"
        />
        <button
          aria-label="Tap the wall to add a preset hold spot"
          className="wall-holds-tap-layer"
          disabled={isLoading || loadFailed || isSaving}
          onClick={addHold}
          tabIndex={-1}
          type="button"
        />
        {holds.map((hold, index) => {
          const selected = hold.id === selectedHoldId;
          return (
            <Fragment key={hold.id}>
              <button
                aria-label={`Preset hold ${index + 1}. ${selected ? "Selected; drag or use arrow keys to reposition. Hold Shift for larger keyboard steps." : "Tap to select, or focus it and use arrow keys to reposition."}`}
                aria-pressed={selected}
                className={`wall-hold-spot${selected ? " wall-hold-spot--selected" : ""}`}
                disabled={isSaving}
                onClick={(event) => {
                  event.stopPropagation();
                  if (event.detail === 0) setSelectedHoldId(hold.id);
                }}
                onLostPointerCapture={() => {
                  if (activeDrag.current?.holdId === hold.id) {
                    activeDrag.current = null;
                  }
                }}
                onFocus={() => setSelectedHoldId(hold.id)}
                onKeyDown={(event) => moveHoldWithKeyboard(event, hold)}
                onPointerCancel={finishDrag}
                onPointerDown={(event) => beginDrag(event, hold)}
                onPointerMove={moveHold}
                onPointerUp={finishDrag}
                style={{
                  left: `${hold.x}%`,
                  top: `${hold.y}%`,
                  "--hold-size": hold.size,
                } as CSSProperties}
                type="button"
              >
                <span aria-hidden="true" className="wall-hold-ring" />
              </button>
              {selected ? (
                <span
                  aria-disabled={isSaving ? "true" : undefined}
                  aria-label={`Resize preset hold ${index + 1}`}
                  aria-orientation="horizontal"
                  aria-valuemax={MAX_WALL_HOLD_SIZE}
                  aria-valuemin={MIN_WALL_HOLD_SIZE}
                  aria-valuenow={hold.size}
                  aria-valuetext={`${hold.size}% circle diameter`}
                  className="wall-hold-resize-handle"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => resizeHoldWithKeyboard(event, hold)}
                  onLostPointerCapture={() => {
                    if (activeResize.current?.holdId === hold.id) {
                      activeResize.current = null;
                    }
                  }}
                  onPointerCancel={finishResize}
                  onPointerDown={(event) => beginResize(event, hold)}
                  onPointerMove={resizeHoldFromPointer}
                  onPointerUp={finishResize}
                  role="slider"
                  style={{
                    left: `min(${hold.x + hold.size / 2}%, calc(100% - 0.5rem))`,
                    top: `${hold.y}%`,
                  }}
                  tabIndex={isSaving ? -1 : 0}
                >
                  <span
                    aria-hidden="true"
                    className="wall-hold-resize-handle-dot"
                  />
                </span>
              ) : null}
            </Fragment>
          );
        })}
        <figcaption className="sr-only">
          {holds.length} preset hold {holds.length === 1 ? "spot" : "spots"} marked on the wall.
        </figcaption>
      </figure>

      <section className="wall-hold-editor-controls" aria-label="Selected hold controls">
        <div className="wall-hold-control-heading">
          <strong>{selectedHold ? "Selected hold" : "Hold controls"}</strong>
          <div className="wall-hold-control-actions">
            <button
              className="wall-hold-add-button"
              disabled={isLoading || loadFailed || isSaving}
              onClick={addCenteredHold}
              type="button"
            >
              Add Hold
            </button>
            {selectedHold && !selectedHoldIsSaved ? (
              <button
                className="wall-hold-remove-button"
                disabled={isSaving}
                onClick={removeSelectedHold}
                type="button"
              >
                Remove
              </button>
            ) : selectedHoldIsSaved ? (
              <span className="wall-hold-saved-label">Saved spot</span>
            ) : null}
          </div>
        </div>
        {selectedHold ? (
          <p className="wall-hold-control-help">
            Drag the dot on the circle&apos;s right edge to resize it. Focus the
            dot and use arrow keys for precise sizing.
          </p>
        ) : (
          <p className="wall-hold-control-help">
            Tap a circle to select it. Drag a selected circle to reposition it.
          </p>
        )}
      </section>

      {(error || hasConflict) && !loadFailed ? (
        <div className="form-error wall-holds-error" role="alert">
          <p>{error || "The saved wall spots changed."}</p>
          {hasConflict ? (
            <button
              className="wall-hold-reload-button"
              onClick={reloadLatestHoldMap}
              type="button"
            >
              Reload Latest
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="set-toolbar wall-holds-toolbar">
        <div className="selection-status" aria-live="polite">
          <strong>{holds.length} hold {holds.length === 1 ? "spot" : "spots"}</strong>
          <span>{hasChanges ? "Unsaved changes" : "All changes saved"}</span>
        </div>
        <button
          className="compact-primary-button wall-holds-save-button"
          disabled={isLoading || loadFailed || isSaving}
          onClick={saveHoldMap}
          type="button"
        >
          {isSaving ? "Saving..." : "Save Wall"}
        </button>
      </div>
    </main>
  );
}
