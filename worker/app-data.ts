import {
  isClimbKind,
  isDemoClimbId,
  isSavedClimbId,
  type ClimbKind,
} from "../app/climbs/climb-activity";
import {
  isAdminUserName,
  isSameUserName,
} from "../app/user-access";

const WALL_HOLDS_PATH = "/api/wall-holds";
const CLIMBS_PATH = "/api/climbs";
const PROFILES_PATH = "/api/profiles";
const SENDS_PATH = "/api/sends";
const WALL_CONFIGURATION_ID = 1;
const MAX_PROFILE_BODY_BYTES = 4 * 1024;
const MAX_SEND_BODY_BYTES = 4 * 1024;
const MAX_WALL_HOLDS_BODY_BYTES = 256 * 1024;
const MAX_CLIMB_BODY_BYTES = 128 * 1024;
const MAX_WALL_HOLDS = 1_000;
const MAX_CLIMB_HOLDS = 200;
const MAX_LEGACY_HOLD_MATCH_DISTANCE = 3;
const MIN_LEGACY_HOLD_MATCH_GAP = 0.75;

const holdRoles = new Set(["start", "hand", "foot", "finish"]);
const recordIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const gradePattern = /^V(?:[0-9]|1[0-7])$/;

type WallHold = {
  id: string;
  x: number;
  y: number;
  size: number;
};

type ClimbHold = {
  holdId?: string;
  x: number;
  y: number;
  size: number;
  role: "start" | "hand" | "foot" | "finish";
};

type Climb = {
  id: string;
  name: string;
  grade: string;
  setter: string;
  createdAt: number;
  holds: ClimbHold[];
};

type Profile = {
  id: string;
  name: string;
  createdAt: number;
};

type ProfileRow = {
  id: string;
  name: string;
  created_at: number;
};

type WallConfigurationRow = {
  holds_json: string;
  updated_at: number;
};

type ClimbRow = {
  id: string;
  name: string;
  grade: string;
  setter: string;
  created_at: number;
  holds_json: string;
};

type SendAggregateRow = {
  climb_kind: string;
  climb_id: string;
  average_rating: number;
  rating_count: number;
  user_rating?: number | null;
};

type ClimbSendRow = {
  climb_kind: string;
  climb_id: string;
  profile_id: string;
  rating: number;
  sent_at: number;
  updated_at: number;
};

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function jsonError(message: string, status: number) {
  return json({ error: message }, status);
}

function methodNotAllowed(methods: string[]) {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: methods.join(", "),
      "Cache-Control": "no-store",
    },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: string[]) {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCoordinate(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 100;
}

function isSize(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0 && value <= 20;
}

function normalizeDisplayName(value: unknown) {
  if (typeof value !== "string" || hasUnsafeNameCharacter(value)) return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= 50 ? name : null;
}

function normalizeProfileName(value: unknown) {
  const name = normalizeDisplayName(value);
  return name?.toLocaleLowerCase("en-US") === "you" ? null : name;
}

function hasUnsafeNameCharacter(value: string) {
  return [...value].some((character) => {
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

function parseProfileBody(value: unknown) {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["name"])) {
    throw new ApiError("Send a valid name.", 400);
  }

  const name = normalizeProfileName(value.name);
  if (!name) throw new ApiError("Send a valid name.", 400);
  return name;
}

function parseWallHold(value: unknown): WallHold | null {
  if (!isPlainObject(value)) return null;
  if (!hasOnlyKeys(value, ["id", "x", "y", "size"])) return null;
  if (
    typeof value.id !== "string" ||
    !recordIdPattern.test(value.id) ||
    !isCoordinate(value.x) ||
    !isCoordinate(value.y) ||
    !isSize(value.size)
  ) {
    return null;
  }

  return { id: value.id, x: value.x, y: value.y, size: value.size };
}

function parseWallHoldsBody(value: unknown): WallHold[] {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ["holds"]) ||
    !Array.isArray(value.holds) ||
    value.holds.length > MAX_WALL_HOLDS
  ) {
    throw new ApiError("Send a valid wall hold layout.", 400);
  }

  const holds: WallHold[] = [];
  const ids = new Set<string>();
  for (const valueHold of value.holds) {
    const hold = parseWallHold(valueHold);
    if (!hold || ids.has(hold.id)) {
      throw new ApiError("Every wall hold must have a unique valid position.", 400);
    }
    ids.add(hold.id);
    holds.push(hold);
  }

  return holds;
}

