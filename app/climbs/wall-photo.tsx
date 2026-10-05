"use client";

/* eslint-disable @next/next/no-img-element */

import { useId, useState, type ImgHTMLAttributes } from "react";
import type { HoldGeometry } from "./hold-geometry";
import { outlinePoints } from "./hold-outlines";

export const WALL_PHOTO_ENDPOINT = "/api/wall-photo";
export const DEFAULT_WALL_PHOTO = "/wall-prototype.png";

type WallPhotoProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "alt" | "src"
> & {
  alt: string;
  highlightedHolds?: readonly HoldGeometry[];
};

export default function WallPhoto({ alt, highlightedHolds = [], ...props }: WallPhotoProps) {
  const [src, setSrc] = useState(WALL_PHOTO_ENDPOINT);
  const clipId = `hold-highlights-${useId()}`;
  const outlinedHolds = highlightedHolds.filter(hold => hold.outline);

  return (
    <>
      <img
        {...props}
        alt={alt}
        onError={() => {
          if (src !== DEFAULT_WALL_PHOTO) setSrc(DEFAULT_WALL_PHOTO);
        }}
        src={src}
      />
      {outlinedHolds.length > 0 ? (
        <svg aria-hidden="true" focusable="false" className="wall-hold-highlights"
          viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              {outlinedHolds.map((hold, index) => (
                <polygon key={index} points={outlinePoints(hold.outline!)} />
              ))}
            </clipPath>
          </defs>
          <image href={src} x="0" y="0" width="100" height="100"
            preserveAspectRatio="none" clipPath={`url(#${clipId})`} />
        </svg>
      ) : null}
    </>
  );
}
