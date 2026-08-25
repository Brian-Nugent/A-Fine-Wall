import SavedClimbDetail from "./saved-climb-detail";
import {
  buildFilteredHref,
  parseClimbFilters,
  type FilterSearchParams,
} from "../climb-filters";
import { loadSavedClimbForPage } from "./server-climb";

export default async function SavedClimbPage({
  searchParams,
}: {
  searchParams: Promise<FilterSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const id = resolvedSearchParams.id;
  const filters = parseClimbFilters(resolvedSearchParams);
  const climbId = typeof id === "string" ? id : "";
  const initialClimb = await loadSavedClimbForPage(climbId);
  return (
    <SavedClimbDetail
      backHref={buildFilteredHref(
        "/climbs",
        filters,
      )}
      climbId={climbId}
      filters={filters}
      initialClimb={initialClimb}
      key={climbId}
    />
  );
}
