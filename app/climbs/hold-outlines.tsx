import { useId, type CSSProperties } from "react";
import { outlineBounds, type HoldGeometry, type HoldPoint } from "./hold-geometry";

type OutlinedHold = HoldGeometry & {
  id?: string;
  holdId?: string;
  role?: "start" | "hand" | "foot" | "finish" | "available";
};

export const outlinePoints = (points: readonly HoldPoint[]) =>
  points.map(point => `${point.x},${point.y}`).join(" ");

const HOLD_OUTLINE_GAP_PX = 1.5;

export function holdOutlineStrokeWidth(size: number) {
  // Hold widths are percentages of the photo: small footholds stay thin,
  // with a linear increase up to full thickness for holds 8% wide or larger.
  const fraction = Math.max(0, Math.min(1, (size - 2) / (8 - 2)));
  return 0.75 + fraction * 0.75;
}

function outlineStyle(size: number): CSSProperties {
  const width = holdOutlineStrokeWidth(size);
  return {
    "--hold-outline-width": `${width}px`,
    "--hold-outline-buffered-width": `${2 * (HOLD_OUTLINE_GAP_PX + width)}px`,
  } as CSSProperties;
}

export default function HoldOutlines({ holds, selectedId, setup = false, draft }: {
  holds: readonly OutlinedHold[];
  selectedId?: string | null;
  setup?: boolean;
  draft?: readonly HoldPoint[];
}) {
  const maskPrefix = `hold-outline-gap-${useId()}`;
  return (
    <svg aria-hidden="true" className={`hold-outlines${setup ? " hold-outlines--setup" : ""}`}
      viewBox="0 0 100 100" preserveAspectRatio="none">
      {holds.map((hold, index) => {
        if (!hold.outline || (!setup && hold.role === "available")) return null;
        const points = outlinePoints(hold.outline);
        const maskId = `${maskPrefix}-${index}`;
        return (
          <g key={hold.id ?? hold.holdId ?? index}>
            {!setup ? (
              <defs>
                <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"
                  style={{ maskType: "luminance" }}>
                  <rect width="100" height="100" fill="white" />
                  <polygon points={points} fill="black" stroke="black"
                    strokeWidth={HOLD_OUTLINE_GAP_PX * 2} strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke" />
                </mask>
              </defs>
            ) : null}
            {/* Mask the hold and its buffer out of a wider stroke, leaving only
                the original line thickness outside it. Pixel widths keep the
                gap even on portrait and landscape photos at any screen size. */}
            <polygon
              className={`hold-outline hold-outline--${hold.role ?? "spot"}${!setup ? " hold-outline--buffered" : ""}${selectedId === hold.id ? " hold-outline--selected" : ""}`}
              style={outlineStyle(hold.size)}
              mask={setup ? undefined : `url(#${maskId})`}
              points={points} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
      {draft && draft.length > 0 ? (
        <polyline className="hold-outline hold-outline--draft" points={outlinePoints(draft)}
          style={outlineStyle(outlineBounds(draft).right - outlineBounds(draft).left)}
          vectorEffect="non-scaling-stroke" />
      ) : null}
    </svg>
  );
}