function parseWallHoldsWriteBody(value: unknown) {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ["holds", "expectedUpdatedAt", "profileId"]) ||
    typeof value.expectedUpdatedAt !== "number" ||
    !Number.isSafeInteger(value.expectedUpdatedAt) ||
    value.expectedUpdatedAt < 0 ||
    typeof value.profileId !== "string" ||
    !recordIdPattern.test(value.profileId)
  ) {
    throw new ApiError("Send a valid wall hold layout and revision.", 400);
  }

  return {
    holds: parseWallHoldsBody({ holds: value.holds }),
    expectedUpdatedAt: value.expectedUpdatedAt,
    profileId: value.profileId,
  };
}

function parseClimbHold(value: unknown): ClimbHold | null {
  if (!isPlainObject(value)) return null;
  if (!hasOnlyKeys(value, ["holdId", "x", "y", "size", "role"])) return null;
  if (
    (value.holdId !== undefined &&
      (typeof value.holdId !== "string" || !recordIdPattern.test(value.holdId))) ||
    !isCoordinate(value.x) ||
    !isCoordinate(value.y) ||
    !isSize(value.size) ||
    typeof value.role !== "string" ||
    !holdRoles.has(value.role)
  ) {
    return null;
  }

  return {
    ...(value.holdId === undefined ? {} : { holdId: value.holdId }),
    x: value.x,
    y: value.y,
    size: value.size,
    role: value.role as ClimbHold["role"],
  };
}

function parseClimbHolds(value: unknown): ClimbHold[] {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > MAX_CLIMB_HOLDS
  ) {
    throw new ApiError("Every climb hold must be valid and unique.", 400);
  }

  const holds: ClimbHold[] = [];
  const holdIds = new Set<string>();
  for (const valueHold of value) {
    const hold = parseClimbHold(valueHold);
    if (!hold || (hold.holdId !== undefined && holdIds.has(hold.holdId))) {
      throw new ApiError("Every climb hold must be valid and unique.", 400);
    }
    if (hold.holdId !== undefined) holdIds.add(hold.holdId);
    holds.push(hold);
  }

  if (
    !holds.some((hold) => hold.role === "start") ||
    !holds.some((hold) => hold.role === "finish")
  ) {
    throw new ApiError("A climb needs at least one start and one finish hold.", 400);
  }

  return holds;
}

function parseClimbBody(value: unknown): Climb {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ["id", "name", "grade", "setter", "createdAt", "holds"])
  ) {
    throw new ApiError("Send valid climb details.", 400);
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  const setter = normalizeDisplayName(value.setter);
  const id = value.id === undefined ? crypto.randomUUID() : value.id;
  const createdAt = value.createdAt === undefined ? Date.now() : value.createdAt;

  if (
    typeof id !== "string" ||
    !recordIdPattern.test(id) ||
    !name ||
    name.length > 50 ||
    typeof value.grade !== "string" ||
    !gradePattern.test(value.grade) ||
    !setter ||
    typeof createdAt !== "number" ||
    !Number.isSafeInteger(createdAt) ||
    createdAt <= 0
  ) {
    throw new ApiError("Send valid climb details.", 400);
  }

  const holds = parseClimbHolds(value.holds);

  return {
    id,
    name,
    grade: value.grade,
    setter,
    createdAt,
    holds,
  };
}

function parseClimbUpdateBody(value: unknown) {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, [
      "name",
      "grade",
      "holds",
      "expectedWallUpdatedAt",
      "profileId",
    ])
  ) {
    throw new ApiError("Send valid climb changes.", 400);
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (
    !name ||
    name.length > 50 ||
    typeof value.grade !== "string" ||
    !gradePattern.test(value.grade) ||
    typeof value.expectedWallUpdatedAt !== "number" ||
    !Number.isSafeInteger(value.expectedWallUpdatedAt) ||
    value.expectedWallUpdatedAt < 0 ||
    typeof value.profileId !== "string" ||
    !recordIdPattern.test(value.profileId)
  ) {
    throw new ApiError("Send valid climb changes.", 400);
  }

  return {
    name,
    grade: value.grade,
    holds: parseClimbHolds(value.holds),
    expectedWallUpdatedAt: value.expectedWallUpdatedAt,
    profileId: value.profileId,
  };
}

function parseClimbDeleteBody(value: unknown) {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ["profileId"]) ||
    typeof value.profileId !== "string" ||
    !recordIdPattern.test(value.profileId)
  ) {
    throw new ApiError("Choose your user name before deleting.", 400);
  }

  return { profileId: value.profileId };
}

