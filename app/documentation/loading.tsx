import { WorkspaceLoading } from "@/components/workspace/loading";
// DocumentationLoading renders a calm document skeleton during route loading.
export default function DocumentationLoading() {
  return (
    <WorkspaceLoading view="documentation"><div className="utility-route-state" data-utility-route-state="loading" aria-busy="true" aria-label="Načítám dokumentaci">
      <div className="utility-loading-lines" aria-hidden="true"><span /><span /><span /></div>
      <p>Načítám dokumentaci…</p>
    </div></WorkspaceLoading>
  );
}
