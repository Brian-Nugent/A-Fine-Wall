import type { UserProfile } from "../user-profile";
import {
  ClimbRequestError,
  loadClimbs,
  saveClimb as saveClimbToApp,
} from "./climb-api";
import {
  attributeSavedClimb,
  persistSavedClimbs,
  readSavedClimbs,
  removeSavedClimb,
  type AttributedSavedClimb,
  type SavedClimb,
} from "./saved-climbs";
import { loadWallHoldMap } from "./wall-holds";

export type SyncedClimbs = {
  climbs: SavedClimb[];
  sharedUnavailable: boolean;
};

function readBrowserClimbs(
  profile: UserProfile,
  storage: Storage,
): AttributedSavedClimb[] {
  try {
    const storedClimbs = readSavedClimbs(storage);
    const attributedClimbs = storedClimbs.map((climb) =>
      attributeSavedClimb(climb, profile),
    );
    if (
      attributedClimbs.some(
        (climb, index) => climb !== storedClimbs[index],
      )
    ) {
      persistSavedClimbs(storage, attributedClimbs);
    }
    return attributedClimbs;
  } catch {
    return [];
  }
}

export async function loadSyncedClimbs(
  profile: UserProfile,
  storage: Storage,
  signal?: AbortSignal,
): Promise<SyncedClimbs> {
  const browserClimbs = readBrowserClimbs(profile, storage);

  try {
    const wallMap = await loadWallHoldMap(signal);
    const syncResults = await Promise.allSettled(
      browserClimbs.map((climb) =>
        saveClimbToApp(climb, wallMap.updatedAt, climb.profileId),
      ),
    );
    const deletedBrowserIds = new Set(
      browserClimbs.flatMap((climb, index) => {
        const result = syncResults[index];
        return result.status === "rejected" &&
          result.reason instanceof ClimbRequestError &&
          result.reason.status === 410
          ? [climb.id]
          : [];
      }),
    );
    for (const climbId of deletedBrowserIds) {
      try {
        removeSavedClimb(storage, climbId);
      } catch {
        // The durable tombstone still prevents this copy from returning.
      }
    }

    const appClimbs = await loadClimbs(signal);
    const appIds = new Set(appClimbs.map((climb) => climb.id));
    return {
      climbs: [
        ...appClimbs,
        ...browserClimbs.filter(
          (climb) =>
            !appIds.has(climb.id) && !deletedBrowserIds.has(climb.id),
        ),
      ],
      sharedUnavailable: false,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { climbs: browserClimbs, sharedUnavailable: true };
  }
}
