import { Coffee, LogOut } from "lucide-react";
import { LogoMark } from "@/components/logo-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  NewRecordingNavigationLink,
  SidebarUtilityNavigation,
  WorkspaceNavigation
} from "@/components/workspace-navigation";
import { signOutAction } from "@/lib/auth/actions";
import {
  VOSIO_SUPPORT_URL,
  type NavigationHrefOverrides,
  type WorkspaceView
} from "@/lib/workspace-data";
import { getEmailInitials } from "@/components/workspace/utils";

// WorkspaceSidebar renders the fixed desktop navigation shell.
export function WorkspaceSidebar({
  activeView,
  navigationHrefOverrides,
  userEmail
}: {
  activeView: WorkspaceView;
  navigationHrefOverrides?: NavigationHrefOverrides;
  userEmail: string;
}) {
  return (
    <aside className="sidebar" aria-label="Hlavní navigace">
      <BrandBlock />
      <NewRecordingNavigationLink hrefOverrides={navigationHrefOverrides} />
      <WorkspaceNavigation activeView={activeView} hrefOverrides={navigationHrefOverrides} />
      <SidebarUtilityNavigation activeView={activeView} hrefOverrides={navigationHrefOverrides} />
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
    <a className="sidebar-support-link" href={VOSIO_SUPPORT_URL} rel="noopener noreferrer" target="_blank">
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
