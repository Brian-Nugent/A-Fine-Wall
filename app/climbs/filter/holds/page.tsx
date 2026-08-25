import {
  parseClimbFilters,
  type FilterSearchParams,
} from "../../climb-filters";
import HoldFilterClient from "./hold-filter-client";

export default async function HoldFilterPage({
  searchParams,
}: {
  searchParams: Promise<FilterSearchParams>;
}) {
  return (
    <HoldFilterClient
      initialFilters={parseClimbFilters(await searchParams)}
    />
  );
}
