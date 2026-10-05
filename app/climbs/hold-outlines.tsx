import type { HoldGeometry, HoldPoint } from "./hold-geometry";

type OutlinedHold = HoldGeometry & {
  id?: string;
  holdId?: string;
  role?: "start" | "hand" | "foot" | "finish" | "available";
};

export const outlinePoints = (points: readonly HoldPoint[]) =>
  points.map(point => `${point.x},${point.y}`).join(" ");

export default function HoldOutlines({ holds, selectedId, setup = false, draft }: {
  holds: readonly OutlinedHold[];
  selectedId?: string | null;
  setup?: boolean;
  draft?: readonly HoldPoint[];
}) {
  return (
    <svg aria-hidden="true" className={`hold-outlines${setup ? " hold-outlines--setup" : ""}`}
      viewBox="0 0 100 100" preserveAspectRatio="none">
      {holds.map((hold, index) => hold.outline && (setup || hold.role !== "available") ? (
        <polygon key={hold.id ?? hold.holdId ?? index}
          className={`hold-outline hold-outline--${hold.role ?? "spot"}${selectedId === hold.id ? " hold-outline--selected" : ""}`}
          points={outlinePoints(hold.outline)} vectorEffect="non-scaling-stroke" />
      ) : null)}
      {draft && draft.length > 0 ? (
        <polyline className="hold-outline hold-outline--draft" points={outlinePoints(draft)} vectorEffect="non-scaling-stroke" />
      ) : null}
    </svg>
  );
}
