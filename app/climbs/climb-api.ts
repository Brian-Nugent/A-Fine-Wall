import type { SavedClimb } from "./saved-climbs";

export const CLIMBS_ENDPOINT = "/api/climbs";

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
  if (response.status === 404) return null;
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : "This climb could not be loaded.";
    throw new ClimbRequestError(message, response.status);
  }

  const payload: unknown = await response.json();
  return isClimbPayload(payload) ? payload.climb : null;
}

export async function saveClimb(
  climb: SavedClimb,
  expectedWallUpdatedAt: number,
) {
  const response = await fetch(CLIMBS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ climb, expectedWallUpdatedAt }),
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

export async function deleteClimb(id: string) {
  const response = await fetch(
    `${CLIMBS_ENDPOINT}/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : "This climb could not be deleted.";
    throw new ClimbRequestError(message, response.status);
  }
}
