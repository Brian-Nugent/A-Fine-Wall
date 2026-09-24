export default function ClimbPhotoNavigation({
  hasPrevious,
  hasNext,
  busy = false,
  onNavigate,
}: {
  hasPrevious: boolean;
  hasNext: boolean;
  busy?: boolean;
  onNavigate(direction: "previous" | "next"): void;
}) {
  return (
    <div
      aria-busy={busy ? "true" : undefined}
      aria-label="Climb navigation"
      className="wall-climb-navigation"
      role="group"
    >
      <button
        aria-label="Previous climb"
        className="wall-climb-arrow wall-climb-arrow--previous"
        disabled={!hasPrevious || busy}
        onClick={() => onNavigate("previous")}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path d="m15 5-7 7 7 7" />
        </svg>
      </button>
      <button
        aria-label="Next climb"
        className="wall-climb-arrow wall-climb-arrow--next"
        disabled={!hasNext || busy}
        onClick={() => onNavigate("next")}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path d="m9 5 7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
