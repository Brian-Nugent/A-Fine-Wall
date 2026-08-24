import Link from "next/link";
import { climbs } from "./data";

export default function ClimbsPage() {
  return (
    <main className="app-page">
      <header className="list-header">
        <Link className="small-brand" href="/">
          A Fine Wall
        </Link>
        <p>{climbs.length} climbs</p>
      </header>

      <section aria-labelledby="climbs-heading">
        <div className="section-heading">
          <h1 id="climbs-heading">Climbs</h1>
          <p>Newest first</p>
        </div>

        <ul className="climb-list">
          {climbs.map((climb) => (
            <li key={climb.slug}>
              <Link className="climb-row" href={`/climbs/${climb.slug}`}>
                <span className="climb-row-copy">
                  <strong>{climb.name}</strong>
                  <span>Set by {climb.setter}</span>
                </span>
                <span className="climb-row-meta">
                  <strong>{climb.grade}</strong>
                  <span aria-hidden="true">&rarr;</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
