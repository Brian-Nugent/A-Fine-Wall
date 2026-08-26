export const SAVED_CLIMBS_KEY = "a-fine-wall:saved-climbs:v1";
export const CLIMB_GRADES = Array.from(
  { length: 18 },
  (_, index) => `V${index}`,
);

export function isClimbGrade(value: unknown): value is string {
  return typeof value === "string" && /^V(?:[0-9]|1[0-7])$/.test(value);
}

export type SavedHoldRole = "start" | "hand" | "foot" | "finish";

export function nextSavedHoldRole(
  role: SavedHoldRole,
): SavedHoldRole | null {
  if (role === "hand") return "foot";
  if (role === "foot") return "start";
  if (role === "start") return "finish";
  return null;
}

export type SavedHold = {
  holdId?: string;
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
  profileId?: string;
  createdAt: number;
  holds: SavedHold[];
  rockoApproved?: boolean;
};

export type AttributedSavedClimb = SavedClimb & {
  profileId: string;
};

type ClimbProfile = {
  id: string;
  name: string;
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

function isStoredProfileId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)
  );
}

function isStoredSetterName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized !== value || normalized.length > 50) return false;

  return ![...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    );
  });
}

function isSavedHold(value: unknown): value is SavedHold {
  if (!value || typeof value !== "object") return false;

  const hold = value as Record<string, unknown>;
  return (
    (hold.holdId === undefined ||
      (typeof hold.holdId === "string" && hold.holdId.length > 0)) &&
    isFiniteNumber(hold.x) &&
    hold.x >= 0 &&
    hold.x <= 100 &&
    isFiniteNumber(hold.y) &&
    hold.y >= 0 &&
    hold.y <= 100 &&
    isFiniteNumber(hold.size) &&
    hold.size > 0 &&
    hold.size <= 20 &&
    (hold.role === "start" ||
      hold.role === "hand" ||
      hold.role === "foot" ||
      hold.role === "finish")
  );
}

function isSavedClimb(value: unknown): value is SavedClimb {
  if (!value || typeof value !== "object") return false;

  const climb = value as Record<string, unknown>;
  if (!(
    typeof climb.id === "string" &&
    climb.id.length > 0 &&
    typeof climb.name === "string" &&
    climb.name.trim().length > 0 &&
    climb.name.length <= 50 &&
    isClimbGrade(climb.grade) &&
    isStoredSetterName(climb.setter) &&
    (climb.profileId === undefined || isStoredProfileId(climb.profileId)) &&
    (climb.rockoApproved === undefined ||
      typeof climb.rockoApproved === "boolean") &&
    isFiniteNumber(climb.createdAt) &&
    Array.isArray(climb.holds) &&
    climb.holds.length >= 2
  )) {
    return false;
  }

  if (!climb.holds.every(isSavedHold)) return false;

  return (
    climb.holds.some((hold) => hold.role === "start") &&
    climb.holds.some((hold) => hold.role === "finish")
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

export function attributeSavedClimb(
  climb: SavedClimb,
  profile: ClimbProfile,
): AttributedSavedClimb {
  if (climb.profileId) return climb as AttributedSavedClimb;

  return {
    ...climb,
    setter: profile.name,
    profileId: profile.id,
  };
}

export function persistSavedClimbs(
  storage: StorageWriter,
  climbs: readonly SavedClimb[],
) {
  storage.setItem(SAVED_CLIMBS_KEY, JSON.stringify(climbs));
}

export function persistSavedClimb(
  storage: StorageWriter,
  climb: SavedClimb,
): SavedClimb[] {
  const next = addSavedClimb(readSavedClimbs(storage), climb);
  storage.setItem(SAVED_CLIMBS_KEY, JSON.stringify(next));
  return next;
}

export function removeSavedClimb(
  storage: StorageWriter,
  climbId: string,
): SavedClimb[] {
  const next = readSavedClimbs(storage).filter((climb) => climb.id !== climbId);
  storage.setItem(SAVED_CLIMBS_KEY, JSON.stringify(next));
  return next;
}
