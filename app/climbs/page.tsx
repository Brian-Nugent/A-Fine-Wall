import { climbs } from "./data";

export default function ClimbsPage() {
  return (
    <main className="app-page">
      <header className="list-header">
        <a className="small-brand" href="/">
          A Fine Wall
        </a>
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
              <a className="climb-row" href={`/climbs/${climb.slug}`}>
                <span className="climb-row-copy">
                  <strong>{climb.name}</strong>
                  <span>Set by {climb.setter}</span>
                </span>
                <span className="climb-row-meta">
                  <strong>{climb.grade}</strong>
                  <span aria-hidden="true">&rarr;</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
