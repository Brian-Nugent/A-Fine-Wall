import { handleAppDataRequest } from "../../../worker/app-data";
import { isSavedClimbId } from "../climb-activity";
import {
  parseSavedClimbs,
  type SavedClimb,
} from "../saved-climbs";

type ClimbResponse = {
  climb?: unknown;
};

/**
 * Load the selected climb during the document request so hard navigation can
 * replace the list with a complete detail view instead of a loading screen.
 * Client-side loading remains as a fallback for device-local climbs and for a
 * temporarily unavailable database.
 */
export async function loadSavedClimbForPage(
  climbId: string,
): Promise<SavedClimb | undefined> {
  if (!isSavedClimbId(climbId)) return undefined;

  try {
    // Vinext runs Server Components in workerd, where cloudflare:workers is a
    // native module. Keep this import lazy so the plain-Node HTML test harness
    // can still exercise the client fallback without that runtime module.
    const { getD1Database } = await import("../../../db");
    const db = getD1Database();
    const response = await handleAppDataRequest(
      new Request(
        `https://a-fine-wall.invalid/api/climbs/${encodeURIComponent(climbId)}`,
        { headers: { Accept: "application/json" } },
      ),
      db,
    );
    if (!response.ok) return undefined;

    const payload = (await response.json()) as ClimbResponse;
    const [climb] = parseSavedClimbs(
      JSON.stringify(payload.climb === undefined ? [] : [payload.climb]),
    );
    return climb?.id === climbId ? climb : undefined;
  } catch {
    return undefined;
  }
}
