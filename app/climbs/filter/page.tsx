import {
  parseClimbFilters,
  type FilterSearchParams,
} from "../climb-filters";
import FilterOptionsClient from "./filter-options-client";

export default async function FilterPage({
  searchParams,
}: {
  searchParams: Promise<FilterSearchParams>;
}) {
  return (
    <FilterOptionsClient
      initialFilters={parseClimbFilters(await searchParams)}
    />
  );
}
