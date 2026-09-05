import Link from "next/link";

// NotFound renders a safe Czech recovery surface without echoing the requested URL.
export default function NotFound() {
  return (
    <main className="not-found-page" data-utility-surface="not-found">
      <section className="not-found-card" aria-labelledby="not-found-title">
        <span>404</span>
        <h1 id="not-found-title">Stránka nebyla nalezena</h1>
        <p>Odkaz už nemusí být platný, nebo k této stránce nemáte přístup.</p>
        <div>
          <Link href="/recordings">Nahrávky</Link>
          <Link className="not-found-primary" href="/recordings/new">Nová nahrávka</Link>
        </div>
      </section>
    </main>
  );
}
