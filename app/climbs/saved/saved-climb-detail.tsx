"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ClimbRequestError,
  deleteClimb,
  loadClimb,
} from "../climb-api";
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
  buildFilteredHref,
  type ClimbFilters,
} from "../climb-filters";

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
  return (
    <main className="app-page detail-page">
      <header className="detail-header">
        <a className="back-link" href={backHref}>
          <span aria-hidden="true">&larr;</span>
          Climbs
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
}: {
  backHref: string;
  climbId: string;
  filters: ClimbFilters;
}) {
  const [climb, setClimb] = useState<SavedClimb | null | undefined>(undefined);
  const [wallHolds, setWallHolds] = useState<WallHold[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let browserClimb: SavedClimb | null = null;

    try {
      browserClimb = readSavedClimbs(window.localStorage).find(
        (item) => item.id === climbId,
      ) ?? null;
    } catch {
      browserClimb = null;
    }

    loadClimb(climbId, controller.signal)
      .then((savedClimb) => setClimb(savedClimb ?? browserClimb))
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
        setClimb(browserClimb);
      });

    loadWallHolds(controller.signal)
      .then(setWallHolds)
      .catch(() => {
        // Coordinate snapshots keep the climb view usable if spots are offline.
      });

    return () => controller.abort();
  }, [climbId]);

  async function handleDeleteClimb(climbToDelete: SavedClimb) {
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
      await deleteClimb(climbToDelete.id);
      try {
        removeSavedClimb(window.localStorage, climbToDelete.id);
      } catch {
        // The durable deletion prevents a stale browser copy from returning.
      }
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
      <DetailShell backHref={backHref} status="Loading">
        <div className="empty-state">
          <p>Loading climb&hellip;</p>
        </div>
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
  const finishCount = resolvedHolds.filter((hold) => hold.role === "finish").length;
  const editHref = buildFilteredHref("/set-climb", filters, {
    edit: climb.id,
  });

  return (
    <DetailShell
      backHref={backHref}
      endAction={
        <ClimbOptions
          editHref={editHref}
          isDeleting={isDeleting}
          onDelete={() => handleDeleteClimb(climb)}
        />
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

        <figure className="wall-map wall-map--route">
          <WallPhoto
            className="wall-photo"
            alt="Climbing wall with the route holds marked"
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
            climbing {handCount === 1 ? "hold" : "holds"}, and {finishCount}{" "}
            red-circled finish {finishCount === 1 ? "hold" : "holds"}.
          </figcaption>
        </figure>

        <div className="hold-legend" aria-label="Hold marker legend">
          <span><i className="legend-dot legend-dot--start" />Start</span>
          <span><i className="legend-dot legend-dot--hand" />Climb</span>
          <span><i className="legend-dot legend-dot--finish" />Finish</span>
        </div>

        <ClimbActivityPanel
          filters={filters}
          reference={{ climbKind: "saved", climbId: climb.id }}
        />
      </section>
    </DetailShell>
  );
}
