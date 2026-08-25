export const WALL_HOLDS_ENDPOINT = "/api/wall-holds";

export const DEFAULT_WALL_HOLD_SIZE = 7;
export const MIN_WALL_HOLD_SIZE = 1;
export const MAX_WALL_HOLD_SIZE = 20;

const wallHoldIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export type WallHold = {
  id: string;
  x: number;
  y: number;
  size: number;
};

export type WallHoldMap = {
  holds: WallHold[];
  updatedAt: number;
};

export class WallHoldMapRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WallHoldMapRequestError";
    this.status = status;
  }
}

type SavedHoldCoordinates = {
  holdId?: string | null;
  x: number;
  y: number;
  size: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWallHold(value: unknown): value is WallHold {
  if (!value || typeof value !== "object") return false;

  const hold = value as Record<string, unknown>;
  return (
    typeof hold.id === "string" &&
    wallHoldIdPattern.test(hold.id) &&
    isFiniteNumber(hold.x) &&
    hold.x >= 0 &&
    hold.x <= 100 &&
    isFiniteNumber(hold.y) &&
    hold.y >= 0 &&
    hold.y <= 100 &&
    isFiniteNumber(hold.size) &&
    hold.size > 0 &&
    hold.size <= MAX_WALL_HOLD_SIZE
  );
}

function roundPosition(value: number) {
  return Number(value.toFixed(2));
}

export function wallHoldSizeFromHorizontalDrag(
  startSize: number,
  horizontalPixels: number,
  wallWidth: number,
) {
  const safeStart = Math.min(
    MAX_WALL_HOLD_SIZE,
    Math.max(MIN_WALL_HOLD_SIZE, startSize),
  );
  if (
    !Number.isFinite(horizontalPixels) ||
    !Number.isFinite(wallWidth) ||
    wallWidth <= 0
  ) {
    return roundPosition(safeStart);
  }

  const sizeChange = (horizontalPixels / wallWidth) * 200;
  return roundPosition(
    Math.min(
      MAX_WALL_HOLD_SIZE,
      Math.max(MIN_WALL_HOLD_SIZE, safeStart + sizeChange),
    ),
  );
}

export function wallSetupReturnPath(currentUrl: string) {
  const fallback = "/climbs";

  try {
    const current = new URL(currentUrl);
    const candidate = current.searchParams.get("returnTo");
    if (!candidate) return fallback;

    const destination = new URL(candidate, current.origin);
    if (
      destination.origin === current.origin &&
      destination.pathname === "/climbs/filter/holds"
    ) {
      return `${destination.pathname}${destination.search}`;
    }
  } catch {
    // Ignore malformed or external return locations.
  }

  return fallback;
}

function normalizeWallHold(hold: WallHold): WallHold {
  return {
    id: hold.id,
    x: roundPosition(hold.x),
    y: roundPosition(hold.y),
    size: roundPosition(hold.size),
  };
}

function parseWallHolds(value: unknown): WallHold[] {
  const candidate = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? (value as { holds?: unknown }).holds
      : undefined;

  if (!Array.isArray(candidate) || !candidate.every(isWallHold)) {
    throw new Error("The saved hold map could not be read.");
  }

  const ids = new Set(candidate.map((hold) => hold.id));
  if (ids.size !== candidate.length) {
    throw new Error("The saved hold map contains duplicate hold spots.");
  }

  return candidate.map(normalizeWallHold);
}

function parseWallHoldMap(value: unknown): WallHoldMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The saved hold map could not be read.");
  }

  const updatedAt = (value as { updatedAt?: unknown }).updatedAt;
  if (
    typeof updatedAt !== "number" ||
    !Number.isSafeInteger(updatedAt) ||
    updatedAt < 0
  ) {
    throw new Error("The saved hold map revision could not be read.");
  }

  return { holds: parseWallHolds(value), updatedAt };
}

async function readError(response: Response, fallback: string) {
  const result = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;

  return typeof result?.error === "string" && result.error.length > 0
    ? result.error
    : fallback;
}

export function createWallHold(): WallHold {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  return {
    id,
    x: 50,
    y: 50,
    size: DEFAULT_WALL_HOLD_SIZE,
  };
}

export async function loadWallHoldMap(signal?: AbortSignal): Promise<WallHoldMap> {
  const response = await fetch(WALL_HOLDS_ENDPOINT, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error(
      await readError(response, "The hold spots could not be loaded."),
    );
  }

  return parseWallHoldMap(await response.json());
}

export async function loadWallHolds(signal?: AbortSignal): Promise<WallHold[]> {
  return (await loadWallHoldMap(signal)).holds;
}

export async function saveWallHolds(
  holds: readonly WallHold[],
  expectedUpdatedAt: number,
): Promise<WallHoldMap> {
  const normalized = parseWallHolds([...holds]);
  const response = await fetch(WALL_HOLDS_ENDPOINT, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ holds: normalized, expectedUpdatedAt }),
  });

  if (!response.ok) {
    throw new WallHoldMapRequestError(
      await readError(response, "The hold spots could not be saved."),
      response.status,
    );
  }

  return parseWallHoldMap(await response.json());
}

export function resolveSavedHold<T extends SavedHoldCoordinates>(
  hold: T,
  wallHolds: readonly WallHold[],
): T {
  if (!hold.holdId) return hold;

  const currentSpot = wallHolds.find((spot) => spot.id === hold.holdId);
  if (!currentSpot) return hold;

  return {
    ...hold,
    x: currentSpot.x,
    y: currentSpot.y,
    size: currentSpot.size,
  };
}
