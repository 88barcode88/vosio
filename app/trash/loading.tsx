import { WorkspaceLoading } from "@/components/workspace/loading";
// TrashLoading renders a compact skeleton while deleted recordings load.
export default function TrashLoading() {
  return (
    <WorkspaceLoading view="trash"><div className="utility-route-state" data-utility-route-state="loading" aria-busy="true" aria-label="Načítám Koš">
      <div className="utility-loading-lines" aria-hidden="true"><span /><span /><span /></div>
      <p>Načítám Koš…</p>
    </div></WorkspaceLoading>
  );
}
