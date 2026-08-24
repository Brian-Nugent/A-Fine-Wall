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
  const [notice, setNotice] = useState("");
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
    setNotice("");

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
    setNotice("");
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

      window.location.assign("/set-climb");
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The wall photo could not be uploaded.",
      );
      setIsSaving(false);
    }
  }

  async function restoreTestPhoto() {
    if (
      !window.confirm(
        "Restore the test photo? Your uploaded wall photo will be deleted.",
      )
    ) {
      return;
    }

    setError("");
    setNotice("");
    setIsSaving(true);
    try {
      const response = await fetch(WALL_PHOTO_ENDPOINT, { method: "DELETE" });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(result?.error || "The test photo could not be restored.");
      }

      clearSelectedPhoto(DEFAULT_WALL_PHOTO);
      setNotice("The test wall photo is active again.");
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "The test photo could not be restored.",
      );
    } finally {
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
        <span>Wall Photo</span>
      </header>

      <section className="photo-intro" aria-labelledby="photo-heading">
        <p className="step-label">Wall setup</p>
        <h1 id="photo-heading">Upload your wall</h1>
        <p>
          Use a clear, straight-on photo. It will become the wall image for
          setting and viewing climbs.
        </p>
        <p className="photo-warning">
          Replacing the photo changes the background for every climb. Existing
          circles may no longer line up.
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
        {notice ? <p className="photo-notice" role="status">{notice}</p> : null}

        <div className="photo-actions">
          <button
            className="primary-button"
            disabled={!selectedFile || isSaving}
            onClick={savePhoto}
            type="button"
          >
            {isSaving ? "Saving..." : "Use This Photo"}
          </button>
          <button
            className="photo-reset-button"
            disabled={isSaving}
            onClick={restoreTestPhoto}
            type="button"
          >
            Restore Test Photo
          </button>
        </div>
      </div>
    </main>
  );
}
