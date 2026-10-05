"use client";

/* eslint-disable @next/next/no-img-element */

import { useId, useState, type ImgHTMLAttributes } from "react";
import type { HoldGeometry } from "./hold-geometry";
import { outlinePoints } from "./hold-outlines";

export const WALL_PHOTO_ENDPOINT = "/api/wall-photo";
export const WALL_DISPLAY_PHOTO_ENDPOINT = `${WALL_PHOTO_ENDPOINT}?view=display`;
export const DEFAULT_WALL_PHOTO = "/wall-prototype.png";

type WallPhotoProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "alt" | "src"
> & {
  alt: string;
  highlightedHolds?: readonly HoldGeometry[];
  original?: boolean;
};

export default function WallPhoto({ alt, highlightedHolds = [], original = false, className = "", ...props }: WallPhotoProps) {
  const [src, setSrc] = useState(original ? WALL_PHOTO_ENDPOINT : WALL_DISPLAY_PHOTO_ENDPOINT);
  const maskId = `hold-highlights-${useId()}`;
  const outlinedHolds = highlightedHolds.filter(hold => hold.outline);

  return (
    <>
      <img
        {...props}
        alt={alt}
        className={`${className}${outlinedHolds.length ? " wall-photo--masked" : ""}`.trim()}
        onError={() => {
          if (src !== DEFAULT_WALL_PHOTO) setSrc(DEFAULT_WALL_PHOTO);
        }}
        src={src}
      />
      {outlinedHolds.length > 0 ? (
        <svg aria-hidden="true" focusable="false" className="wall-hold-highlights"
          viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"
              style={{ maskType: "luminance" }}>
              <rect width="100" height="100" fill="white" />
              {outlinedHolds.map((hold, index) => (
                <polygon key={index} points={outlinePoints(hold.outline!)} fill="black" />
              ))}
            </mask>
          </defs>
          <rect width="100" height="100" fill="black" fillOpacity="0.4" mask={`url(#${maskId})`} />
        </svg>
      ) : null}
    </>
  );
}
