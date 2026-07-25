import { Coffee, LogOut, Plus } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarDocumentationLink, WorkspaceNavigation } from "@/components/workspace-navigation";
import { signOutAction } from "@/lib/auth/actions";
import type { WorkspaceView } from "@/lib/workspace-data";
import { getEmailInitials } from "@/components/workspace/utils";

const SUPPORT_LINK = "https://donate.stripe.com/3cI7sLdRHaWJ1Lke48dZ602";

// WorkspaceSidebar renders the fixed desktop navigation shell.
export function WorkspaceSidebar({
  activeView,
  userEmail
}: {
  activeView: WorkspaceView;
  userEmail: string;
}) {
  return (
    <aside className="sidebar" aria-label="Hlavní navigace">
      <BrandBlock />
      <Link className="new-recording-button" href="/recordings/new">
        <Plus size={15} />
        Nová nahrávka
      </Link>
      <WorkspaceNavigation activeView={activeView} />
      <SidebarDocumentationLink activeView={activeView} />
      <SupportLink />
      <UserCard userEmail={userEmail} />
    </aside>
  );
}

// BrandBlock renders the compact Vosio mark and product name in the sidebar.
function BrandBlock() {
  return (
    <div className="brand-block">
      <div>
        <LogoMark className="brand-logo" size={34} />
        <strong>Vosio</strong>
      </div>
      <ThemeToggle compact />
    </div>
  );
}

// SupportLink opens the built-in Stripe Donate page used for voluntary support.
function SupportLink() {
  return (
    <a className="sidebar-support-link" href={SUPPORT_LINK} rel="noopener noreferrer" target="_blank">
      <Coffee size={16} />
      <span>Kup mi kafe</span>
    </a>
  );
}

// UserCard displays the active authenticated Supabase user context.
function UserCard({ userEmail }: { userEmail: string }) {
  return (
    <section className="user-card">
      <div className="avatar">{getEmailInitials(userEmail)}</div>
      <div>
        <strong>Vosio účet</strong>
        <span>{userEmail}</span>
      </div>
      <form action={signOutAction} className="sign-out-form" data-navigation-guard="true">
        <button type="submit" aria-label="Odhlásit">
          <LogOut size={16} />
        </button>
      </form>
    </section>
  );
}