function parseClimbWriteBody(value: unknown) {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ["climb", "expectedWallUpdatedAt", "profileId"]) ||
    typeof value.expectedWallUpdatedAt !== "number" ||
    !Number.isSafeInteger(value.expectedWallUpdatedAt) ||
    value.expectedWallUpdatedAt < 0
  ) {
    throw new ApiError("Send valid climb details and a wall revision.", 400);
  }

  if (
    typeof value.profileId !== "string" ||
    !recordIdPattern.test(value.profileId)
  ) {
    throw new ApiError("Choose your user name before saving.", 400);
  }

  return {
    climb: parseClimbBody(value.climb),
    expectedWallUpdatedAt: value.expectedWallUpdatedAt,
    profileId: value.profileId,
  };
}

function parseSendWriteBody(value: unknown) {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ["climbKind", "climbId", "profileId", "rating"]) ||
    !isClimbKind(value.climbKind) ||
    (value.climbKind === "demo"
      ? !isDemoClimbId(value.climbId)
      : !isSavedClimbId(value.climbId)) ||
    typeof value.profileId !== "string" ||
    !recordIdPattern.test(value.profileId) ||
    typeof value.rating !== "number" ||
    !Number.isInteger(value.rating) ||
    value.rating < 1 ||
    value.rating > 5
  ) {
    throw new ApiError("Send a valid climb, user, and rating from 1 to 5.", 400);
  }

  return {
    climbKind: value.climbKind,
    climbId: value.climbId,
    profileId: value.profileId,
    rating: value.rating,
  };
}

async function readLimitedJson(request: Request, maximumBytes: number) {
  const contentType = (request.headers.get("Content-Type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError("Send JSON with an application/json content type.", 415);
  }

  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new ApiError("The request size is invalid.", 400);
    }
    if (Number(contentLength) > maximumBytes) {
      throw new ApiError("The request is too large.", 413);
    }
  }

  if (!request.body) throw new ApiError("A JSON request body is required.", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new ApiError("The request is too large.", 413);
    }
    chunks.push(value);
  }

  if (totalBytes === 0) throw new ApiError("A JSON request body is required.", 400);
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ApiError("The request body is not valid JSON.", 400);
  }
}

function requireSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new ApiError("Cross-origin changes are not allowed.", 403);
  }
}

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wall_configuration (
        id INTEGER PRIMARY KEY,
        holds_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS climbs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        grade TEXT NOT NULL,
        setter TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        holds_json TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS deleted_climbs (
        id TEXT PRIMARY KEY,
        deleted_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS climb_sends (
        climb_kind TEXT NOT NULL CHECK (climb_kind IN ('demo', 'saved')),
        climb_id TEXT NOT NULL,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating IN (1, 2, 3, 4, 5)),
        sent_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (climb_kind, climb_id, profile_id)
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_climbs_created_at
      ON climbs(created_at)
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_climb_sends_profile_id
      ON climb_sends(profile_id)
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_profiles_name_nocase
      ON profiles(name COLLATE NOCASE)
    `),
    db.prepare(`
      INSERT OR IGNORE INTO wall_configuration (id, holds_json, updated_at)
      VALUES (?, ?, ?)
    `).bind(WALL_CONFIGURATION_ID, "[]", 0),
  ]);
}

function rowToProfile(row: ProfileRow): Profile {
  const name = normalizeProfileName(row.name);
  if (
    !recordIdPattern.test(row.id) ||
    !name ||
    !Number.isSafeInteger(row.created_at) ||
    row.created_at <= 0
  ) {
    throw new ApiError("A saved user profile is invalid.", 500);
  }
  return { id: row.id, name, createdAt: row.created_at };
}

async function loadCanonicalProfile(db: D1Database, profileId: string) {
  const row = await db
    .prepare(
      `SELECT canonical.id, canonical.name, canonical.created_at
       FROM profiles AS requested
       JOIN profiles AS canonical
         ON canonical.name = requested.name COLLATE NOCASE
       WHERE requested.id = ?
       ORDER BY canonical.created_at ASC, canonical.id ASC
       LIMIT 1`,
    )
    .bind(profileId)
    .first<ProfileRow>();
  return row ? rowToProfile(row) : null;
}

export async function isAdminProfileId(
  db: D1Database,
  profileId: string | null,
) {
  if (!profileId || !recordIdPattern.test(profileId)) return false;
  await ensureSchema(db);
  const profile = await loadCanonicalProfile(db, profileId);
  return Boolean(profile && isAdminUserName(profile.name));
}

function requireClimbManager(
  profile: Profile,
  setter: string,
  action: "edit" | "delete",
) {
  if (isAdminUserName(profile.name) || isSameUserName(profile.name, setter)) {
    return;
  }

  throw new ApiError(`You can only ${action} climbs you set.`, 403);
}

function parseStoredHolds(raw: string): WallHold[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parseWallHoldsBody({ holds: parsed });
  } catch {
    throw new ApiError("The saved wall layout is invalid.", 500);
  }
}

function rowToClimb(row: ClimbRow): Climb {
  try {
    const holds: unknown = JSON.parse(row.holds_json);
    return parseClimbBody({
      id: row.id,
      name: row.name,
      grade: row.grade,
      setter: row.setter,
      createdAt: row.created_at,
      holds,
    });
  } catch {
    throw new ApiError("A saved climb is invalid.", 500);
  }
}

function isMatchingLegacyClimb(existing: Climb, submitted: Climb) {
  return (
    existing.setter === "You" &&
    existing.id === submitted.id &&
    existing.name === submitted.name &&
    existing.grade === submitted.grade &&
    existing.createdAt === submitted.createdAt
  );
}

function resolveClimbHolds(
  climbHolds: ClimbHold[],
  wallHolds: WallHold[],
) {
  const wallHoldsById = new Map(wallHolds.map((hold) => [hold.id, hold]));
  const usedIds = new Set<string>();

  return climbHolds.map((hold) => {
    if (hold.holdId) {
      const current = wallHoldsById.get(hold.holdId);
      if (!current || usedIds.has(current.id)) {
        throw new ApiError(
          "Every climb hold must be one of the saved wall spots.",
          400,
        );
      }

      usedIds.add(current.id);
      return { ...hold, x: current.x, y: current.y, size: current.size };
    }

    const matches = wallHolds
      .filter((wallHold) => !usedIds.has(wallHold.id))
      .map((wallHold) => ({
        wallHold,
        distance: Math.hypot(wallHold.x - hold.x, wallHold.y - hold.y),
      }))
      .sort((a, b) => a.distance - b.distance);
    const match = matches[0];
    const runnerUp = matches[1];
    if (
      !match ||
      match.distance > MAX_LEGACY_HOLD_MATCH_DISTANCE ||
      (runnerUp &&
        runnerUp.distance - match.distance < MIN_LEGACY_HOLD_MATCH_GAP)
    ) {
      throw new ApiError(
        "A climb hold could not be matched safely. Align the preset spots in Wall Setup and try again.",
        409,
      );
    }

    usedIds.add(match.wallHold.id);
    return {
      ...hold,
      holdId: match.wallHold.id,
      x: match.wallHold.x,
      y: match.wallHold.y,
      size: match.wallHold.size,
    };
  });
}

function resolveClimbForRead(climb: Climb, wallHolds: WallHold[]): Climb {
  const wallHoldsById = new Map(wallHolds.map((hold) => [hold.id, hold]));
  return {
    ...climb,
    holds: climb.holds.map((hold) => {
      const current = hold.holdId ? wallHoldsById.get(hold.holdId) : undefined;
      return current
        ? { ...hold, x: current.x, y: current.y, size: current.size }
        : hold;
    }),
  };
}

async function loadWallConfiguration(db: D1Database) {
  const row = await db
    .prepare(
      "SELECT holds_json, updated_at FROM wall_configuration WHERE id = ?",
    )
    .bind(WALL_CONFIGURATION_ID)
    .first<WallConfigurationRow>();
  if (!row) throw new ApiError("The wall layout is unavailable.", 500);
  return row;
}

async function handleWallHolds(request: Request, db: D1Database) {
  if (request.method === "GET") {
    const row = await loadWallConfiguration(db);

    return json({
      holds: parseStoredHolds(row.holds_json),
      updatedAt: row.updated_at,
    });
  }

  if (request.method === "PUT") {
    requireSameOrigin(request);
    const { holds, expectedUpdatedAt, profileId } = parseWallHoldsWriteBody(
      await readLimitedJson(request, MAX_WALL_HOLDS_BODY_BYTES),
    );
    const profile = await loadCanonicalProfile(db, profileId);
    if (!profile) {
      throw new ApiError("Choose your user name again before saving.", 400);
    }
    if (!isAdminUserName(profile.name)) {
      throw new ApiError("Only Admin can change the wall setup.", 403);
    }
    const currentConfiguration = await loadWallConfiguration(db);
    if (currentConfiguration.updated_at !== expectedUpdatedAt) {
      throw new ApiError(
        "The wall spots changed in another tab. Reload them and try again.",
        409,
      );
    }

    const currentIds = new Set(
      parseStoredHolds(currentConfiguration.holds_json).map((hold) => hold.id),
    );
    const nextIds = new Set(holds.map((hold) => hold.id));
    if ([...currentIds].some((holdId) => !nextIds.has(holdId))) {
      throw new ApiError(
        "Saved hold spots cannot be removed. Reposition them so existing climbs keep working.",
        409,
      );
    }

    const updatedAt = Math.max(Date.now(), expectedUpdatedAt + 1);
    const updated = await db
      .prepare(
        "UPDATE wall_configuration SET holds_json = ?, updated_at = ? WHERE id = ? AND updated_at = ? RETURNING updated_at",
      )
      .bind(
        JSON.stringify(holds),
        updatedAt,
        WALL_CONFIGURATION_ID,
        expectedUpdatedAt,
      )
      .first<{ updated_at: number }>();
    if (!updated) {
      throw new ApiError(
        "The wall spots changed in another tab. Reload them and try again.",
        409,
      );
    }

    return json({ holds, updatedAt });
  }

  return methodNotAllowed(["GET", "PUT"]);
}

async function handleProfiles(request: Request, db: D1Database) {
  if (request.method === "GET") {
    const result = await db
      .prepare(
        `SELECT current.id, current.name, current.created_at
         FROM profiles AS current
         WHERE NOT EXISTS (
           SELECT 1 FROM profiles AS earlier
           WHERE earlier.name = current.name COLLATE NOCASE
             AND (
               earlier.created_at < current.created_at OR
               (earlier.created_at = current.created_at AND earlier.id < current.id)
             )
         )
         ORDER BY current.name COLLATE NOCASE ASC,
                  current.created_at ASC,
                  current.id ASC
         LIMIT 200`,
      )
      .all<ProfileRow>();
    return json({ profiles: result.results.map(rowToProfile) });
  }

  if (request.method !== "POST") {
    return methodNotAllowed(["GET", "POST"]);
  }

  requireSameOrigin(request);
  const name = parseProfileBody(
    await readLimitedJson(request, MAX_PROFILE_BODY_BYTES),
  );
  const candidate: Profile = {
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
  };
  const inserted = await db
    .prepare(
      `INSERT INTO profiles (id, name, created_at)
       SELECT ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM profiles WHERE name = ? COLLATE NOCASE
       )
       RETURNING id, name, created_at`,
    )
    .bind(candidate.id, candidate.name, candidate.createdAt, candidate.name)
    .first<ProfileRow>();
  if (inserted) return json({ profile: rowToProfile(inserted) }, 201);

  const existingProfile = await db
    .prepare(
      `SELECT id, name, created_at FROM profiles
       WHERE name = ? COLLATE NOCASE
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
    .bind(name)
    .first<ProfileRow>();
  if (!existingProfile) {
    throw new ApiError("The user profile could not be created.", 500);
  }
  return json({ profile: rowToProfile(existingProfile) });
}

