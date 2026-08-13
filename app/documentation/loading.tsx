// DocumentationLoading renders a calm document skeleton during route loading.
export default function DocumentationLoading() {
  return (
    <main className="utility-route-state" aria-busy="true" aria-label="Načítám dokumentaci">
      <div className="utility-loading-lines" aria-hidden="true"><span /><span /><span /></div>
      <p>Načítám dokumentaci…</p>
    </main>
  );
}
