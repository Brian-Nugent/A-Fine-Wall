import type { SavedClimb } from "./saved-climbs";

export const CLIMBS_ENDPOINT = "/api/climbs";

const climbsReadyForNavigation = new Map<string, SavedClimb>();

export function primeClimbsForNavigation(climbs: readonly SavedClimb[]) {
  for (const climb of climbs) {
    climbsReadyForNavigation.set(climb.id, climb);
  }
}

export function replacePrimedClimbsForNavigation(
  climbs: readonly SavedClimb[],
) {
  climbsReadyForNavigation.clear();
  primeClimbsForNavigation(climbs);
}

export function evictPrimedClimbForNavigation(id: string) {
  climbsReadyForNavigation.delete(id);
}

export function readPrimedClimbForNavigation(id: string) {
  return climbsReadyForNavigation.get(id);
}

export class ClimbRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ClimbRequestError";
    this.status = status;
  }
}

function isClimbPayload(value: unknown): value is { climb: SavedClimb } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "climb" in value &&
      (value as { climb?: unknown }).climb,
  );
}

export async function loadClimbs(signal?: AbortSignal) {
  const response = await fetch(CLIMBS_ENDPOINT, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Climbs could not be loaded.");

  const payload = (await response.json()) as { climbs?: SavedClimb[] };
  return Array.isArray(payload.climbs) ? payload.climbs : [];
}

export async function loadClimb(id: string, signal?: AbortSignal) {
  const response = await fetch(
    `${CLIMBS_ENDPOINT}/${encodeURIComponent(id)}`,
    { cache: "no-store", signal },
  );
  if (response.status === 404) {
    evictPrimedClimbForNavigation(id);
    return null;
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : "This climb could not be loaded.";
    throw new ClimbRequestError(message, response.status);
  }

  const payload: unknown = await response.json();
  if (!isClimbPayload(payload)) return null;
  primeClimbsForNavigation([payload.climb]);
  return payload.climb;
}

export async function saveClimb(
  climb: SavedClimb,
  expectedWallUpdatedAt: number,
  profileId: string,
) {
  const climbPayload = { ...climb };
  delete climbPayload.profileId;
  const response = await fetch(CLIMBS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      climb: climbPayload,
      expectedWallUpdatedAt,
      profileId,
    }),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : "This climb could not be saved.";
    throw new ClimbRequestError(message, response.status);
  }

  if (!isClimbPayload(payload)) {
    throw new Error("This climb could not be saved.");
  }
  return payload.climb;
}

export async function updateClimb(
  climb: SavedClimb,
  expectedWallUpdatedAt: number,
  profileId: string,
) {
  const response = await fetch(
    `${CLIMBS_ENDPOINT}/${encodeURIComponent(climb.id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: climb.name,
        grade: climb.grade,
        holds: climb.holds,
        expectedWallUpdatedAt,
        profileId,
      }),
    },
  );
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : "This climb could not be updated.";
    throw new ClimbRequestError(message, response.status);
  }

  if (!isClimbPayload(payload)) {
    throw new Error("This climb could not be updated.");
  }
  return payload.climb;
}

export async function deleteClimb(id: string, profileId: string) {
  const response = await fetch(
    `${CLIMBS_ENDPOINT}/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
    },
  );

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : "This climb could not be deleted.";
    throw new ClimbRequestError(message, response.status);
  }

  evictPrimedClimbForNavigation(id);
}
