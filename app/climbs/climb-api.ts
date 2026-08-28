import { isSavedClimb, type SavedClimb } from "./saved-climbs";

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
      isSavedClimb((value as { climb?: unknown }).climb),
  );
}

function parseClimbsPayload(value: unknown): SavedClimb[] | null {
  if (!value || typeof value !== "object" || !("climbs" in value)) {
    return null;
  }

  const climbs = (value as { climbs?: unknown }).climbs;
  return Array.isArray(climbs) && climbs.every(isSavedClimb) ? climbs : null;
}

export async function loadClimbs(signal?: AbortSignal) {
  const response = await fetch(CLIMBS_ENDPOINT, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Climbs could not be loaded.");

  const climbs = parseClimbsPayload(await response.json());
  if (!climbs) throw new Error("Climbs could not be loaded.");
  return climbs;
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
  if (!isClimbPayload(payload)) {
    throw new Error("This climb could not be loaded.");
  }
  return payload.climb;
}

export async function saveClimb(
  climb: SavedClimb,
  expectedWallUpdatedAt: number,
  profileId: string,
  signal?: AbortSignal,
) {
  const climbPayload = {
    id: climb.id,
    name: climb.name,
    grade: climb.setterGrade ?? climb.grade,
    setter: climb.setter,
    createdAt: climb.createdAt,
    holds: climb.holds,
  };
  const response = await fetch(CLIMBS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      climb: climbPayload,
      expectedWallUpdatedAt,
      profileId,
    }),
    signal,
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
        grade: climb.setterGrade ?? climb.grade,
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
}

export async function setRockoApproval(
  id: string,
  profileId: string,
  rockoApproved: boolean,
) {
  const response = await fetch(
    `${CLIMBS_ENDPOINT}/${encodeURIComponent(id)}/rocko-approval`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, rockoApproved }),
    },
  );
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : "Rocko's approval could not be changed.";
    throw new ClimbRequestError(message, response.status);
  }

  if (!isClimbPayload(payload)) {
    throw new Error("Rocko's approval could not be changed.");
  }
  return payload.climb;
}
