"use client";

/* eslint-disable @next/next/no-img-element */

import { useState, type ImgHTMLAttributes } from "react";

export const WALL_PHOTO_ENDPOINT = "/api/wall-photo";
export const DEFAULT_WALL_PHOTO = "/wall-prototype.png";

type WallPhotoProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "alt" | "src"
> & {
  alt: string;
};

export default function WallPhoto({ alt, ...props }: WallPhotoProps) {
  const [src, setSrc] = useState(WALL_PHOTO_ENDPOINT);

  return (
    <img
      {...props}
      alt={alt}
      onError={() => {
        if (src !== DEFAULT_WALL_PHOTO) setSrc(DEFAULT_WALL_PHOTO);
      }}
      src={src}
    />
  );
}
