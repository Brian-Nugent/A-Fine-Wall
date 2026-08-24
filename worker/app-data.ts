const WALL_HOLDS_PATH = "/api/wall-holds";
const CLIMBS_PATH = "/api/climbs";
const WALL_CONFIGURATION_ID = 1;
const MAX_WALL_HOLDS_BODY_BYTES = 256 * 1024;
const MAX_CLIMB_BODY_BYTES = 128 * 1024;
const MAX_WALL_HOLDS = 1_000;
const MAX_CLIMB_HOLDS = 200;
const MAX_LEGACY_HOLD_MATCH_DISTANCE = 3;
const MIN_LEGACY_HOLD_MATCH_GAP = 0.75;

const holdRoles = new Set(["start", "hand", "finish"]);
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
  role: "start" | "hand" | "finish";
};

type Climb = {
  id: string;
  name: string;
  grade: string;
  setter: string;
  createdAt: number;
  holds: ClimbHold[];
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
    !hasOnlyKeys(value, ["holds", "expectedUpdatedAt"]) ||
    typeof value.expectedUpdatedAt !== "number" ||
    !Number.isSafeInteger(value.expectedUpdatedAt) ||
    value.expectedUpdatedAt < 0
  ) {
    throw new ApiError("Send a valid wall hold layout and revision.", 400);
  }

  return {
    holds: parseWallHoldsBody({ holds: value.holds }),
    expectedUpdatedAt: value.expectedUpdatedAt,
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

function parseClimbBody(value: unknown): Climb {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ["id", "name", "grade", "setter", "createdAt", "holds"])
  ) {
    throw new ApiError("Send valid climb details.", 400);
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  const setter = typeof value.setter === "string" ? value.setter.trim() : "You";
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
    setter.length > 50 ||
    typeof createdAt !== "number" ||
    !Number.isSafeInteger(createdAt) ||
    createdAt <= 0 ||
    !Array.isArray(value.holds) ||
    value.holds.length < 2 ||
    value.holds.length > MAX_CLIMB_HOLDS
  ) {
    throw new ApiError("Send valid climb details.", 400);
  }

  const holds: ClimbHold[] = [];
  const holdIds = new Set<string>();
  for (const valueHold of value.holds) {
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

  return {
    id,
    name,
    grade: value.grade,
    setter,
    createdAt,
    holds,
  };
}

function parseClimbWriteBody(value: unknown) {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ["climb", "expectedWallUpdatedAt"]) ||
    typeof value.expectedWallUpdatedAt !== "number" ||
    !Number.isSafeInteger(value.expectedWallUpdatedAt) ||
    value.expectedWallUpdatedAt < 0
  ) {
    throw new ApiError("Send valid climb details and a wall revision.", 400);
  }

  return {
    climb: parseClimbBody(value.climb),
    expectedWallUpdatedAt: value.expectedWallUpdatedAt,
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
      CREATE INDEX IF NOT EXISTS idx_climbs_created_at
      ON climbs(created_at)
    `),
    db.prepare(`
      INSERT OR IGNORE INTO wall_configuration (id, holds_json, updated_at)
      VALUES (?, ?, ?)
    `).bind(WALL_CONFIGURATION_ID, "[]", 0),
  ]);
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
    const { holds, expectedUpdatedAt } = parseWallHoldsWriteBody(
      await readLimitedJson(request, MAX_WALL_HOLDS_BODY_BYTES),
    );
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
    const { climb: parsedClimb, expectedWallUpdatedAt } = parseClimbWriteBody(
      await readLimitedJson(request, MAX_CLIMB_BODY_BYTES),
    );
    const existing = await db
      .prepare("SELECT id FROM climbs WHERE id = ?")
      .bind(parsedClimb.id)
      .first<{ id: string }>();
    if (existing) throw new ApiError("A climb with this id already exists.", 409);

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
        )
        .first<{ id: string }>();
      if (!inserted) {
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
  if (request.method !== "GET") return methodNotAllowed(["GET"]);

  let id: string;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    throw new ApiError("The climb id is invalid.", 400);
  }
  if (!recordIdPattern.test(id)) {
    throw new ApiError("The climb id is invalid.", 400);
  }

  const row = await db
    .prepare(
      "SELECT id, name, grade, setter, created_at, holds_json FROM climbs WHERE id = ?",
    )
    .bind(id)
    .first<ClimbRow>();
  if (!row) throw new ApiError("Climb not found.", 404);

  const wallHolds = parseStoredHolds(
    (await loadWallConfiguration(db)).holds_json,
  );
  return json({ climb: resolveClimbForRead(rowToClimb(row), wallHolds) });
}

export function isAppDataPath(pathname: string) {
  return (
    pathname === WALL_HOLDS_PATH ||
    pathname === CLIMBS_PATH ||
    /^\/api\/climbs\/[^/]+$/.test(pathname)
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
    if (pathname === CLIMBS_PATH) return await handleClimbs(request, db);

    const detailMatch = /^\/api\/climbs\/([^/]+)$/.exec(pathname);
    if (detailMatch) return await handleClimbDetail(request, db, detailMatch[1]);
    return jsonError("Not found.", 404);
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error.message, error.status);
    return jsonError("The app data request could not be completed.", 500);
  }
}
