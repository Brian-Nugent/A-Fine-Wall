export const MAX_LIST_NAME_LENGTH = 80;

export type ClimbList = {
  id: string;
  name: string;
  createdAt: number;
  climbIds: string[];
};

export function normalizeListName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= MAX_LIST_NAME_LENGTH ? name : null;
}

export function isClimbList(value: unknown): value is ClimbList {
  if (!value || typeof value !== "object") return false;
  const list = value as Partial<ClimbList>;
  return typeof list.id === "string" && normalizeListName(list.name) === list.name &&
    typeof list.createdAt === "number" && Array.isArray(list.climbIds) &&
    list.climbIds.every(id => typeof id === "string");
}
