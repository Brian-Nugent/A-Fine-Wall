"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import {
  ClimbRequestError,
  deleteClimb,
  loadClimb,
  loadClimbs,
} from "../climb-api";
import {
  climbActivityKey,
  type ClimbActivity,
  type ClimbReference,
} from "../climb-activity";
import {
  readSavedClimbs,
  removeSavedClimb,
  type SavedClimb,
} from "../saved-climbs";
import {
  loadWallHolds,
  resolveSavedHold,
  type WallHold,
} from "../wall-holds";
import WallPhoto from "../wall-photo";
import ClimbActivityPanel from "../climb-activity-panel";
import {
  adjacentClimbIds,
  buildFilteredHref,
  requiresClimbActivity,
  serializeClimbFilters,
  type ClimbFilters,
} from "../climb-filters";
import {
  adjacentClimbReferences,
  clearSessionClimbNavigationSnapshot,
  readSessionClimbNavigationSnapshot,
} from "../climb-navigation-snapshot";
import { loadClimbActivities } from "../send-api";
import {
  horizontalSwipeDirection,
  type SwipePoint,
  type SwipeIntent,
  updateSwipeIntent,
} from "../swipe-gesture";
import { canManageClimb } from "../../user-access";
import { useActiveUser } from "../../user-profile-provider";

function navigationHref(
  reference: ClimbReference | null,
  filters: ClimbFilters,
) {
  if (!reference) return null;
  return reference.climbKind === "saved"
    ? buildFilteredHref("/climbs/saved", filters, {
        id: reference.climbId,
      })
    : buildFilteredHref(`/climbs/${reference.climbId}`, filters);
}

type TouchCollection = {
  length: number;
  item(index: number): {
    clientX: number;
    clientY: number;
    identifier: number;
  } | null;
};

function findTouch(touches: TouchCollection, identifier: number) {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch?.identifier === identifier) return touch;
  }
  return null;
}

function ClimbPagerLink({
  direction,
  href,
}: {
  direction: "previous" | "next";
  href: string | null;
}) {
  const label = direction === "previous" ? "Previous climb" : "Next climb";
  const content = direction === "previous"
    ? <><span aria-hidden="true">&larr;</span> Previous</>
    : <>Next <span aria-hidden="true">&rarr;</span></>;

  return href ? (
    <a
      aria-label={label}
      className={`climb-pager-link climb-pager-link--${direction}`}
      href={href}
    >
      {content}
    </a>
  ) : (
    <span
      aria-disabled="true"
      className={`climb-pager-link climb-pager-link--${direction} climb-pager-link--disabled`}
    >
      {content}
    </span>
  );
}

function DetailShell({
  backHref,
  children,
  endAction,
  status,
}: {
  backHref: string;
  children: ReactNode;
  endAction?: ReactNode;
  status?: string;
}) {
  const [isLeaving, setIsLeaving] = useState(false);

  function leaveForClimbs(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    if (isLeaving) return;
    setIsLeaving(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.location.assign(backHref));
    });
  }

  return (
    <main className="app-page detail-page">
      <header className="detail-header">
        <a
          aria-busy={isLeaving ? "true" : undefined}
          aria-disabled={isLeaving ? "true" : undefined}
          className={`back-link${isLeaving ? " back-link--loading" : ""}`}
          href={backHref}
          onClick={leaveForClimbs}
        >
          {isLeaving ? (
            <>
              <span aria-hidden="true" className="back-link-spinner" />
              Loading climbs&hellip;
            </>
          ) : (
            <>
              <span aria-hidden="true">&larr;</span>
              Climbs
            </>
          )}
        </a>
        {endAction ?? <span>{status}</span>}
      </header>
      {children}
    </main>
  );
}

