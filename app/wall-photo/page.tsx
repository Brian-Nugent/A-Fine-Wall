"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  DEFAULT_WALL_PHOTO,
  WALL_PHOTO_ENDPOINT,
} from "../climbs/wall-photo";

const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function formatMegabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function WallPhotoPage() {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const previewObjectUrl = useRef<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState(WALL_PHOTO_ENDPOINT);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(
    () => () => {
      if (previewObjectUrl.current) {
        URL.revokeObjectURL(previewObjectUrl.current);
      }
    },
    [],
  );

  function clearSelectedPhoto(nextPreview = WALL_PHOTO_ENDPOINT) {
    if (previewObjectUrl.current) {
      URL.revokeObjectURL(previewObjectUrl.current);
      previewObjectUrl.current = null;
    }
    setSelectedFile(null);
    setPreviewSrc(nextPreview);
    if (fileInput.current) fileInput.current.value = "";
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError("");

    if (!file) return;
    if (!supportedTypes.has(file.type)) {
      setError("Choose a JPG, PNG, or WebP image.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError("The wall photo must be 20 MB or smaller.");
      event.target.value = "";
      return;
    }

    if (previewObjectUrl.current) {
      URL.revokeObjectURL(previewObjectUrl.current);
    }
    const objectUrl = URL.createObjectURL(file);
    previewObjectUrl.current = objectUrl;
    setSelectedFile(file);
    setPreviewSrc(objectUrl);
  }

  async function savePhoto() {
    if (!selectedFile) return;

    setError("");
    setIsSaving(true);
    try {
      const response = await fetch(WALL_PHOTO_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": selectedFile.type },
        body: selectedFile,
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(result?.error || "The wall photo could not be uploaded.");
      }

      window.location.assign("/wall-holds?from=photo");
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The wall photo could not be uploaded.",
      );
      setIsSaving(false);
    }
  }

  return (
    <main className="app-page photo-page">
      <header className="detail-header">
        <a className="back-link" href="/climbs">
          <span aria-hidden="true">&larr;</span>
          Climbs
        </a>
        <span>Wall Setup</span>
      </header>

      <section className="photo-intro" aria-labelledby="photo-heading">
        <p className="step-label">Step 1 of 2</p>
        <h1 id="photo-heading">Upload your wall</h1>
        <p>
          Use a clear, straight-on photo. It will become the wall image for
          setting and viewing climbs, then you will mark each hold.
        </p>
        <p className="photo-warning">
          Existing hold spots and climbs will carry over. After uploading, you
          can add new spots or realign old ones on the new photo.
        </p>
      </section>

      <figure className="wall-photo-preview">
        <img
          alt="Current climbing wall preview"
          height="1448"
          onError={(event) => {
            if (selectedFile) {
              setError("This image could not be previewed. Choose another photo.");
              clearSelectedPhoto(DEFAULT_WALL_PHOTO);
            } else if (!event.currentTarget.src.endsWith(DEFAULT_WALL_PHOTO)) {
              setPreviewSrc(DEFAULT_WALL_PHOTO);
            }
          }}
          src={previewSrc}
          width="1086"
        />
      </figure>

      <div className="photo-controls">
        <label htmlFor="wall-photo-input">Choose a photo</label>
        <input
          accept="image/jpeg,image/png,image/webp"
          className="photo-file-input"
          id="wall-photo-input"
          onChange={choosePhoto}
          ref={fileInput}
          type="file"
        />
        <p className="photo-meta">JPG, PNG, or WebP &middot; up to 20 MB</p>

        {selectedFile ? (
          <p className="photo-meta">
            {selectedFile.name} &middot; {formatMegabytes(selectedFile.size)}
          </p>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <div className="photo-actions">
          <button
            className="primary-button"
            disabled={!selectedFile || isSaving}
            onClick={savePhoto}
            type="button"
          >
            {isSaving ? "Uploading..." : "Continue to Mark Holds"}
          </button>
          <a className="secondary-button photo-spots-link" href="/wall-holds">
            Edit Hold Spots
          </a>
        </div>
      </div>
    </main>
  );
}
