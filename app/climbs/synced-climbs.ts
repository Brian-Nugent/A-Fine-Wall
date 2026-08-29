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
import {
  climbUsesMissingWallHold,
  loadWallHoldMap,
  type WallHold,
} from "./wall-holds";

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
  let appClimbs: SavedClimb[];

  try {
    appClimbs = await loadClimbs(signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    return { climbs: browserClimbs, sharedUnavailable: true };
  }

  const appIds = new Set(appClimbs.map((climb) => climb.id));
  const browserOnlyClimbs = browserClimbs.filter(
    (climb) => !appIds.has(climb.id),
  );
  if (browserOnlyClimbs.length === 0) {
    return { climbs: appClimbs, sharedUnavailable: false };
  }

  const deletedBrowserIds = new Set<string>();
  const migratedBrowserClimbs = new Map<string, SavedClimb>();
  let currentWallHolds: WallHold[] | null = null;
  try {
    const wallMap = await loadWallHoldMap(signal);
    currentWallHolds = wallMap.holds;
    const syncResults = await Promise.allSettled(
      browserOnlyClimbs.map((climb) =>
        saveClimbToApp(
          climb,
          wallMap.updatedAt,
          climb.profileId,
          signal,
        ),
      ),
    );
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    for (const [index, climb] of browserOnlyClimbs.entries()) {
      const result = syncResults[index];
      if (result.status === "fulfilled") {
        migratedBrowserClimbs.set(climb.id, result.value);
      } else if (
        result.reason instanceof ClimbRequestError &&
        result.reason.status === 410
      ) {
        deletedBrowserIds.add(climb.id);
      }
    }
    for (const climbId of deletedBrowserIds) {
      try {
        removeSavedClimb(storage, climbId);
      } catch {
        // The durable tombstone still prevents this copy from returning.
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    // Shared climbs remain usable when legacy browser migration is unavailable.
  }

  return {
    climbs: [
      ...appClimbs,
      ...browserOnlyClimbs
        .filter((climb) => !deletedBrowserIds.has(climb.id))
        .map(
          (climb) =>
            migratedBrowserClimbs.get(climb.id) ?? {
              ...climb,
              ...(currentWallHolds
                ? {
                    outdated: climbUsesMissingWallHold(
                      climb,
                      currentWallHolds,
                    ),
                  }
                : {}),
            },
        ),
    ],
    sharedUnavailable: false,
  };
}
