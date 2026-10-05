import type { CSSProperties } from "react";
import { outlineBounds, type HoldGeometry, type HoldPoint } from "./hold-geometry";

type OutlinedHold = HoldGeometry & {
  id?: string;
  holdId?: string;
  role?: "start" | "hand" | "foot" | "finish" | "available";
};

export const outlinePoints = (points: readonly HoldPoint[]) =>
  points.map(point => `${point.x},${point.y}`).join(" ");

export function holdOutlineStrokeWidth(size: number) {
  // Hold widths are percentages of the photo: small footholds stay thin,
  // with a linear increase up to full thickness for holds 8% wide or larger.
  const fraction = Math.max(0, Math.min(1, (size - 2) / (8 - 2)));
  return 0.75 + fraction * 0.75;
}

function outlineStyle(size: number): CSSProperties {
  return { "--hold-outline-width": `${holdOutlineStrokeWidth(size)}px` } as CSSProperties;
}

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
          style={outlineStyle(hold.size)}
          points={outlinePoints(hold.outline)} vectorEffect="non-scaling-stroke" />
      ) : null)}
      {draft && draft.length > 0 ? (
        <polyline className="hold-outline hold-outline--draft" points={outlinePoints(draft)}
          style={outlineStyle(outlineBounds(draft).right - outlineBounds(draft).left)}
          vectorEffect="non-scaling-stroke" />
      ) : null}
    </svg>
  );
}
