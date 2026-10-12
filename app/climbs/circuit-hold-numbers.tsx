"use client";

import { useEffect, useRef } from "react";
import { HOLD_OUTLINE_GAP_PX, holdOutlineStrokeWidth } from "./hold-outlines";
import type { SavedHold } from "./saved-climbs";
import { circuitNumberSizeScale } from "./circuit-number-zoom";

export default function CircuitHoldNumbers({ holds, enabled }: {
  holds: readonly SavedHold[];
  enabled: boolean;
}) {
  const numbersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    const resizeNumbers = () => {
      numbersRef.current?.style.setProperty(
        "--circuit-number-scale", String(circuitNumberSizeScale(viewport.scale)),
      );
    };
    resizeNumbers();
    viewport.addEventListener("resize", resizeNumbers);
    return () => viewport.removeEventListener("resize", resizeNumbers);
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div className="circuit-hold-numbers" ref={numbersRef} role="group" aria-label="Circuit handhold sequence">
      {holds.filter(hold => hold.role === "hand" && hold.circuitOrder !== undefined).map((hold) => {
        const anchor = hold.outline?.reduce((best, point) =>
          point.x - point.y > best.x - best.y ? point : best,
        );
        // Circle diameters use the photo width on both axes. Container-width
        // units keep the badge tangent at 45 degrees on any photo aspect ratio.
        const offset = anchor
          ? `${(HOLD_OUTLINE_GAP_PX + holdOutlineStrokeWidth(hold.size)) * Math.SQRT1_2}px`
          : `${hold.size * Math.SQRT1_2 / 2}cqw`;
        return (
          <span
            className="circuit-hold-number"
            key={hold.circuitOrder}
            role="img"
            aria-label={`Circuit handhold ${hold.circuitOrder}`}
            style={{
              left: `calc(${anchor?.x ?? hold.x}% + ${offset} - var(--circuit-corner-inset))`,
              top: `calc(${anchor?.y ?? hold.y}% - ${offset} + var(--circuit-corner-inset))`,
            }}
          >
            {hold.circuitOrder}
          </span>
        );
      })}
    </div>
  );
}
