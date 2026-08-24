export const SAVED_CLIMBS_KEY = "a-fine-wall:saved-climbs:v1";

export type SavedHoldRole = "start" | "hand" | "finish";

export type SavedHold = {
  x: number;
  y: number;
  size: number;
  role: SavedHoldRole;
};

export type SavedClimb = {
  id: string;
  name: string;
  grade: string;
  setter: string;
  createdAt: number;
  holds: SavedHold[];
};

type StorageReader = {
  getItem(key: string): string | null;
};

type StorageWriter = StorageReader & {
  setItem(key: string, value: string): void;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSavedHold(value: unknown): value is SavedHold {
  if (!value || typeof value !== "object") return false;

  const hold = value as Record<string, unknown>;
  return (
    isFiniteNumber(hold.x) &&
    hold.x >= 0 &&
    hold.x <= 100 &&
    isFiniteNumber(hold.y) &&
    hold.y >= 0 &&
    hold.y <= 100 &&
    isFiniteNumber(hold.size) &&
    hold.size > 0 &&
    hold.size <= 20 &&
    (hold.role === "start" || hold.role === "hand" || hold.role === "finish")
  );
}

function isSavedClimb(value: unknown): value is SavedClimb {
  if (!value || typeof value !== "object") return false;

  const climb = value as Record<string, unknown>;
  return (
    typeof climb.id === "string" &&
    climb.id.length > 0 &&
    typeof climb.name === "string" &&
    climb.name.trim().length > 0 &&
    climb.name.length <= 50 &&
    typeof climb.grade === "string" &&
    /^V(?:[0-9]|10)$/.test(climb.grade) &&
    climb.setter === "You" &&
    isFiniteNumber(climb.createdAt) &&
    Array.isArray(climb.holds) &&
    climb.holds.length >= 2 &&
    climb.holds.every(isSavedHold)
  );
}

export function parseSavedClimbs(raw: string | null): SavedClimb[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isSavedClimb).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function readSavedClimbs(storage: StorageReader): SavedClimb[] {
  return parseSavedClimbs(storage.getItem(SAVED_CLIMBS_KEY));
}

export function addSavedClimb(
  existing: SavedClimb[],
  climb: SavedClimb,
): SavedClimb[] {
  return [climb, ...existing.filter((item) => item.id !== climb.id)];
}

export function persistSavedClimb(
  storage: StorageWriter,
  climb: SavedClimb,
): SavedClimb[] {
  const next = addSavedClimb(readSavedClimbs(storage), climb);
  storage.setItem(SAVED_CLIMBS_KEY, JSON.stringify(next));
  return next;
}
