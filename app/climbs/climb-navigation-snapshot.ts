export const CLIMB_NAVIGATION_SNAPSHOT_KEY =
  "a-fine-wall:climb-navigation:v1";

const SNAPSHOT_VERSION = 1;
const MAX_SNAPSHOT_AGE_MS = 6 * 60 * 60 * 1_000;
const MAX_SNAPSHOT_ENTRIES = 1_000;
const MAX_SNAPSHOT_LENGTH = 128_000;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export type NavigationClimbReference = {
  climbKind: "demo" | "saved";
  climbId: string;
};

type StorageReader = {
  getItem(key: string): string | null;
};

type StorageWriter = StorageReader & {
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
};

type SessionStorageHost = {
  readonly sessionStorage: StorageWriter;
};

export type ClimbNavigationSnapshot = {
  version: typeof SNAPSHOT_VERSION;
  profileId: string;
  filters: string;
  entries: readonly NavigationClimbReference[];
  savedAt: number;
};

export type AdjacentClimbReferences = {
  previous: NavigationClimbReference | null;
  next: NavigationClimbReference | null;
};

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isNavigationClimbReference(
  value: unknown,
): value is NavigationClimbReference {
  if (!value || typeof value !== "object") return false;
  const reference = value as Record<string, unknown>;
  return (
    (reference.climbKind === "demo" || reference.climbKind === "saved") &&
    isIdentifier(reference.climbId)
  );
}

function navigationKey(reference: NavigationClimbReference) {
  return `${reference.climbKind}:${reference.climbId}`;
}

function isCanonicalFilterString(value: unknown): value is string {
  return typeof value === "string" && value.length <= 32_000;
}

export function parseClimbNavigationSnapshot(
  raw: string | null,
  expectedProfileId: string,
  expectedFilters: string,
  now = Date.now(),
): ClimbNavigationSnapshot | null {
  if (!raw || raw.length > MAX_SNAPSHOT_LENGTH) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;

    const snapshot = value as Record<string, unknown>;
    if (
      snapshot.version !== SNAPSHOT_VERSION ||
      !isIdentifier(snapshot.profileId) ||
      snapshot.profileId !== expectedProfileId ||
      !isCanonicalFilterString(snapshot.filters) ||
      snapshot.filters !== expectedFilters ||
      typeof snapshot.savedAt !== "number" ||
      !Number.isFinite(snapshot.savedAt) ||
      snapshot.savedAt > now ||
      now - snapshot.savedAt > MAX_SNAPSHOT_AGE_MS ||
      !Array.isArray(snapshot.entries) ||
      snapshot.entries.length === 0 ||
      snapshot.entries.length > MAX_SNAPSHOT_ENTRIES ||
      !snapshot.entries.every(isNavigationClimbReference)
    ) {
      return null;
    }

    const entries = snapshot.entries as NavigationClimbReference[];
    const keys = entries.map(navigationKey);
    if (new Set(keys).size !== keys.length) return null;

    return {
      version: SNAPSHOT_VERSION,
      profileId: snapshot.profileId,
      filters: snapshot.filters,
      entries,
      savedAt: snapshot.savedAt,
    };
  } catch {
    return null;
  }
}

export function readClimbNavigationSnapshot(
  storage: StorageReader,
  profileId: string,
  filters: string,
  now = Date.now(),
) {
  try {
    return parseClimbNavigationSnapshot(
      storage.getItem(CLIMB_NAVIGATION_SNAPSHOT_KEY),
      profileId,
      filters,
      now,
    );
  } catch {
    return null;
  }
}

export function readSessionClimbNavigationSnapshot(
  host: SessionStorageHost,
  profileId: string,
  filters: string,
  now = Date.now(),
) {
  try {
    return readClimbNavigationSnapshot(
      host.sessionStorage,
      profileId,
      filters,
      now,
    );
  } catch {
    return null;
  }
}

export function writeClimbNavigationSnapshot(
  storage: StorageWriter,
  profileId: string,
  filters: string,
  entries: readonly NavigationClimbReference[],
  savedAt = Date.now(),
) {
  if (
    !isIdentifier(profileId) ||
    !isCanonicalFilterString(filters) ||
    entries.length === 0 ||
    entries.length > MAX_SNAPSHOT_ENTRIES ||
    !entries.every(isNavigationClimbReference)
  ) {
    return false;
  }

  const keys = entries.map(navigationKey);
  if (new Set(keys).size !== keys.length) return false;

  try {
    const serialized = JSON.stringify({
      version: SNAPSHOT_VERSION,
      profileId,
      filters,
      entries,
      savedAt,
    } satisfies ClimbNavigationSnapshot);
    if (serialized.length > MAX_SNAPSHOT_LENGTH) return false;

    storage.setItem(
      CLIMB_NAVIGATION_SNAPSHOT_KEY,
      serialized,
    );
    return true;
  } catch {
    return false;
  }
}

export function writeSessionClimbNavigationSnapshot(
  host: SessionStorageHost,
  profileId: string,
  filters: string,
  entries: readonly NavigationClimbReference[],
  savedAt = Date.now(),
) {
  try {
    return writeClimbNavigationSnapshot(
      host.sessionStorage,
      profileId,
      filters,
      entries,
      savedAt,
    );
  } catch {
    return false;
  }
}

export function clearClimbNavigationSnapshot(storage: StorageWriter) {
  try {
    storage.removeItem(CLIMB_NAVIGATION_SNAPSHOT_KEY);
  } catch {
    // A blocked session store has no usable snapshot to clear.
  }
}

export function clearSessionClimbNavigationSnapshot(
  host: SessionStorageHost,
) {
  try {
    clearClimbNavigationSnapshot(host.sessionStorage);
  } catch {
    // Accessing sessionStorage itself can be blocked by the browser.
  }
}

export function adjacentClimbReferences(
  snapshot: ClimbNavigationSnapshot,
  current: NavigationClimbReference,
): AdjacentClimbReferences | null {
  return adjacentClimbReferencesInOrder(snapshot.entries, current);
}

export function adjacentClimbReferencesInOrder(
  entries: readonly NavigationClimbReference[],
  current: NavigationClimbReference,
): AdjacentClimbReferences | null {
  const currentKey = navigationKey(current);
  const index = entries.findIndex(
    (entry) => navigationKey(entry) === currentKey,
  );
  if (index < 0) return null;

  return {
    previous: entries[index - 1] ?? null,
    next: entries[index + 1] ?? null,
  };
}
