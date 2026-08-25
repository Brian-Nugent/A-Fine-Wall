export type ClimbListState =
  | "loading"
  | "ready"
  | "empty"
  | "filtered-empty";

export function getClimbListState({
  hasActiveFilters,
  isLoading,
  totalClimbs,
  visibleClimbs,
}: {
  hasActiveFilters: boolean;
  isLoading: boolean;
  totalClimbs: number;
  visibleClimbs: number;
}): ClimbListState {
  if (isLoading) return "loading";
  if (totalClimbs === 0 && !hasActiveFilters) return "empty";
  if (visibleClimbs === 0) return "filtered-empty";
  return "ready";
}
