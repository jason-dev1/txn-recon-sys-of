export default function App() {
  return (
    <main className="page">
      <section className="setup-card" aria-labelledby="page-title">
        <div className="eyebrow">Transaction Reconciliation</div>
        <h1 id="page-title">Project setup is ready</h1>
        <p>
          The React client, TypeScript API, and SQLite connection are in place.
          Reconciliation features can be added here next.
        </p>
        <a href="http://localhost:3000/health">Check API health</a>
      </section>
    </main>
  );
}
