"use client";

import {
  useCallback,
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
  setRockoApproval,
} from "../climb-api";
import {
  climbActivityKey,
  type ClimbActivity,
  type ClimbReference,
} from "../climb-activity";
import {
  readSavedClimbs,
  removeSavedClimb,
  persistSavedClimbs,
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
  buildFilteredHref,
  requiresClimbActivity,
  selectVisibleClimbs,
  serializeClimbFilters,
  type ClimbFilters,
} from "../climb-filters";
import {
  adjacentClimbReferencesInOrder,
  clearSessionClimbNavigationSnapshot,
  readSessionClimbNavigationSnapshot,
  type NavigationClimbReference,
} from "../climb-navigation-snapshot";
import { loadClimbActivities } from "../send-api";
import { loadSyncedClimbs } from "../synced-climbs";
import {
  horizontalSwipeDirection,
  type SwipePoint,
  type SwipeIntent,
  updateSwipeIntent,
} from "../swipe-gesture";
import { canManageClimb, isAdminUser } from "../../user-access";
import { useActiveUser } from "../../user-profile-provider";

type ClimbNavigationTarget = {
  href: string;
  reference: NavigationClimbReference;
};

type NavigationState = {
  entries: readonly NavigationClimbReference[];
  filters: string;
  profileId: string | null;
};

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

function navigationTarget(
  reference: NavigationClimbReference | null,
  filters: ClimbFilters,
): ClimbNavigationTarget | null {
  const href = navigationHref(reference, filters);
  return reference && href ? { href, reference } : null;
}

function readBrowserClimb(climbId: string) {
  try {
    return (
      readSavedClimbs(window.localStorage).find(
        (item) => item.id === climbId,
      ) ?? null
    );
  } catch {
    return null;
  }
}

async function loadClimbWithBrowserFallback(climbId: string) {
  const browserClimb = readBrowserClimb(climbId);

  try {
    return (await loadClimb(climbId)) ?? browserClimb;
  } catch (error) {
    if (error instanceof ClimbRequestError && error.status === 410) {
      try {
        removeSavedClimb(window.localStorage, climbId);
      } catch {
        // The durable tombstone still prevents this copy from returning.
      }
      return null;
    }
    if (browserClimb) return browserClimb;
    throw error;
  }
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
        {endAction ?? (status ? <span>{status}</span> : null)}
      </header>
      {children}
    </main>
  );
}