function referenceFromRow(row: {
  climb_kind: string;
  climb_id: string;
}): { climbKind: ClimbKind; climbId: string } {
  if (
    !isClimbKind(row.climb_kind) ||
    (row.climb_kind === "demo"
      ? !isDemoClimbId(row.climb_id)
      : !isSavedClimbId(row.climb_id))
  ) {
    throw new ApiError("A saved climb rating is invalid.", 500);
  }
  return { climbKind: row.climb_kind, climbId: row.climb_id };
}

function activityFromAggregate(
  row: SendAggregateRow,
  userRating = row.user_rating ?? null,
) {
  const reference = referenceFromRow(row);
  if (
    !isFiniteNumber(row.average_rating) ||
    row.average_rating < 1 ||
    row.average_rating > 5 ||
    !Number.isSafeInteger(row.rating_count) ||
    row.rating_count < 1 ||
    (userRating !== null &&
      (!Number.isInteger(userRating) || userRating < 1 || userRating > 5))
  ) {
    throw new ApiError("A saved climb rating is invalid.", 500);
  }

  return {
    ...reference,
    averageRating: row.average_rating,
    ratingCount: row.rating_count,
    userRating,
  };
}

async function handleSends(request: Request, db: D1Database) {
  if (request.method === "GET") {
    const profileId = new URL(request.url).searchParams.get("profileId");
    if (!profileId || !recordIdPattern.test(profileId)) {
      throw new ApiError("Choose your user name before loading sends.", 400);
    }
    const profile = await loadCanonicalProfile(db, profileId);
    if (!profile) {
      throw new ApiError("Choose your user name again before loading sends.", 404);
    }

    const aggregateResult = await db
      .prepare(
        `SELECT climb_kind, climb_id,
                ROUND(AVG(rating), 1) AS average_rating,
                COUNT(*) AS rating_count,
                MAX(CASE WHEN profile_id = ? THEN rating END) AS user_rating
         FROM climb_sends
         GROUP BY climb_kind, climb_id
         ORDER BY climb_kind ASC, climb_id ASC`,
      )
      .bind(profile.id)
      .all<SendAggregateRow>();

    return json({
      activities: aggregateResult.results.flatMap((row) => {
        if (row.climb_kind === "demo" && !isDemoClimbId(row.climb_id)) {
          return [];
        }
        return [activityFromAggregate(row)];
      }),
    });
  }

  if (request.method === "POST") {
    requireSameOrigin(request);
    const send = parseSendWriteBody(
      await readLimitedJson(request, MAX_SEND_BODY_BYTES),
    );
    const profile = await loadCanonicalProfile(db, send.profileId);
    if (!profile) {
      throw new ApiError("Choose your user name again before saving.", 400);
    }

    const now = Date.now();
    const upsert =
      send.climbKind === "demo"
        ? db.prepare(
            `INSERT INTO climb_sends
               (climb_kind, climb_id, profile_id, rating, sent_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (climb_kind, climb_id, profile_id)
             DO UPDATE SET rating = excluded.rating,
                           updated_at = excluded.updated_at
             RETURNING climb_kind, climb_id, profile_id, rating, sent_at, updated_at`,
          )
        : db.prepare(
            `INSERT INTO climb_sends
               (climb_kind, climb_id, profile_id, rating, sent_at, updated_at)
             SELECT ?, ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM climbs WHERE id = ?)
             ON CONFLICT (climb_kind, climb_id, profile_id)
             DO UPDATE SET rating = excluded.rating,
                           updated_at = excluded.updated_at
             RETURNING climb_kind, climb_id, profile_id, rating, sent_at, updated_at`,
          );
    const values = [
      send.climbKind,
      send.climbId,
      profile.id,
      send.rating,
      now,
      now,
      ...(send.climbKind === "saved" ? [send.climbId] : []),
    ];
    const saved = await upsert.bind(...values).first<ClimbSendRow>();
    if (!saved) {
      const wasDeleted = await db
        .prepare("SELECT id FROM deleted_climbs WHERE id = ?")
        .bind(send.climbId)
        .first<{ id: string }>();
      if (wasDeleted) throw new ApiError("This climb was deleted.", 410);
      throw new ApiError("Climb not found.", 404);
    }

    const aggregate = await db
      .prepare(
        `SELECT climb_kind, climb_id,
                ROUND(AVG(rating), 1) AS average_rating,
                COUNT(*) AS rating_count
         FROM climb_sends
         WHERE climb_kind = ? AND climb_id = ?
         GROUP BY climb_kind, climb_id`,
      )
      .bind(send.climbKind, send.climbId)
      .first<SendAggregateRow>();
    if (!aggregate) {
      if (send.climbKind === "saved") {
        const wasDeleted = await db
          .prepare("SELECT id FROM deleted_climbs WHERE id = ?")
          .bind(send.climbId)
          .first<{ id: string }>();
        if (wasDeleted) throw new ApiError("This climb was deleted.", 410);
      }
      throw new ApiError("The saved climb rating could not be loaded.", 500);
    }

    return json({
      activities: [activityFromAggregate(aggregate, saved.rating)],
    });
  }

  return methodNotAllowed(["GET", "POST"]);
}

