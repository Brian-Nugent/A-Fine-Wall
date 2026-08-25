export const CLIMB_KINDS = ["demo", "saved"] as const;
export const DEMO_CLIMB_IDS = [] as const;

export type ClimbKind = (typeof CLIMB_KINDS)[number];
export type ClimbReference = {
  climbKind: ClimbKind;
  climbId: string;
};

export type ClimbActivity = ClimbReference & {
  averageRating: number;
  ratingCount: number;
  userRating: number | null;
};

const savedClimbIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const demoClimbIds = new Set<string>(DEMO_CLIMB_IDS);

export function isClimbKind(value: unknown): value is ClimbKind {
  return value === "demo" || value === "saved";
}

export function isDemoClimbId(value: unknown): value is string {
  return typeof value === "string" && demoClimbIds.has(value);
}

export function isSavedClimbId(value: unknown): value is string {
  return typeof value === "string" && savedClimbIdPattern.test(value);
}

export function isClimbReference(
  value: unknown,
): value is ClimbReference {
  if (!value || typeof value !== "object") return false;
  const reference = value as Record<string, unknown>;
  if (!isClimbKind(reference.climbKind)) return false;
  return reference.climbKind === "demo"
    ? isDemoClimbId(reference.climbId)
    : isSavedClimbId(reference.climbId);
}

export function climbActivityKey(reference: ClimbReference) {
  return `${reference.climbKind}:${reference.climbId}`;
}

function isRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
  );
}

function parseActivity(value: unknown): ClimbActivity | null {
  if (!value || typeof value !== "object") return null;
  const activity = value as Record<string, unknown>;
  if (
    !isClimbReference(activity) ||
    typeof activity.averageRating !== "number" ||
    !Number.isFinite(activity.averageRating) ||
    activity.averageRating < 1 ||
    activity.averageRating > 5 ||
    typeof activity.ratingCount !== "number" ||
    !Number.isSafeInteger(activity.ratingCount) ||
    activity.ratingCount < 1 ||
    (activity.userRating !== null && !isRating(activity.userRating))
  ) {
    return null;
  }

  return {
    climbKind: activity.climbKind,
    climbId: activity.climbId,
    averageRating: activity.averageRating,
    ratingCount: activity.ratingCount,
    userRating: activity.userRating,
  };
}

export function parseClimbActivitiesPayload(
  value: unknown,
): ClimbActivity[] | null {
  if (!value || typeof value !== "object" || !("activities" in value)) {
    return null;
  }
  const activities = (value as { activities?: unknown }).activities;
  if (!Array.isArray(activities)) return null;

  const parsed = activities.map(parseActivity);
  return parsed.every(
    (activity): activity is ClimbActivity => activity !== null,
  )
    ? parsed
    : null;
}

export function findClimbActivity(
  activities: readonly ClimbActivity[],
  reference: ClimbReference,
) {
  const key = climbActivityKey(reference);
  return (
    activities.find((activity) => climbActivityKey(activity) === key) ?? null
  );
}

export function formatAverageRating(rating: number) {
  return rating.toFixed(1).replace(/\.0$/, "");
}
