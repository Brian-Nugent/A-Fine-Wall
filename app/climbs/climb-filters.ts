import { getGradeBand, type GradeBand } from "./climb-grade";

export const MIN_FILTER_GRADE = 0;
export const MAX_FILTER_GRADE = 17;
export const MAX_FILTER_HOLDS = 200;
export const MIN_FILTER_STARS = 0;
export const MAX_FILTER_STARS = 5;
export const FILTER_GRADE_COLORS: readonly GradeBand[] = [
  "green", "yellow", "red",
];

const holdIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export type ClimbOrder = "newest" | "ascents" | "grade";

export type ClimbFilters = {
  colors: GradeBand[];
  authors: string[];
  holdIds: string[];
  hideSent: boolean;
  showOutdated: boolean;
  minStars: number;
  rockoApprovedOnly: boolean;
  order: ClimbOrder;
};

export type FilterSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type FilterableClimb = {
  grade: string;
  outdated?: boolean;
  rockoApproved?: boolean;
  setter: string;
  holds: readonly { holdId?: string | null }[];
};

export type FilterableClimbActivity = {
  averageRating: number;
  ratingCount: number;
  userRating: number | null;
};

export type OrderableClimb = {
  activity: FilterableClimbActivity | null;
  createdAt: number;
  grade: string;
  id: string;
};

export type AdjacentClimbIds = {
  previousId: string | null;
  nextId: string | null;
};

export const DEFAULT_CLIMB_FILTERS: Readonly<ClimbFilters> = {
  colors: [],
  authors: [],
  holdIds: [],
  hideSent: false,
  showOutdated: false,
  minStars: MIN_FILTER_STARS,
  rockoApprovedOnly: false,
  order: "newest",
};

function valuesFor(
  source: URLSearchParams | FilterSearchParams,
  key: string,
) {
  if (source instanceof URLSearchParams) return source.getAll(key);

  const value = source[key];
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}