async function handleProfileDetail(
  request: Request,
  db: D1Database,
  encodedId: string,
) {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);

  let id: string;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    throw new ApiError("The user profile id is invalid.", 400);
  }
  if (!recordIdPattern.test(id)) {
    throw new ApiError("The user profile id is invalid.", 400);
  }

  const profile = await loadCanonicalProfile(db, id);
  if (!profile) throw new ApiError("User profile not found.", 404);

  return json({ profile });
}

async function handleClimbs(request: Request, db: D1Database) {
  if (request.method === "GET") {
    const [result, wallConfiguration] = await Promise.all([
      db
        .prepare(
          "SELECT id, name, grade, setter, created_at, holds_json FROM climbs ORDER BY created_at DESC, id ASC",
        )
        .all<ClimbRow>(),
      loadWallConfiguration(db),
    ]);
    const wallHolds = parseStoredHolds(wallConfiguration.holds_json);
    return json({
      climbs: result.results.map((row) =>
        resolveClimbForRead(rowToClimb(row), wallHolds),
      ),
    });
  }

  if (request.method === "POST") {
    requireSameOrigin(request);
    const { climb: parsedClimb, expectedWallUpdatedAt, profileId } =
      parseClimbWriteBody(
        await readLimitedJson(request, MAX_CLIMB_BODY_BYTES),
      );
    const profile = await loadCanonicalProfile(db, profileId);
    if (!profile) {
      throw new ApiError("Choose your user name again before saving.", 400);
    }
    const setter = profile.name;
    const existing = await db
      .prepare(
        "SELECT id, name, grade, setter, created_at, holds_json FROM climbs WHERE id = ?",
      )
      .bind(parsedClimb.id)
      .first<ClimbRow>();
    if (existing) {
      const existingClimb = rowToClimb(existing);
      if (!isMatchingLegacyClimb(existingClimb, parsedClimb)) {
        throw new ApiError("A climb with this id already exists.", 409);
      }

      let claimedHolds = existingClimb.holds;
      const wallConfiguration = await loadWallConfiguration(db);
      try {
        claimedHolds = resolveClimbHolds(
          existingClimb.holds,
          parseStoredHolds(wallConfiguration.holds_json),
        );
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          (error.status !== 400 && error.status !== 409)
        ) {
          throw error;
        }
        // Attribution can still succeed if an old coordinate-only climb no
        // longer lines up with the current wall photo.
      }

      await db
        .prepare(
          "UPDATE climbs SET setter = ?, holds_json = ? WHERE id = ? AND setter = ?",
        )
        .bind(setter, JSON.stringify(claimedHolds), parsedClimb.id, "You")
        .run();
      const claimed = await db
        .prepare(
          "SELECT id, name, grade, setter, created_at, holds_json FROM climbs WHERE id = ?",
        )
        .bind(parsedClimb.id)
        .first<ClimbRow>();
      if (!claimed || rowToClimb(claimed).setter !== setter) {
        throw new ApiError("A climb with this id already exists.", 409);
      }

      return json({ climb: rowToClimb(claimed) });
    }

    const wasDeleted = await db
      .prepare("SELECT id FROM deleted_climbs WHERE id = ?")
      .bind(parsedClimb.id)
      .first<{ id: string }>();
    if (wasDeleted) {
      throw new ApiError("This climb was deleted and cannot be restored.", 410);
    }

    const wallConfiguration = await loadWallConfiguration(db);
    if (wallConfiguration.updated_at !== expectedWallUpdatedAt) {
      throw new ApiError(
        "The wall spots changed while you were setting. Reload the wall and try again.",
        409,
      );
    }
    const wallHolds = parseStoredHolds(wallConfiguration.holds_json);
    const climb: Climb = {
      ...parsedClimb,
      setter,
      holds: resolveClimbHolds(parsedClimb.holds, wallHolds),
    };

    try {
      const inserted = await db
        .prepare(
          `INSERT INTO climbs (id, name, grade, setter, created_at, holds_json)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM wall_configuration WHERE id = ? AND updated_at = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM deleted_climbs WHERE id = ?
           )
           RETURNING id`,
        )
        .bind(
          climb.id,
          climb.name,
          climb.grade,
          climb.setter,
          climb.createdAt,
          JSON.stringify(climb.holds),
          WALL_CONFIGURATION_ID,
          expectedWallUpdatedAt,
          climb.id,
        )
        .first<{ id: string }>();
      if (!inserted) {
        const deletedDuringSave = await db
          .prepare("SELECT id FROM deleted_climbs WHERE id = ?")
          .bind(climb.id)
          .first<{ id: string }>();
        if (deletedDuringSave) {
          throw new ApiError(
            "This climb was deleted and cannot be restored.",
            410,
          );
        }
        throw new ApiError(
          "The wall spots changed while you were setting. Reload the wall and try again.",
          409,
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed:\s*climbs\.id/i.test(error.message)
      ) {
        throw new ApiError("A climb with this id already exists.", 409);
      }
      throw error;
    }

    return json({ climb }, 201);
  }

  return methodNotAllowed(["GET", "POST"]);
}

