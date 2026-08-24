import Image from "next/image";
import { notFound } from "next/navigation";
import { climbs, getClimb } from "../data";

export function generateStaticParams() {
  return climbs.map((climb) => ({ slug: climb.slug }));
}

export default async function ClimbPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const climb = getClimb(slug);

  if (!climb) notFound();

  const startCount = climb.holds.filter((hold) => hold.role === "start").length;
  const handCount = climb.holds.filter((hold) => hold.role === "hand").length;
  const finishCount = climb.holds.filter((hold) => hold.role === "finish").length;

  return (
    <main className="app-page detail-page">
      <header className="detail-header">
        <a className="back-link" href="/climbs">
          <span aria-hidden="true">&larr;</span>
          Climbs
        </a>
        <span>{climb.grade}</span>
      </header>

      <section aria-labelledby="climb-name">
        <div className="detail-title">
          <div>
            <h1 id="climb-name">{climb.name}</h1>
            <p>Set by {climb.setter}</p>
          </div>
          <strong>{climb.grade}</strong>
        </div>

        <figure className="wall-map">
          <Image
            className="wall-photo"
            src="/wall-prototype.png"
            alt="A plywood home climbing wall covered with colorful holds"
            width={1086}
            height={1448}
            sizes="(min-width: 45rem) 39.5rem, 100vw"
            priority
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
            {climb.name} uses {startCount} green-circled start {startCount === 1 ? "hold" : "holds"}, {handCount} blue-circled climbing {handCount === 1 ? "hold" : "holds"}, and {finishCount} red-circled finish {finishCount === 1 ? "hold" : "holds"}.
          </figcaption>
        </figure>

        <div className="hold-legend" aria-label="Hold marker legend">
          <span><i className="legend-dot legend-dot--start" />Start</span>
          <span><i className="legend-dot legend-dot--hand" />Climb</span>
          <span><i className="legend-dot legend-dot--finish" />Finish</span>
        </div>
      </section>
    </main>
  );
}
