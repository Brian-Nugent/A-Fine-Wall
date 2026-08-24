export default function Home() {
  return (
    <main className="site-shell">
      <div className="light-wash" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <header className="masthead">
        <div className="wordmark" aria-label="A Fine Wall">
          <span aria-hidden="true" />
          AFW
        </div>
        <p>Study No. 01 &middot; MMXXVI</p>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <div className="wall-study" aria-hidden="true">
          <div className="slab slab-tall" />
          <div className="slab slab-small" />
          <div className="slab slab-wide" />
          <span className="plumb-line" />
        </div>

        <div className="hero-copy">
          <p className="eyebrow">
            <span aria-hidden="true" />
            A study in permanence
          </p>
          <h1 id="page-title" aria-label="A Fine Wall">
            <span>A</span>
            {" "}
            <em>Fine</em>
            {" "}
            <span>Wall</span>
          </h1>
          <div className="hero-note">
            <p>A quiet place for a strong idea.</p>
            <span aria-hidden="true">45.5017&deg; N</span>
          </div>
        </div>
      </section>

      <footer className="footer">
        <p>Form</p>
        <p>Surface</p>
        <p>Light</p>
        <p className="edition">One of one</p>
      </footer>
    </main>
  );
}