function hasUnsafeCharacter(value: string) {
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

function normalizeAuthor(value: unknown) {
  if (typeof value !== "string" || hasUnsafeCharacter(value)) return null;

  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= 50 ? name : null;
}

function authorKey(value: string) {
  return value.toLocaleLowerCase("en-US");
}

function uniqueAuthors(values: readonly string[]) {
  const byKey = new Map<string, string>();
  values.forEach((value) => {
    const key = authorKey(value);
    if (!byKey.has(key)) byKey.set(key, value);
  });
  return [...byKey.values()].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort();
}

function normalizeGrade(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(
    MAX_FILTER_GRADE,
    Math.max(MIN_FILTER_GRADE, Math.round(value)),
  );
}

function readGrade(values: readonly string[], fallback: number) {
  const value = values[0];
  if (!value || !/^-?\d+$/.test(value)) return fallback;
  return normalizeGrade(Number(value), fallback);
}

function normalizeStars(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_CLIMB_FILTERS.minStars;
  return Math.min(
    MAX_FILTER_STARS,
    Math.max(MIN_FILTER_STARS, Math.round(value)),
  );
}

function readStars(values: readonly string[]) {
  const value = values[0];
  return value && /^\d+$/.test(value)
    ? normalizeStars(Number(value))
    : DEFAULT_CLIMB_FILTERS.minStars;
}

function normalizeOrder(value: unknown): ClimbOrder {
  return value === "ascents" || value === "grade" ? value : "newest";
}

export function normalizeClimbFilters(filters: ClimbFilters): ClimbFilters {
  const colors = FILTER_GRADE_COLORS.filter(
    (color) => filters.colors.includes(color),
  );
  const authors = uniqueAuthors(
    filters.authors.flatMap((value) => {
      const author = normalizeAuthor(value);
      return author ? [author] : [];
    }),
  ).slice(0, 200);
  const holdIds = uniqueSorted(
    filters.holdIds.filter((value) => holdIdPattern.test(value)),
  ).slice(0, MAX_FILTER_HOLDS);

  return {
    colors,
    authors,
    holdIds,
    hideSent: filters.hideSent === true,
    showOutdated: filters.showOutdated === true,
    minStars: normalizeStars(filters.minStars),
    rockoApprovedOnly: filters.rockoApprovedOnly === true,
    order: normalizeOrder(filters.order),
  };
}

export function parseClimbFilters(
  source: URLSearchParams | FilterSearchParams,
): ClimbFilters {
  const requestedColors = valuesFor(source, "color");
  const colors = FILTER_GRADE_COLORS.filter((color) =>
    requestedColors.includes(color),
  );
  // Old grade-range links expand to the full overlapping color bands.
  // They must never narrow an unsent climb down to its exact grade.
  if (requestedColors.length === 0) {
    const firstGrade = readGrade(valuesFor(source, "min"), MIN_FILTER_GRADE);
    const secondGrade = readGrade(valuesFor(source, "max"), MAX_FILTER_GRADE);
    const minimum = Math.min(firstGrade, secondGrade);
    const maximum = Math.max(firstGrade, secondGrade);
    if (minimum > MIN_FILTER_GRADE || maximum < MAX_FILTER_GRADE) {
      if (minimum <= 4) colors.push("green");
      if (minimum <= 7 && maximum >= 5) colors.push("yellow");
      if (maximum >= 8) colors.push("red");
    }
  }

  return normalizeClimbFilters({
    colors,
    authors: valuesFor(source, "author"),
    holdIds: valuesFor(source, "hold"),
    hideSent: valuesFor(source, "sent")[0] === "hide",
    showOutdated: valuesFor(source, "outdated")[0] === "show",
    minStars: readStars(valuesFor(source, "stars")),
    rockoApprovedOnly: valuesFor(source, "rocko")[0] === "approved",
    order: normalizeOrder(valuesFor(source, "order")[0]),
  });
}

export function createClimbFilterSearchParams(filters: ClimbFilters) {
  const normalized = normalizeClimbFilters(filters);
  const searchParams = new URLSearchParams();

  normalized.colors.forEach((color) => searchParams.append("color", color));
  normalized.authors.forEach((author) => searchParams.append("author", author));
  normalized.holdIds.forEach((holdId) => searchParams.append("hold", holdId));
  if (normalized.hideSent) searchParams.set("sent", "hide");
  if (normalized.showOutdated) searchParams.set("outdated", "show");
  if (normalized.minStars !== DEFAULT_CLIMB_FILTERS.minStars) {
    searchParams.set("stars", String(normalized.minStars));
  }
  if (normalized.rockoApprovedOnly) {
    searchParams.set("rocko", "approved");
  }
  if (normalized.order !== DEFAULT_CLIMB_FILTERS.order) {
    searchParams.set("order", normalized.order);
  }

  return searchParams;
}

export function serializeClimbFilters(filters: ClimbFilters) {
  return createClimbFilterSearchParams(filters).toString();
}

export function buildFilteredHref(
  pathname: string,
  filters: ClimbFilters,
  additionalParams: Record<string, string | undefined> = {},
) {
  const searchParams = createClimbFilterSearchParams(filters);
  Object.entries(additionalParams).forEach(([key, value]) => {
    if (value !== undefined) searchParams.set(key, value);
  });
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function activeClimbFilterCount(filters: ClimbFilters) {
  const normalized = normalizeClimbFilters(filters);
  return (
    Number(normalized.colors.length > 0) +
    Number(normalized.authors.length > 0) +
    Number(normalized.holdIds.length > 0) +
    Number(normalized.hideSent) +
    Number(normalized.showOutdated) +
    Number(normalized.minStars > MIN_FILTER_STARS) +
    Number(normalized.rockoApprovedOnly) +
    Number(normalized.order !== DEFAULT_CLIMB_FILTERS.order)
  );
}

export function hasActiveClimbFilters(filters: ClimbFilters) {
  return activeClimbFilterCount(filters) > 0;
}

export function hasClimbFilterConstraints(filters: ClimbFilters) {
  const normalized = normalizeClimbFilters(filters);
  return (
    normalized.colors.length > 0 ||
    normalized.authors.length > 0 ||
    normalized.holdIds.length > 0 ||
    normalized.hideSent ||
    normalized.minStars > MIN_FILTER_STARS ||
    normalized.rockoApprovedOnly
  );
}

export function requiresClimbActivity(filters: ClimbFilters) {
  const normalized = normalizeClimbFilters(filters);
  return (
    normalized.hideSent ||
    normalized.minStars > MIN_FILTER_STARS ||
    normalized.order === "ascents"
  );
}

function gradeNumber(grade: string) {
  const match = /^V(\d|1[0-7])$/.exec(grade);
  return match ? Number(match[1]) : null;
}

export function matchesClimbFilters(
  climb: FilterableClimb,
  filters: ClimbFilters,
) {
  const normalized = normalizeClimbFilters(filters);
  if (!normalized.showOutdated && climb.outdated === true) {
    return false;
  }

  const grade = gradeNumber(climb.grade);
  if (
    grade === null ||
    (normalized.colors.length > 0 &&
      !normalized.colors.includes(getGradeBand(climb.grade)))
  ) {
    return false;
  }

  if (
    normalized.authors.length > 0 &&
    !normalized.authors.some(
      (author) => authorKey(author) === authorKey(climb.setter),
    )
  ) {
    return false;
  }

  if (normalized.holdIds.length > 0) {
    const climbHoldIds = new Set(
      climb.holds.flatMap((hold) =>
        typeof hold.holdId === "string" ? [hold.holdId] : [],
      ),
    );
    if (!normalized.holdIds.every((holdId) => climbHoldIds.has(holdId))) {
      return false;
    }
  }

  if (normalized.rockoApprovedOnly && climb.rockoApproved !== true) {
    return false;
  }

  return true;
}

export function matchesClimbActivityFilters(
  activity: FilterableClimbActivity | null,
  filters: ClimbFilters,
) {
  const normalized = normalizeClimbFilters(filters);
  if (normalized.hideSent && activity?.userRating !== null && activity?.userRating !== undefined) {
    return false;
  }
  if (
    normalized.minStars > MIN_FILTER_STARS &&
    (!activity || activity.averageRating < normalized.minStars)
  ) {
    return false;
  }
  return true;
}

export function compareClimbsByOrder(
  left: OrderableClimb,
  right: OrderableClimb,
  filters: ClimbFilters,
) {
  const normalized = normalizeClimbFilters(filters);
  if (normalized.order === "ascents") {
    const ascentDifference =
      (right.activity?.ratingCount ?? 0) -
      (left.activity?.ratingCount ?? 0);
    if (ascentDifference !== 0) return ascentDifference;
  }

  if (normalized.order === "grade") {
    const leftGrade = gradeNumber(left.grade);
    const rightGrade = gradeNumber(right.grade);
    if (leftGrade === null && rightGrade !== null) return 1;
    if (leftGrade !== null && rightGrade === null) return -1;
    if (leftGrade !== null && rightGrade !== null) {
      const colorDifference =
        FILTER_GRADE_COLORS.indexOf(getGradeBand(left.grade)) -
        FILTER_GRADE_COLORS.indexOf(getGradeBand(right.grade));
      if (colorDifference !== 0) return colorDifference;
    }
  }

  const dateDifference = right.createdAt - left.createdAt;
  return dateDifference || left.id.localeCompare(right.id);
}

export function selectVisibleClimbs<
  T extends FilterableClimb & OrderableClimb,
>(climbs: readonly T[], filters: ClimbFilters): T[] {
  return climbs
    .filter(
      (climb) =>
        matchesClimbFilters(climb, filters) &&
        matchesClimbActivityFilters(climb.activity, filters),
    )
    .sort((left, right) => compareClimbsByOrder(left, right, filters));
}

export function adjacentClimbIds<
  T extends FilterableClimb & OrderableClimb,
>(
  climbs: readonly T[],
  currentId: string,
  filters: ClimbFilters,
): AdjacentClimbIds {
  const visible = selectVisibleClimbs(climbs, filters);
  const currentIndex = visible.findIndex((climb) => climb.id === currentId);
  if (currentIndex < 0) return { previousId: null, nextId: null };

  return {
    previousId: visible[currentIndex - 1]?.id ?? null,
    nextId: visible[currentIndex + 1]?.id ?? null,
  };
}

export function filterClimbs<T extends FilterableClimb>(
  climbs: readonly T[],
  filters: ClimbFilters,
) {
  return climbs.filter((climb) => matchesClimbFilters(climb, filters));
}

export function uniqueFilterAuthors(values: readonly string[]) {
  const authorsByKey = new Map<
    string,
    { author: string; climbCount: number }
  >();

  values.forEach((value) => {
    const author = normalizeAuthor(value);
    if (!author) return;

    const key = authorKey(author);
    const existing = authorsByKey.get(key);
    if (existing) {
      existing.climbCount += 1;
      return;
    }

    authorsByKey.set(key, { author, climbCount: 1 });
  });

  return [...authorsByKey.values()]
    .sort(
      (left, right) =>
        right.climbCount - left.climbCount ||
        left.author.localeCompare(right.author, undefined, {
          sensitivity: "base",
        }),
    )
    .map(({ author }) => author);
}
