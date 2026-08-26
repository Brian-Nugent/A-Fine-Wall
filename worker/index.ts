/** Cloudflare Worker entry point for the vinext-starter template. */
import handler from "vinext/server/app-router-entry";
import { handleAppDataRequest, isAppDataPath } from "./app-data";
import {
  handleWallPhotoRequest,
  WALL_PHOTO_PATH,
  type WallPhotoBucket,
} from "./wall-photo";

const LEGACY_SITE_HOST = "a-fine-wall.bnugent1021.chatgpt.site";
const CLOUDFLARE_SITE_ORIGIN = "https://a-fine-wall.bnugent1021.workers.dev";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  WALL_PHOTOS?: WallPhotoBucket;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname.toLowerCase() === LEGACY_SITE_HOST) {
      return Response.redirect(
        new URL(`${url.pathname}${url.search}`, CLOUDFLARE_SITE_ORIGIN),
        308,
      );
    }

    if (isAppDataPath(url.pathname)) {
      return handleAppDataRequest(request, env.DB);
    }

    if (url.pathname === WALL_PHOTO_PATH) {
      const response = await handleWallPhotoRequest(
        request,
        env.WALL_PHOTOS,
        env.DB,
      );
      if (
        response.status !== 404 ||
        (request.method !== "GET" && request.method !== "HEAD")
      ) {
        return response;
      }

      return new Response(null, {
        status: 307,
        headers: {
          "Cache-Control": "no-store",
          Location: "/wall-prototype.png",
        },
      });
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
