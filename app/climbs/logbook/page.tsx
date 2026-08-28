import { notFound } from "next/navigation";
import {
  isClimbReference,
  type ClimbReference,
} from "../climb-activity";
import { ClimbLogbook } from "../climb-activity-panel";
import {
  buildFilteredHref,
  parseClimbFilters,
  type FilterSearchParams,
} from "../climb-filters";
import { getClimb } from "../data";
import { loadSavedClimbForPage } from "../saved/server-climb";

export default async function ClimbLogbookPage({
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
  const climb =
    typedReference.climbKind === "demo"
      ? getClimb(typedReference.climbId)
      : await loadSavedClimbForPage(typedReference.climbId);
  if (typedReference.climbKind === "demo" && !climb) notFound();

  const backHref =
    typedReference.climbKind === "demo"
      ? buildFilteredHref(`/climbs/${typedReference.climbId}`, filters)
      : buildFilteredHref("/climbs/saved", filters, {
          id: typedReference.climbId,
        });

  return (
    <main className="app-page logbook-page">
      <header className="detail-header">
        <a className="back-link" href={backHref}>
          <span aria-hidden="true">&larr;</span>
          Climb
        </a>
        <span>Logbook</span>
      </header>

      <section className="logbook-content" aria-labelledby="logbook-title">
        <div className="logbook-intro">
          <h1 id="logbook-title">Logbook</h1>
          <p>{climb?.name ?? "Climb sends and ratings"}</p>
        </div>
        <ClimbLogbook reference={typedReference} />
      </section>
    </main>
  );
}
