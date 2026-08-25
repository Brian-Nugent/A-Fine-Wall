import SavedClimbDetail from "./saved-climb-detail";
import {
  buildFilteredHref,
  parseClimbFilters,
  type FilterSearchParams,
} from "../climb-filters";

export default async function SavedClimbPage({
  searchParams,
}: {
  searchParams: Promise<FilterSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const id = resolvedSearchParams.id;
  const filters = parseClimbFilters(resolvedSearchParams);
  return (
    <SavedClimbDetail
      backHref={buildFilteredHref(
        "/climbs",
        filters,
      )}
      climbId={typeof id === "string" ? id : ""}
      filters={filters}
    />
  );
}