async function handleClimbDetail(
  request: Request,
  db: D1Database,
  encodedId: string,
) {
  if (
    request.method !== "GET" &&
    request.method !== "PUT" &&
    request.method !== "DELETE"
  ) {
    return methodNotAllowed(["GET", "PUT", "DELETE"]);
  }

  let id: string;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    throw new ApiError("The climb id is invalid.", 400);
  }
  if (!recordIdPattern.test(id)) {
    throw new ApiError("The climb id is invalid.", 400);
  }

  if (request.method === "PUT" || request.method === "DELETE") {
    requireSameOrigin(request);
  }

  const row = await db
    .prepare(
      "SELECT id, name, grade, setter, created_at, holds_json FROM climbs WHERE id = ?",
    )
    .bind(id)
    .first<ClimbRow>();
  if (!row) {
    const wasDeleted = await db
      .prepare("SELECT id FROM deleted_climbs WHERE id = ?")
      .bind(id)
      .first<{ id: string }>();
    if (wasDeleted) throw new ApiError("This climb was deleted.", 410);
    throw new ApiError("Climb not found.", 404);
  }

  if (request.method === "DELETE") {
    const { profileId } = parseClimbDeleteBody(
      await readLimitedJson(request, MAX_PROFILE_BODY_BYTES),
    );
    const profile = await loadCanonicalProfile(db, profileId);
    if (!profile) {
      throw new ApiError("Choose your user name again before deleting.", 400);
    }
    requireClimbManager(profile, row.setter, "delete");

    await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO deleted_climbs (id, deleted_at) VALUES (?, ?)",
        )
        .bind(id, Date.now()),
      db
        .prepare(
          "DELETE FROM climb_sends WHERE climb_kind = ? AND climb_id = ?",
        )
        .bind("saved", id),
      db.prepare("DELETE FROM climbs WHERE id = ?").bind(id),
    ]);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (request.method === "PUT") {
    const changes = parseClimbUpdateBody(
      await readLimitedJson(request, MAX_CLIMB_BODY_BYTES),
    );
    const profile = await loadCanonicalProfile(db, changes.profileId);
    if (!profile) {
      throw new ApiError("Choose your user name again before saving.", 400);
    }
    requireClimbManager(profile, row.setter, "edit");

    const wallConfiguration = await loadWallConfiguration(db);
    if (wallConfiguration.updated_at !== changes.expectedWallUpdatedAt) {
      throw new ApiError(
        "The wall spots changed while you were editing. Reload the wall and try again.",
        409,
      );
    }

    const holds = resolveClimbHolds(
      changes.holds,
      parseStoredHolds(wallConfiguration.holds_json),
    );
    const updated = await db
      .prepare(
        `UPDATE climbs
         SET name = ?, grade = ?, holds_json = ?
         WHERE id = ?
           AND EXISTS (
             SELECT 1 FROM wall_configuration WHERE id = ? AND updated_at = ?
           )
         RETURNING id, name, grade, setter, created_at, holds_json`,
      )
      .bind(
        changes.name,
        changes.grade,
        JSON.stringify(holds),
        id,
        WALL_CONFIGURATION_ID,
        changes.expectedWallUpdatedAt,
      )
      .first<ClimbRow>();
    if (!updated) {
      const wasDeleted = await db
        .prepare("SELECT id FROM deleted_climbs WHERE id = ?")
        .bind(id)
        .first<{ id: string }>();
      if (wasDeleted) throw new ApiError("This climb was deleted.", 410);
      throw new ApiError(
        "The wall spots changed while you were editing. Reload the wall and try again.",
        409,
      );
    }

    return json({ climb: rowToClimb(updated) });
  }

  const wallHolds = parseStoredHolds(
    (await loadWallConfiguration(db)).holds_json,
  );
  return json({ climb: resolveClimbForRead(rowToClimb(row), wallHolds) });
}

