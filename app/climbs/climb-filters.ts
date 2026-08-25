export const MIN_FILTER_GRADE = 0;
export const MAX_FILTER_GRADE = 17;
export const MAX_FILTER_HOLDS = 200;

const holdIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export type ClimbFilters = {
  minGrade: number;
  maxGrade: number;
  authors: string[];
  holdIds: string[];
};

export type FilterSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type FilterableClimb = {
  grade: string;
  setter: string;
  holds: readonly { holdId?: string | null }[];
};

export const DEFAULT_CLIMB_FILTERS: Readonly<ClimbFilters> = {
  minGrade: MIN_FILTER_GRADE,
  maxGrade: MAX_FILTER_GRADE,
  authors: [],
  holdIds: [],
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

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
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

export function normalizeClimbFilters(filters: ClimbFilters): ClimbFilters {
  const firstGrade = normalizeGrade(
    filters.minGrade,
    DEFAULT_CLIMB_FILTERS.minGrade,
  );
  const secondGrade = normalizeGrade(
    filters.maxGrade,
    DEFAULT_CLIMB_FILTERS.maxGrade,
  );
  const authors = uniqueSorted(
    filters.authors.flatMap((value) => {
      const author = normalizeAuthor(value);
      return author ? [author] : [];
    }),
  ).slice(0, 200);
  const holdIds = uniqueSorted(
    filters.holdIds.filter((value) => holdIdPattern.test(value)),
  ).slice(0, MAX_FILTER_HOLDS);

  return {
    minGrade: Math.min(firstGrade, secondGrade),
    maxGrade: Math.max(firstGrade, secondGrade),
    authors,
    holdIds,
  };
}

export function parseClimbFilters(
  source: URLSearchParams | FilterSearchParams,
): ClimbFilters {
  return normalizeClimbFilters({
    minGrade: readGrade(
      valuesFor(source, "min"),
      DEFAULT_CLIMB_FILTERS.minGrade,
    ),
    maxGrade: readGrade(
      valuesFor(source, "max"),
      DEFAULT_CLIMB_FILTERS.maxGrade,
    ),
    authors: valuesFor(source, "author"),
    holdIds: valuesFor(source, "hold"),
  });
}

export function createClimbFilterSearchParams(filters: ClimbFilters) {
  const normalized = normalizeClimbFilters(filters);
  const searchParams = new URLSearchParams();

  if (normalized.minGrade !== DEFAULT_CLIMB_FILTERS.minGrade) {
    searchParams.set("min", String(normalized.minGrade));
  }
  if (normalized.maxGrade !== DEFAULT_CLIMB_FILTERS.maxGrade) {
    searchParams.set("max", String(normalized.maxGrade));
  }
  normalized.authors.forEach((author) => searchParams.append("author", author));
  normalized.holdIds.forEach((holdId) => searchParams.append("hold", holdId));

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
    Number(
      normalized.minGrade !== DEFAULT_CLIMB_FILTERS.minGrade ||
        normalized.maxGrade !== DEFAULT_CLIMB_FILTERS.maxGrade,
    ) +
    Number(normalized.authors.length > 0) +
    Number(normalized.holdIds.length > 0)
  );
}

export function hasActiveClimbFilters(filters: ClimbFilters) {
  return activeClimbFilterCount(filters) > 0;
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
  const grade = gradeNumber(climb.grade);
  if (
    grade === null ||
    grade < normalized.minGrade ||
    grade > normalized.maxGrade
  ) {
    return false;
  }

  if (
    normalized.authors.length > 0 &&
    !normalized.authors.includes(climb.setter)
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

  return true;
}

export function filterClimbs<T extends FilterableClimb>(
  climbs: readonly T[],
  filters: ClimbFilters,
) {
  return climbs.filter((climb) => matchesClimbFilters(climb, filters));
}

export function uniqueFilterAuthors(values: readonly string[]) {
  return uniqueSorted(
    values.flatMap((value) => {
      const author = normalizeAuthor(value);
      return author ? [author] : [];
    }),
  );
}