function ClimbOptions({
  canChangeApproval,
  editHref,
  isApproving,
  isDeleting,
  onChangeApproval,
  onDelete,
  rockoApproved,
}: {
  canChangeApproval: boolean;
  editHref: string;
  isApproving: boolean;
  isDeleting: boolean;
  onChangeApproval(rockoApproved: boolean): void;
  onDelete(): void;
  rockoApproved: boolean;
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

  const approvalActionLabel = isApproving
    ? rockoApproved
      ? "Removing Rocko's Approval…"
      : "Giving Rocko's Approval…"
    : rockoApproved
      ? "Remove Rocko's Approval"
      : "Give Rocko's Approval";

  return (
    <div className="climb-options" ref={containerRef}>
      <button
        aria-controls={popoverId}
        aria-expanded={isOpen}
        aria-label="Climb options"
        className="climb-options-button"
        disabled={isApproving || isDeleting}
        onClick={() => setIsOpen((current) => !current)}
        ref={buttonRef}
        type="button"
      >
        <span aria-hidden="true">&#8942;</span>
      </button>
      {isOpen ? (
        <div className="climb-options-popover" id={popoverId}>
          {canChangeApproval ? (
            <button
              className="climb-option"
              disabled={isApproving || isDeleting}
              onClick={() => {
                setIsOpen(false);
                onChangeApproval(!rockoApproved);
              }}
              type="button"
            >
              {approvalActionLabel}
            </button>
          ) : null}
          <a className="climb-option" href={editHref}>
            Edit climb
          </a>
          <button
            className="climb-option climb-option--delete"
            disabled={isApproving || isDeleting}
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
  const [activeClimbId, setActiveClimbId] = useState(climbId);
  const [climb, setClimb] = useState<SavedClimb | null | undefined>(
    initialClimb,
  );
  const [wallHolds, setWallHolds] = useState<WallHold[]>([]);
  const [navigationState, setNavigationState] = useState<NavigationState>({
    entries: [],
    filters: "",
    profileId: null,
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [actionError, setActionError] = useState("");
  const activeClimbIdRef = useRef(climbId);
  const climbCacheRef = useRef<Map<string, SavedClimb | null>>(
    new Map(initialClimb ? [[climbId, initialClimb]] : []),
  );
  const pendingClimbLoadsRef = useRef<
    Map<string, Promise<SavedClimb | null>>
  >(new Map());
  const transitionTokenRef = useRef(0);
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

  const removeUnavailableClimbFromNavigation = useCallback(
    (unavailableClimbId: string) => {
      setNavigationState((current) => ({
        ...current,
        entries: current.entries.filter(
          (entry) =>
            entry.climbKind !== "saved" ||
            entry.climbId !== unavailableClimbId,
        ),
      }));
      clearSessionClimbNavigationSnapshot(window);
    },
    [],
  );

  const ensureClimbCached = useCallback((targetClimbId: string) => {
    if (climbCacheRef.current.has(targetClimbId)) {
      return Promise.resolve(
        climbCacheRef.current.get(targetClimbId) ?? null,
      );
    }

    const pending = pendingClimbLoadsRef.current.get(targetClimbId);
    if (pending) return pending;

    const request = loadClimbWithBrowserFallback(targetClimbId)
      .then((loadedClimb) => {
        climbCacheRef.current.set(targetClimbId, loadedClimb);
        pendingClimbLoadsRef.current.delete(targetClimbId);
        return loadedClimb;
      })
      .catch((error: unknown) => {
        pendingClimbLoadsRef.current.delete(targetClimbId);
        throw error;
      });
    pendingClimbLoadsRef.current.set(targetClimbId, request);
    return request;
  }, []);

  useEffect(() => {
    function cancelInterruptedSwipe() {
      swipeStartRef.current = null;
      mouseSwipeStartRef.current = null;
    }

    document.addEventListener("visibilitychange", cancelInterruptedSwipe);
    return () => {
      document.removeEventListener("visibilitychange", cancelInterruptedSwipe);
      transitionTokenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (initialClimb) return;

    let isActive = true;
    void ensureClimbCached(climbId)
      .then((loadedClimb) => {
        if (isActive && activeClimbIdRef.current === climbId) {
          setClimb(loadedClimb);
        }
      })
      .catch(() => {
        // Keep the quiet preparing state if neither shared nor local data loads.
      });

    return () => {
      isActive = false;
    };
  }, [climbId, ensureClimbCached, initialClimb]);

  useEffect(() => {
    const controller = new AbortController();
    loadWallHolds(controller.signal)
      .then(setWallHolds)
      .catch(() => {
        // Coordinate snapshots keep the climb view usable if spots are offline.
      });
    return () => controller.abort();
  }, []);

  const serializedFilters = serializeClimbFilters(filters);

  useEffect(() => {
    if (!profile) return;

    const snapshot = readSessionClimbNavigationSnapshot(
      window,
      profile.id,
      serializedFilters,
    );
    const snapshotAdjacent = snapshot
      ? adjacentClimbReferencesInOrder(snapshot.entries, {
          climbKind: "saved",
          climbId,
        })
      : null;
    if (snapshot && snapshotAdjacent !== null) {
      let isActive = true;
      queueMicrotask(() => {
        if (!isActive) return;
        setNavigationState({
          entries: snapshot.entries,
          filters: serializedFilters,
          profileId: profile.id,
        });
      });
      return () => {
        isActive = false;
      };
    }

    const controller = new AbortController();
    let isActive = true;
    const needsActivity = requiresClimbActivity(filters);
    const syncedClimbsRequest = loadSyncedClimbs(
      profile,
      window.localStorage,
      controller.signal,
    );
    const activitiesRequest: Promise<ClimbActivity[]> = needsActivity
      ? loadClimbActivities(profile.id, controller.signal)
      : Promise.resolve([]);

    Promise.all([syncedClimbsRequest, activitiesRequest])
      .then(([syncedClimbs, activities]) => {
        if (!isActive) return;

        const activitiesByClimb = new Map(
          activities.map((activity) => [
            climbActivityKey(activity),
            activity,
          ]),
        );
        const visibleClimbs = selectVisibleClimbs(
          syncedClimbs.climbs.map((item) => ({
            ...item,
            activity:
              activitiesByClimb.get(
                climbActivityKey({
                  climbKind: "saved",
                  climbId: item.id,
                }),
              ) ?? null,
          })),
          filters,
        );

        setNavigationState({
          entries: visibleClimbs.map((item) => ({
            climbKind: "saved",
            climbId: item.id,
          })),
          filters: serializedFilters,
          profileId: profile.id,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (isActive) {
          setNavigationState({
            entries: [],
            filters: serializedFilters,
            profileId: profile.id,
          });
        }
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [climbId, filters, profile, serializedFilters]);

  const navigationEntries =
    navigationState.profileId === profile?.id &&
    navigationState.filters === serializedFilters
      ? navigationState.entries
      : [];
  const adjacentReferences = adjacentClimbReferencesInOrder(
    navigationEntries,
    { climbKind: "saved", climbId: activeClimbId },
  );
  const navigationTargets = {
    previous: navigationTarget(adjacentReferences?.previous ?? null, filters),
    next: navigationTarget(adjacentReferences?.next ?? null, filters),
  };
  const previousSavedId =
    navigationTargets.previous?.reference.climbKind === "saved"
      ? navigationTargets.previous.reference.climbId
      : null;
  const nextSavedId =
    navigationTargets.next?.reference.climbKind === "saved"
      ? navigationTargets.next.reference.climbId
      : null;

  useEffect(() => {
    for (const targetClimbId of [previousSavedId, nextSavedId]) {
      if (!targetClimbId) continue;
      void ensureClimbCached(targetClimbId)
        .then((loadedClimb) => {
          if (!loadedClimb) {
            removeUnavailableClimbFromNavigation(targetClimbId);
          }
        })
        .catch(() => {
          // The real link remains available if an eager load fails.
        });
    }
  }, [
    ensureClimbCached,
    nextSavedId,
    previousSavedId,
    removeUnavailableClimbFromNavigation,
  ]);

  const transitionToTarget = useCallback(async (
    target: ClimbNavigationTarget,
  ) => {
    if (target.reference.climbKind !== "saved") {
      window.location.assign(target.href);
      return;
    }
    if (
      target.reference.climbId === activeClimbIdRef.current ||
      isSwipeNavigatingRef.current ||
      isDeleting ||
      isApproving
    ) {
      return;
    }

    const transitionToken = transitionTokenRef.current + 1;
    transitionTokenRef.current = transitionToken;
    isSwipeNavigatingRef.current = true;

    try {
      const nextClimb = await ensureClimbCached(target.reference.climbId);
      if (transitionTokenRef.current !== transitionToken) return;
      if (!nextClimb || nextClimb.id !== target.reference.climbId) {
        removeUnavailableClimbFromNavigation(target.reference.climbId);
        return;
      }

      try {
        // Keep the visible climb URL canonical without adding shallow entries
        // that would compete with Vinext's router during Back/Forward traversal.
        window.history.replaceState(window.history.state, "", target.href);
      } catch {
        window.location.assign(target.href);
        return;
      }

      activeClimbIdRef.current = nextClimb.id;
      setActiveClimbId(nextClimb.id);
      setClimb(nextClimb);
      setActionError("");
      setIsDeleting(false);
      setIsApproving(false);
    } catch {
      if (transitionTokenRef.current !== transitionToken) return;
      window.location.assign(target.href);
    } finally {
      if (transitionTokenRef.current === transitionToken) {
        isSwipeNavigatingRef.current = false;
      }
    }
  }, [
    ensureClimbCached,
    isApproving,
    isDeleting,
    removeUnavailableClimbFromNavigation,
  ]);

  function startSwipe(event: ReactTouchEvent<HTMLElement>) {
    if (isSwipeNavigatingRef.current || isDeleting || isApproving) return;
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
      isDeleting ||
      isApproving ||
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
    const target = direction ? navigationTargets[direction] : null;
    if (!direction || !target) return;

    void transitionToTarget(target);
  }

  function cancelSwipe() {
    swipeStartRef.current = null;
  }

  async function handleDeleteClimb(climbToDelete: SavedClimb) {
    if (!profile || !canManageClimb(profile, climbToDelete.setter)) {
      setActionError("You can only delete climbs you set.");
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
    setActionError("");
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
      setActionError(
        error instanceof Error
          ? error.message
          : "This climb could not be deleted. Please try again.",
      );
      setIsDeleting(false);
    }
  }

  async function handleSetRockoApproval(
    climbToUpdate: SavedClimb,
    rockoApproved: boolean,
  ) {
    if (!profile || !isAdminUser(profile)) {
      setActionError("Only Admin can change Rocko's approval.");
      return;
    }

    setIsApproving(true);
    setActionError("");
    try {
      const updatedClimb = await setRockoApproval(
        climbToUpdate.id,
        profile.id,
        rockoApproved,
      );
      climbCacheRef.current.set(updatedClimb.id, updatedClimb);
      if (activeClimbIdRef.current === updatedClimb.id) {
        setClimb(updatedClimb);
      }
      try {
        const browserClimbs = readSavedClimbs(window.localStorage);
        if (browserClimbs.some((item) => item.id === updatedClimb.id)) {
          persistSavedClimbs(
            window.localStorage,
            browserClimbs.map((item) =>
              item.id === updatedClimb.id
                ? {
                    ...item,
                    ...updatedClimb,
                  }
                : item,
            ),
          );
        }
      } catch {
        // The shared database remains the durable source of approval.
      }
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Rocko's approval could not be changed. Please try again.",
      );
    } finally {
      setIsApproving(false);
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
  const canChangeApproval = isAdminUser(profile);

  return (
    <DetailShell
      backHref={backHref}
      endAction={
        canManage ? (
          <ClimbOptions
            canChangeApproval={canChangeApproval}
            editHref={editHref}
            isApproving={isApproving}
            isDeleting={isDeleting}
            key={climb.id}
            onChangeApproval={(rockoApproved) =>
              handleSetRockoApproval(climb, rockoApproved)
            }
            onDelete={() => handleDeleteClimb(climb)}
            rockoApproved={Boolean(climb.rockoApproved)}
          />
        ) : undefined
      }
    >
      <section aria-labelledby="climb-name">
        <div className="detail-title">
          <div className="detail-title-line">
            <h1 id="climb-name">{climb.name}</h1>
            <strong className="detail-grade">{climb.grade}</strong>
          </div>
          <div className="detail-meta-line">
            <p>Set by {climb.setter}</p>
            {climb.outdated || climb.rockoApproved ? (
              <div className="detail-status-tags">
                {climb.outdated ? (
                  <span className="outdated-tag">Outdated</span>
                ) : null}
                {climb.rockoApproved ? (
                  <span className="rocko-approved-tag">Rocko Approved</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {climb.outdated ? (
          <div className="climb-outdated-notice" role="status">
            <strong>This climb is outdated</strong>
            <span>
              At least one hold used by this climb has been deleted from the
              current wall setup.
            </span>
          </div>
        ) : null}

        {actionError ? (
          <p className="form-error climb-action-error" role="alert">
            {actionError}
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

        <ClimbActivityPanel
          filters={filters}
          reference={{ climbKind: "saved", climbId: climb.id }}
        />
      </section>
    </DetailShell>
  );
}