function ClimbOptions({
  editHref,
  isDeleting,
  onDelete,
}: {
  editHref: string;
  isDeleting: boolean;
  onDelete(): void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!isOpen) return;

    function closeFromOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    function closeWithEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      buttonRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [isOpen]);

  return (
    <div className="climb-options" ref={containerRef}>
      <button
        aria-controls={popoverId}
        aria-expanded={isOpen}
        aria-label="Climb options"
        className="climb-options-button"
        onClick={() => setIsOpen((current) => !current)}
        ref={buttonRef}
        type="button"
      >
        <span aria-hidden="true">&#8942;</span>
      </button>
      {isOpen ? (
        <div className="climb-options-popover" id={popoverId}>
          <a className="climb-option" href={editHref}>
            Edit climb
          </a>
          <button
            className="climb-option climb-option--delete"
            disabled={isDeleting}
            onClick={() => {
              setIsOpen(false);
              onDelete();
            }}
            type="button"
          >
            {isDeleting ? "Deleting…" : "Delete climb"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function SavedClimbDetail({
  backHref,
  climbId,
  filters,
  initialClimb,
}: {
  backHref: string;
  climbId: string;
  filters: ClimbFilters;
  initialClimb?: SavedClimb;
}) {
  const { profile } = useActiveUser();
  const [climb, setClimb] = useState<SavedClimb | null | undefined>(
    initialClimb,
  );
  const [wallHolds, setWallHolds] = useState<WallHold[]>([]);
  const [swipeHrefs, setSwipeHrefs] = useState<{
    previous: string | null;
    next: string | null;
  }>({ previous: null, next: null });
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const swipeStartRef = useRef<{
    touchIdentifier: number;
    point: SwipePoint;
    viewportWidth: number;
    intent: SwipeIntent;
  } | null>(null);
  const mouseSwipeStartRef = useRef<{
    pointerId: number;
    point: SwipePoint;
    viewportWidth: number;
  } | null>(null);
  const isSwipeNavigatingRef = useRef(false);

  useEffect(() => {
    function cancelInterruptedSwipe() {
      swipeStartRef.current = null;
      mouseSwipeStartRef.current = null;
    }

    document.addEventListener("visibilitychange", cancelInterruptedSwipe);
    return () => {
      document.removeEventListener("visibilitychange", cancelInterruptedSwipe);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;
    let browserClimb: SavedClimb | null = null;

    try {
      browserClimb = readSavedClimbs(window.localStorage).find(
        (item) => item.id === climbId,
      ) ?? null;
    } catch {
      browserClimb = null;
    }

    const fallbackClimb = initialClimb ?? browserClimb;
    if (!initialClimb && browserClimb) {
      queueMicrotask(() => {
        if (isActive) setClimb(browserClimb);
      });
    }

    loadClimb(climbId, controller.signal)
      .then((savedClimb) => setClimb(savedClimb ?? fallbackClimb))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (error instanceof ClimbRequestError && error.status === 410) {
          try {
            removeSavedClimb(window.localStorage, climbId);
          } catch {
            // The durable tombstone still prevents this copy from returning.
          }
          setClimb(null);
          return;
        }
        setClimb(fallbackClimb);
      });

    loadWallHolds(controller.signal)
      .then(setWallHolds)
      .catch(() => {
        // Coordinate snapshots keep the climb view usable if spots are offline.
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [climbId, initialClimb]);

  useEffect(() => {
    if (!profile) return;

    const serializedFilters = serializeClimbFilters(filters);
    const snapshot = readSessionClimbNavigationSnapshot(
      window,
      profile.id,
      serializedFilters,
    );
    if (snapshot) {
      const adjacent = adjacentClimbReferences(snapshot, {
        climbKind: "saved",
        climbId,
      });
      if (adjacent) {
        let isActive = true;
        queueMicrotask(() => {
          if (!isActive) return;
          setSwipeHrefs({
            previous: navigationHref(adjacent.previous, filters),
            next: navigationHref(adjacent.next, filters),
          });
        });
        return () => {
          isActive = false;
        };
      }
    }

    const controller = new AbortController();
    let isActive = true;
    let browserClimbs: SavedClimb[] = [];
    try {
      browserClimbs = readSavedClimbs(window.localStorage);
    } catch {
      browserClimbs = [];
    }

    const needsActivity = requiresClimbActivity(filters);
    const sharedClimbsRequest = loadClimbs(controller.signal).catch(
      (error: unknown) => {
        if (controller.signal.aborted) throw error;
        return [];
      },
    );
    const activitiesRequest: Promise<ClimbActivity[]> = needsActivity
      ? loadClimbActivities(profile.id, controller.signal)
      : Promise.resolve([]);

    Promise.all([sharedClimbsRequest, activitiesRequest])
      .then(([sharedClimbs, activities]) => {
        if (!isActive) return;

        const sharedIds = new Set(sharedClimbs.map((item) => item.id));
        const availableClimbs = [
          ...sharedClimbs,
          ...browserClimbs.filter((item) => !sharedIds.has(item.id)),
        ];
        const activitiesByClimb = new Map(
          activities.map((activity) => [
            climbActivityKey(activity),
            activity,
          ]),
        );
        const adjacent = adjacentClimbIds(
          availableClimbs.map((item) => ({
            ...item,
            activity:
              activitiesByClimb.get(
                climbActivityKey({
                  climbKind: "saved",
                  climbId: item.id,
                }),
              ) ?? null,
          })),
          climbId,
          filters,
        );

        setSwipeHrefs({
          previous: adjacent.previousId
            ? buildFilteredHref("/climbs/saved", filters, {
                id: adjacent.previousId,
              })
            : null,
          next: adjacent.nextId
            ? buildFilteredHref("/climbs/saved", filters, {
                id: adjacent.nextId,
              })
            : null,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (isActive) setSwipeHrefs({ previous: null, next: null });
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [climbId, filters, profile]);

  function startSwipe(event: ReactTouchEvent<HTMLElement>) {
    if (isSwipeNavigatingRef.current) return;
    if (
      event.touches.length !== 1 ||
      (window.visualViewport?.scale ?? 1) > 1.01
    ) {
      swipeStartRef.current = null;
      return;
    }

    const touch = event.touches.item(0);
    if (!touch) return;
    swipeStartRef.current = {
      touchIdentifier: touch.identifier,
      point: { x: touch.clientX, y: touch.clientY, time: event.timeStamp },
      viewportWidth: window.innerWidth,
      intent: "pending",
    };
  }

  function moveSwipe(event: ReactTouchEvent<HTMLElement>) {
    const swipeStart = swipeStartRef.current;
    if (
      !swipeStart ||
      event.touches.length !== 1 ||
      (window.visualViewport?.scale ?? 1) > 1.01
    ) {
      swipeStartRef.current = null;
      return;
    }

    const touch = findTouch(event.touches, swipeStart.touchIdentifier);
    if (!touch) {
      swipeStartRef.current = null;
      return;
    }

    const intent = updateSwipeIntent(
      swipeStart.intent,
      swipeStart.point,
      { x: touch.clientX, y: touch.clientY, time: event.timeStamp },
    );
    swipeStartRef.current =
      intent === "vertical" ? null : { ...swipeStart, intent };
  }

  function finishSwipe(event: ReactTouchEvent<HTMLElement>) {
    const swipeStart = swipeStartRef.current;
    swipeStartRef.current = null;
    if (
      !swipeStart ||
      event.touches.length > 0 ||
      (window.visualViewport?.scale ?? 1) > 1.01
    ) return;

    const touch = findTouch(event.changedTouches, swipeStart.touchIdentifier);
    if (!touch) return;
    const endPoint = {
      x: touch.clientX,
      y: touch.clientY,
      time: event.timeStamp,
    };
    const intent = updateSwipeIntent(
      swipeStart.intent,
      swipeStart.point,
      endPoint,
    );
    if (intent !== "horizontal") return;

    navigateFromSwipe(swipeStart.point, endPoint, swipeStart.viewportWidth);
  }

  function startMouseSwipe(event: ReactPointerEvent<HTMLElement>) {
    if (
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      isSwipeNavigatingRef.current ||
      (window.visualViewport?.scale ?? 1) > 1.01
    ) return;

    mouseSwipeStartRef.current = {
      pointerId: event.pointerId,
      point: { x: event.clientX, y: event.clientY, time: event.timeStamp },
      viewportWidth: window.innerWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function finishMouseSwipe(event: ReactPointerEvent<HTMLElement>) {
    const swipeStart = mouseSwipeStartRef.current;
    mouseSwipeStartRef.current = null;
    if (
      event.pointerType !== "mouse" ||
      !swipeStart ||
      swipeStart.pointerId !== event.pointerId ||
      (window.visualViewport?.scale ?? 1) > 1.01
    ) return;

    navigateFromSwipe(
      swipeStart.point,
      { x: event.clientX, y: event.clientY, time: event.timeStamp },
      swipeStart.viewportWidth,
    );
  }

  function cancelMouseSwipe() {
    mouseSwipeStartRef.current = null;
  }

  function navigateFromSwipe(
    start: SwipePoint,
    end: SwipePoint,
    viewportWidth: number,
  ) {
    const direction = horizontalSwipeDirection(start, end, viewportWidth);
    const destination = direction ? swipeHrefs[direction] : null;
    if (!destination) return;

    isSwipeNavigatingRef.current = true;
    window.location.assign(destination);
  }

  function cancelSwipe() {
    swipeStartRef.current = null;
  }

  async function handleDeleteClimb(climbToDelete: SavedClimb) {
    if (!profile || !canManageClimb(profile, climbToDelete.setter)) {
      setDeleteError("You can only delete climbs you set.");
      return;
    }

    if (
      !window.confirm(
        `Delete “${climbToDelete.name}”? This removes it from every device and cannot be undone.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);
    setDeleteError("");
    try {
      await deleteClimb(climbToDelete.id, profile.id);
      try {
        removeSavedClimb(window.localStorage, climbToDelete.id);
      } catch {
        // The durable deletion prevents a stale browser copy from returning.
      }
      clearSessionClimbNavigationSnapshot(window);
      window.location.replace(backHref);
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "This climb could not be deleted. Please try again.",
      );
      setIsDeleting(false);
    }
  }

  if (climb === undefined) {
    return (
      <DetailShell backHref={backHref}>
        <p aria-live="polite" className="sr-only">
          Preparing the selected climb.
        </p>
      </DetailShell>
    );
  }

  if (climb === null) {
    return (
      <DetailShell backHref={backHref} status="Not found">
        <div className="empty-state">
          <h1>Climb not found</h1>
          <p>This climb may have been removed or is temporarily unavailable.</p>
          <a className="primary-button" href={backHref}>
            View Climbs
          </a>
        </div>
      </DetailShell>
    );
  }

  const resolvedHolds = climb.holds.map((hold) =>
    resolveSavedHold(hold, wallHolds),
  );
  const startCount = resolvedHolds.filter((hold) => hold.role === "start").length;
  const handCount = resolvedHolds.filter((hold) => hold.role === "hand").length;
  const footCount = resolvedHolds.filter((hold) => hold.role === "foot").length;
  const finishCount = resolvedHolds.filter((hold) => hold.role === "finish").length;
  const editHref = buildFilteredHref("/set-climb", filters, {
    edit: climb.id,
  });
  const canManage = canManageClimb(profile, climb.setter);

  return (
    <DetailShell
      backHref={backHref}
      status={climb.grade}
      endAction={
        canManage ? (
          <ClimbOptions
            editHref={editHref}
            isDeleting={isDeleting}
            onDelete={() => handleDeleteClimb(climb)}
          />
        ) : undefined
      }
    >
      <section aria-labelledby="climb-name">
        <div className="detail-title">
          <div>
            <h1 id="climb-name">{climb.name}</h1>
            <p>Set by {climb.setter}</p>
          </div>
          <strong>{climb.grade}</strong>
        </div>

        {deleteError ? (
          <p className="form-error climb-action-error" role="alert">
            {deleteError}
          </p>
        ) : null}

        <figure
          className="wall-map wall-map--route"
          onLostPointerCapture={cancelMouseSwipe}
          onPointerCancel={cancelMouseSwipe}
          onPointerDown={startMouseSwipe}
          onPointerUp={finishMouseSwipe}
          onTouchCancel={cancelSwipe}
          onTouchEnd={finishSwipe}
          onTouchMove={moveSwipe}
          onTouchStart={startSwipe}
        >
          <WallPhoto
            className="wall-photo"
            alt="Climbing wall with the route holds marked"
            draggable={false}
            width="1086"
            height="1448"
          />
          {resolvedHolds.map((hold, index) => (
            <span
              aria-hidden="true"
              className={`hold-marker hold-marker--${hold.role}`}
              key={hold.holdId || `${hold.x}-${hold.y}-${index}`}
              style={{
                left: `${hold.x}%`,
                top: `${hold.y}%`,
                width: `${hold.size}%`,
              }}
            />
          ))}
          <figcaption className="sr-only">
            {climb.name} uses {startCount} green-circled start{" "}
            {startCount === 1 ? "hold" : "holds"}, {handCount} blue-circled
            climbing {handCount === 1 ? "hold" : "holds"}, {footCount}{" "}
            yellow-circled {footCount === 1 ? "foothold" : "footholds"}, and{" "}
            {finishCount} red-circled finish{" "}
            {finishCount === 1 ? "hold" : "holds"}.
          </figcaption>
        </figure>

        <nav aria-label="Browse climbs" className="climb-pager">
          <ClimbPagerLink direction="previous" href={swipeHrefs.previous} />
          <ClimbPagerLink direction="next" href={swipeHrefs.next} />
        </nav>

        <ClimbActivityPanel
          filters={filters}
          reference={{ climbKind: "saved", climbId: climb.id }}
        />
      </section>
    </DetailShell>
  );
}
