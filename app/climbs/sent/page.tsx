import { notFound } from "next/navigation";
import {
  isClimbReference,
  type ClimbReference,
} from "../climb-activity";
import {
  buildFilteredHref,
  parseClimbFilters,
  type FilterSearchParams,
} from "../climb-filters";
import { getClimb } from "../data";
import SentClimbClient from "./sent-climb-client";

export default async function SentClimbPage({
  searchParams,
}: {
  searchParams: Promise<FilterSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const kind = resolvedSearchParams.kind;
  const id = resolvedSearchParams.id;
  const reference = {
    climbKind: typeof kind === "string" ? kind : "",
    climbId: typeof id === "string" ? id : "",
  };
  if (!isClimbReference(reference)) notFound();

  const typedReference = reference as ClimbReference;
  const filters = parseClimbFilters(resolvedSearchParams);
  const demoClimb =
    typedReference.climbKind === "demo"
      ? getClimb(typedReference.climbId)
      : null;
  if (typedReference.climbKind === "demo" && !demoClimb) notFound();

  const backHref =
    typedReference.climbKind === "demo"
      ? buildFilteredHref(
          `/climbs/${typedReference.climbId}`,
          filters,
        )
      : buildFilteredHref("/climbs/saved", filters, {
          id: typedReference.climbId,
        });

  return (
    <SentClimbClient
      backHref={backHref}
      initialClimb={
        demoClimb
          ? { name: demoClimb.name, grade: demoClimb.grade }
          : null
      }
      reference={typedReference}
    />
  );
}
