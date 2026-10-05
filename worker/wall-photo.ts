import { ACTIVE_USER_PROFILE_HEADER } from "../app/user-access";
import { isAdminProfileId } from "./app-data";

export const WALL_PHOTO_PATH = "/api/wall-photo";
export const MAX_WALL_PHOTO_BYTES = 20 * 1024 * 1024;

const WALL_PHOTO_KEY = "wall/current";
const MAX_DISPLAY_PHOTO_BYTES = 2 * 1024 * 1024;

// Associate each derivative with its source, so a new wall can never use an
// older wall's display photo, even if uploads overlap or optimization fails.
export function wallDisplayPhotoKey(sourceEtag: string) {
  return `wall/display/${encodeURIComponent(sourceEtag)}`;
}
const supportedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type WallPhotoObject = {
  body?: ReadableStream<Uint8Array>;
  size?: number;
  httpEtag?: string;
  httpMetadata?: { contentType?: string };
  writeHttpMetadata?(headers: Headers): void;
};

export type WallPhotoBucket = {
  get(key: string): Promise<WallPhotoObject | null>;
  head(key: string): Promise<Omit<WallPhotoObject, "body"> | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options: { httpMetadata: { contentType: string } },
  ): Promise<{ httpEtag?: string } | null>;
  delete(key: string): Promise<void>;
};

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function writeRequestIsSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

function imageBytesMatchType(bytes: ArrayBuffer, contentType: string) {
  const header = new Uint8Array(bytes);

  if (contentType === "image/jpeg") {
    return header.length >= 3 &&
      header[0] === 0xff &&
      header[1] === 0xd8 &&
      header[2] === 0xff;
  }

  if (contentType === "image/png") {
    return header.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every(
        (byte, index) => header[index] === byte,
      );
  }

  return header.length >= 12 &&
    String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...header.slice(8, 12)) === "WEBP";
}

export async function handleWallPhotoRequest(
  request: Request,
  bucket: WallPhotoBucket | undefined,
  db: D1Database | undefined,
): Promise<Response> {
  if (!bucket) {
    return jsonError("Wall photo storage is unavailable.", 503);
  }

  try {
    const display = new URL(request.url).searchParams.get("view") === "display";
    if (request.method === "GET" || request.method === "HEAD") {
      let object: WallPhotoObject | null;
      const read = (key: string) => request.method === "HEAD" ? bucket.head(key) : bucket.get(key);
      if (display) {
        const source = await bucket.head(WALL_PHOTO_KEY);
        object = source?.httpEtag ? await read(wallDisplayPhotoKey(source.httpEtag)) : null;
        if (!object && source) object = await read(WALL_PHOTO_KEY);
      } else {
        object = await read(WALL_PHOTO_KEY);
      }
      if (!object) {
        return new Response(null, {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        });
      }

      const headers = new Headers({
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      object.writeHttpMetadata?.(headers);
      if (!headers.has("Content-Type")) {
        headers.set(
          "Content-Type",
          object.httpMetadata?.contentType || "image/jpeg",
        );
      }
      if (object.httpEtag) headers.set("ETag", object.httpEtag);
      if (object.size !== undefined) {
        headers.set("Content-Length", String(object.size));
      }

      if (
        object.httpEtag &&
        request.headers
          .get("If-None-Match")
          ?.split(",")
          .some((etag) => etag.trim() === object.httpEtag)
      ) {
        headers.delete("Content-Length");
        return new Response(null, { status: 304, headers });
      }

      return new Response(object.body ?? null, {
        status: 200,
        headers,
      });
    }

    if (request.method === "POST") {
      if (!writeRequestIsSameOrigin(request)) {
        return jsonError("Cross-origin uploads are not allowed.", 403);
      }
      if (!db) {
        return jsonError("Wall setup authorization is unavailable.", 503);
      }
      if (
        !(await isAdminProfileId(
          db,
          request.headers.get(ACTIVE_USER_PROFILE_HEADER),
        ))
      ) {
        return jsonError("Only Admin can change the wall setup.", 403);
      }

      const contentType = (request.headers.get("Content-Type") || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (!supportedImageTypes.has(contentType)) {
        return jsonError("Choose a JPG, PNG, or WebP image.", 415);
      }

      const declaredSize = Number(request.headers.get("Content-Length") || 0);
      if (declaredSize > MAX_WALL_PHOTO_BYTES) {
        return jsonError("The wall photo must be 20 MB or smaller.", 413);
      }

      const bytes = await request.arrayBuffer();
      if (bytes.byteLength === 0) {
        return jsonError("The selected image is empty.", 400);
      }
      if (bytes.byteLength > MAX_WALL_PHOTO_BYTES) {
        return jsonError("The wall photo must be 20 MB or smaller.", 413);
      }
      if (!imageBytesMatchType(bytes, contentType)) {
        return jsonError("This file is not a valid JPG, PNG, or WebP image.", 415);
      }

      let key = WALL_PHOTO_KEY;
      if (display) {
        if (bytes.byteLength > MAX_DISPLAY_PHOTO_BYTES) {
          return jsonError("The display photo must be 2 MB or smaller.", 413);
        }
        const source = await bucket.head(WALL_PHOTO_KEY);
        if (!source?.httpEtag || request.headers.get("If-Match") !== source.httpEtag) {
          return jsonError("The wall photo changed. Please upload it again.", 412);
        }
        key = wallDisplayPhotoKey(source.httpEtag);
      }
      const uploaded = await bucket.put(key, bytes, {
        httpMetadata: { contentType },
      });

      return Response.json(
        { ok: true },
        { headers: {
          "Cache-Control": "no-store",
          ...(uploaded?.httpEtag ? { ETag: uploaded.httpEtag } : {}),
        } },
      );
    }

    if (request.method === "DELETE") {
      if (display) {
        return new Response(null, { status: 405, headers: { Allow: "GET, HEAD, POST" } });
      }
      if (!writeRequestIsSameOrigin(request)) {
        return jsonError("Cross-origin changes are not allowed.", 403);
      }
      if (!db) {
        return jsonError("Wall setup authorization is unavailable.", 503);
      }
      if (
        !(await isAdminProfileId(
          db,
          request.headers.get(ACTIVE_USER_PROFILE_HEADER),
        ))
      ) {
        return jsonError("Only Admin can change the wall setup.", 403);
      }

      await bucket.delete(WALL_PHOTO_KEY);
      return new Response(null, { status: 204 });
    }

    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, HEAD, POST, DELETE" },
    });
  } catch (error) {
    console.error("Unexpected wall-photo request error.", {
      method: request.method,
      pathname: new URL(request.url).pathname,
      error,
    });
    return jsonError("The wall photo could not be updated. Please try again.", 500);
  }
}
