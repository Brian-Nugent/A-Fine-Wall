import Link from "next/link";

export default function Home() {
  return (
    <main className="home-page">
      <h1>A Fine Wall</h1>
      <Link className="primary-button" href="/climbs">
        View Climbs
      </Link>
    </main>
  );
}
