export const MAX_CLIMB_DESCRIPTION_LENGTH = 2000;

export function isClimbDescription(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_CLIMB_DESCRIPTION_LENGTH;
}
