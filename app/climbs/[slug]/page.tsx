import { notFound } from "next/navigation";
import {
  buildFilteredHref,
  parseClimbFilters,
  type FilterSearchParams,
} from "../climb-filters";
import ClimbActivityPanel from "../climb-activity-panel";
import { climbs, getClimb } from "../data";
import WallPhoto from "../wall-photo";

export function generateStaticParams() {
  return climbs.map((climb) => ({ slug: climb.slug }));
}

export default async function ClimbPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<FilterSearchParams>;
}) {
  const [{ slug }, rawFilters] = await Promise.all([params, searchParams]);
  const climb = getClimb(slug);

  if (!climb) notFound();

  const startCount = climb.holds.filter((hold) => hold.role === "start").length;
  const handCount = climb.holds.filter((hold) => hold.role === "hand").length;
  const footCount = climb.holds.filter((hold) => hold.role === "foot").length;
  const finishCount = climb.holds.filter((hold) => hold.role === "finish").length;
  const filters = parseClimbFilters(rawFilters);

  return (
    <main className="app-page detail-page">
      <header className="detail-header">
        <a
          className="back-link"
          href={buildFilteredHref(
            "/climbs",
            filters,
          )}
        >
          <span aria-hidden="true">&larr;</span>
          Climbs
        </a>
      </header>

      <section aria-labelledby="climb-name">
        <div className="detail-title">
          <div>
            <h1 id="climb-name">{climb.name}</h1>
            <p>Set by {climb.setter}</p>
          </div>
          <strong>{climb.grade}</strong>
        </div>

        <figure className="wall-map wall-map--route">
          <WallPhoto
            className="wall-photo"
            alt="Climbing wall with the route holds marked"
            width={1086}
            height={1448}
          />
          {climb.holds.map((hold, index) => (
            <span
              aria-hidden="true"
              className={`hold-marker hold-marker--${hold.role}`}
              key={`${hold.x}-${hold.y}-${index}`}
              style={{
                left: `${hold.x}%`,
                top: `${hold.y}%`,
                width: `${hold.size}%`,
              }}
            />
          ))}
          <figcaption className="sr-only">
            {climb.name} uses {startCount} green-circled start {startCount === 1 ? "hold" : "holds"}, {handCount} blue-circled climbing {handCount === 1 ? "hold" : "holds"}, {footCount} yellow-circled {footCount === 1 ? "foothold" : "footholds"}, and {finishCount} red-circled finish {finishCount === 1 ? "hold" : "holds"}.
          </figcaption>
        </figure>

        <ClimbActivityPanel
          filters={filters}
          reference={{ climbKind: "demo", climbId: climb.slug }}
        />
      </section>
    </main>
  );
}