export function isAppDataPath(pathname: string) {
  return (
    pathname === WALL_HOLDS_PATH ||
    pathname === CLIMBS_PATH ||
    pathname === PROFILES_PATH ||
    pathname === SENDS_PATH ||
    /^\/api\/climbs\/[^/]+$/.test(pathname) ||
    /^\/api\/profiles\/[^/]+$/.test(pathname)
  );
}

export async function handleAppDataRequest(
  request: Request,
  db: D1Database | undefined,
): Promise<Response> {
  if (!db) return jsonError("App data storage is unavailable.", 503);

  try {
    await ensureSchema(db);
    const pathname = new URL(request.url).pathname;
    if (pathname === WALL_HOLDS_PATH) return await handleWallHolds(request, db);
    if (pathname === PROFILES_PATH) return await handleProfiles(request, db);
    if (pathname === CLIMBS_PATH) return await handleClimbs(request, db);
    if (pathname === SENDS_PATH) return await handleSends(request, db);

    const profileMatch = /^\/api\/profiles\/([^/]+)$/.exec(pathname);
    if (profileMatch) {
      return await handleProfileDetail(request, db, profileMatch[1]);
    }

    const detailMatch = /^\/api\/climbs\/([^/]+)$/.exec(pathname);
    if (detailMatch) return await handleClimbDetail(request, db, detailMatch[1]);
    return jsonError("Not found.", 404);
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error.message, error.status);
    return jsonError("The app data request could not be completed.", 500);
  }
}
