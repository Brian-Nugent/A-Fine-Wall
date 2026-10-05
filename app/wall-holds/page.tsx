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
import HoldOutlines from "../climbs/hold-outlines";
import {
  findHoldAtPoint, isHoldOutline, MAX_OUTLINE_POINTS, moveHoldTo, resizeHoldTo, outlineHitStyle,
  withHoldOutline, type HoldPoint,
} from "../climbs/hold-geometry";
import { isAdminUser } from "../user-access";
import { useActiveUser } from "../user-profile-provider";
import {
  MAX_WALL_HOLD_SIZE,
  MIN_WALL_HOLD_SIZE,
  createWallHold,
  loadWallHoldMap,
  reconcileBrowserClimbsAfterWallSave,
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
  minimumSize: number;
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
  const isAdmin = isAdminUser(profile);
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
  const [draftOutline, setDraftOutline] = useState<HoldPoint[] | null>(null);
  const [redrawingId, setRedrawingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;

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
  }, [isAdmin]);

  useEffect(() => {
    if (!hasChanges && draftOutline === null) return;

    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      if (allowNavigation.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasChanges, draftOutline]);

  const selectedHold = useMemo(
    () => holds.find((hold) => hold.id === selectedHoldId) ?? null,
    [holds, selectedHoldId],
  );
  const selectedHoldIsSaved = Boolean(
    selectedHold && savedHoldIds.has(selectedHold.id),
  );

  if (!isAdmin) {
    return (
      <main className="app-page wall-holds-page">
        <header className="detail-header">
          <a className="back-link" href="/climbs">
            <span aria-hidden="true">&larr;</span>
            Climbs
          </a>
          <span>Wall Setup</span>
        </header>
        <div className="empty-state">
          <h1>Admin only</h1>
          <p>Only Admin can change the wall photo or hold spots.</p>
          <a className="primary-button" href="/climbs">
            View Climbs
          </a>
        </div>
      </main>
    );
  }

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
    const point = { x: clamp(clientX / bounds.width * 100, 0, 100), y: clamp(clientY / bounds.height * 100, 0, 100) };
    if (draftOutline !== null) {
      if (draftOutline.length < MAX_OUTLINE_POINTS) setDraftOutline([...draftOutline, point]);
      else setError(`Use up to ${MAX_OUTLINE_POINTS} points per outline.`);
      return;
    }
    const nearest = findHoldAtPoint(holds, clientX, clientY, bounds.width, bounds.height);
    if (nearest) {
      setSelectedHoldId(nearest.id);
      setError("");
      return;
    }
    setSelectedHoldId(null);
    setRedrawingId(null);
    setDraftOutline([point]);
  }

  function addCenteredHold() {
    if (isLoading || loadFailed || isSaving) return;
    setSelectedHoldId(null);
    setRedrawingId(null);
    setDraftOutline([]);
    setError("");
  }

  function finishOutline() {
    if (!isHoldOutline(draftOutline)) {
      setError("Tap at least three points around the edge of the hold.");
      return;
    }
    const existing = holds.find(hold => hold.id === redrawingId);
    const outlined = withHoldOutline(existing ?? createWallHold(), draftOutline);
    if (existing) {
      setHolds(current => current.map(hold => hold.id === existing.id ? outlined : hold));
      setHasChanges(true);
      setSelectedHoldId(existing.id);
      setError("");
    } else appendHold(outlined);
    setDraftOutline(null);
    setRedrawingId(null);
  }

  function beginDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    hold: WallHold,
  ) {
    if (
      isLoading ||
      loadFailed ||
      isSaving ||
      draftOutline !== null ||
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
          ? moveHoldTo(hold, drag.startX + deltaX, drag.startY + deltaY)
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
    if (!direction || isSaving || draftOutline !== null) return;

    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 2 : hold.outline ? 0.1 : 0.5;
    setSelectedHoldId(hold.id);
    setHolds((current) =>
      current.map((item) =>
        item.id === hold.id
          ? moveHoldTo(item, item.x + direction[0] * step, item.y + direction[1] * step)
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
          ? resizeHoldTo(hold, size)
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
      minimumSize: hold.outline ? 0.1 : MIN_WALL_HOLD_SIZE,
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
        resize.minimumSize,
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
    const minimumSize = hold.outline ? 0.1 : MIN_WALL_HOLD_SIZE;
    const step = event.shiftKey ? 1 : hold.outline ? 0.1 : 0.5;
    if (event.key === "Home") nextSize = minimumSize;
    if (event.key === "End") nextSize = MAX_WALL_HOLD_SIZE;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextSize = hold.size - step;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextSize = hold.size + step;
    }
    if (nextSize === null) return;

    event.preventDefault();
    event.stopPropagation();
    resizeHold(
      hold.id,
      clamp(nextSize, minimumSize, MAX_WALL_HOLD_SIZE),
    );
  }

  function removeSelectedHold() {
    if (!selectedHold || isSaving) return;
    if (
      selectedHoldIsSaved &&
      !window.confirm(
        "Delete this saved hold spot? Climbs that use it will be marked outdated and hidden by default after you save the wall.",
      )
    ) {
      return;
    }

    setHolds((current) => current.filter((hold) => hold.id !== selectedHold.id));
    setSelectedHoldId(null);
    setHasChanges(true);
    setError("");
  }

  function confirmNavigation(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (hasChanges || draftOutline !== null) {
      if (!window.confirm("Discard your unsaved hold spot changes?")) {
        event.preventDefault();
        return;
      }
      allowNavigation.current = true;
    }
  }

  async function saveHoldMap() {
    if (!profile || !isAdminUser(profile) || isLoading || loadFailed || isSaving || draftOutline !== null) {
      return;
    }
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

      const savedMap = await saveWallHolds(
        holds,
        loadedRevision.current,
        profile.id,
      );
      setSavedHoldIds(new Set(savedMap.holds.map((hold) => hold.id)));
      loadedRevision.current = savedMap.updatedAt;
      setHolds(savedMap.holds);
      setHasChanges(false);

      let remainingClimbs: BrowserClimb[] = [];
      if (climbsToMigrate.length > 0) {
        remainingClimbs = await climbsNeedingMigration(
          climbsToMigrate,
          savedMap.updatedAt,
        );
      }

      try {
        persistSavedClimbs(
          window.localStorage,
          reconcileBrowserClimbsAfterWallSave(
            browserClimbs,
            savedMap.holds,
            new Set(remainingClimbs.map((climb) => climb.id)),
          ),
        );
      } catch {
        // The shared wall is already saved, so browser storage cannot block it.
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
          Trace each hold by tapping around its edge, then finish the outline.
          Pinch to zoom for small footholds. Tap an existing hold to adjust it.
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
          original
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
        <HoldOutlines holds={holds} setup selectedId={selectedHoldId} draft={draftOutline ?? undefined} />
        {draftOutline?.map((point, index) => (
          <span className="outline-draft-point" key={index} style={{ left: `${point.x}%`, top: `${point.y}%` }} />
        ))}
        {holds.map((hold, index) => {
          const selected = hold.id === selectedHoldId;
          return (
            <Fragment key={hold.id}>
              <button
                aria-label={`Preset hold ${index + 1}. ${selected ? "Selected; drag or use arrow keys to reposition. Hold Shift for larger keyboard steps." : "Tap to select, or focus it and use arrow keys to reposition."}`}
                aria-pressed={selected}
                className={`wall-hold-spot${selected && draftOutline === null ? " wall-hold-spot--selected" : ""}`}
                disabled={isSaving || draftOutline !== null}
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
                  ...(hold.outline ? outlineHitStyle(hold.outline) : {}),
                } as CSSProperties}
                type="button"
              >
                {hold.outline ? null : <span aria-hidden="true" className="wall-hold-ring" />}
              </button>
              {selected && draftOutline === null ? (
                <span
                  aria-disabled={isSaving ? "true" : undefined}
                  aria-label={`Resize preset hold ${index + 1}`}
                  aria-orientation="horizontal"
                  aria-valuemax={MAX_WALL_HOLD_SIZE}
                  aria-valuemin={hold.outline ? 0.1 : MIN_WALL_HOLD_SIZE}
                  aria-valuenow={hold.size}
                  aria-valuetext={`${hold.size}% hold width`}
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
        {draftOutline !== null ? (
          <div className="outline-trace-controls">
            <p role="status">{redrawingId ? "Redrawing hold" : "New hold"}: {draftOutline.length} points. Tap around the edge in order.</p>
            <div className="wall-hold-control-actions">
              <button className="secondary-button" type="button" disabled={draftOutline.length === 0} onClick={() => setDraftOutline(current => current?.slice(0, -1) ?? [])}>Undo point</button>
              <button className="secondary-button" type="button" onClick={() => { setDraftOutline(null); setRedrawingId(null); setError(""); }}>Cancel</button>
              <button className="compact-primary-button" type="button" disabled={draftOutline.length < 3} onClick={finishOutline}>Finish outline</button>
            </div>
          </div>
        ) : <>
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
            {selectedHold ? (
              <button className="wall-hold-add-button" disabled={isSaving} type="button" onClick={() => { setRedrawingId(selectedHold.id); setDraftOutline([]); setError(""); }}>
                Redraw outline
              </button>
            ) : null}
            {selectedHold ? (
              <button
                className="wall-hold-remove-button"
                disabled={isSaving}
                onClick={removeSelectedHold}
                type="button"
              >
                {selectedHoldIsSaved ? "Delete Hold" : "Remove"}
              </button>
            ) : null}
          </div>
        </div>
        {selectedHold ? (
          <p className="wall-hold-control-help">
            Drag the selected hold to move it, or its right-hand dot to resize it.
            Use Redraw outline to trace a new boundary. Arrow keys make precise adjustments.
          </p>
        ) : (
          <p className="wall-hold-control-help">
            Tap a hold to select it, or Add Hold to trace a new outline.
          </p>
        )}
        </>}
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
          disabled={isLoading || loadFailed || isSaving || draftOutline !== null}
          onClick={saveHoldMap}
          type="button"
        >
          {isSaving ? "Saving..." : "Save Wall"}
        </button>
      </div>
    </main>
  );
}
