import { WorkspaceLoading } from "@/components/workspace/loading";

// WhatsNewLoading renders a calm skeleton while the release notes route loads.
export default function WhatsNewLoading() {
  return (
    <WorkspaceLoading view="whats-new"><div className="utility-route-state" data-utility-route-state="loading" aria-busy="true" aria-label="Načítám novinky">
      <div className="utility-loading-lines" aria-hidden="true"><span /><span /><span /></div>
      <p>Načítám novinky…</p>
    </div></WorkspaceLoading>
  );
}
