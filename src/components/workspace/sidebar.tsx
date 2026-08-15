"use client";

import { useEffect, useState } from "react";
import { Coffee, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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

const SIDEBAR_STORAGE_KEY = "vosio-sidebar-collapsed";

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
  const [collapsed, setCollapsed] = useState(false);

  // Restore a non-sensitive display preference after hydration.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
  }, []);

  // toggleCollapsed persists only the visual rail preference.
  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }

  const toggleLabel = collapsed ? "Rozbalit postranní lištu" : "Sbalit postranní lištu";

  return (
    <aside className="sidebar" aria-label="Hlavní navigace" data-collapsed={collapsed}>
      <BrandBlock />
      <button
        aria-expanded={!collapsed}
        aria-label={toggleLabel}
        className="sidebar-collapse-button"
        onClick={toggleCollapsed}
        title={toggleLabel}
        type="button"
      >
        {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
      </button>
      <NewRecordingNavigationLink compact={collapsed} hrefOverrides={navigationHrefOverrides} />
      <WorkspaceNavigation
        activeView={activeView}
        compact={collapsed}
        hrefOverrides={navigationHrefOverrides}
      />
      <SidebarUtilityNavigation
        activeView={activeView}
        compact={collapsed}
        hrefOverrides={navigationHrefOverrides}
      />
      <SupportLink compact={collapsed} />
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
function SupportLink({ compact }: { compact: boolean }) {
  return (
    <a
      aria-label={compact ? "Kup mi kafe" : undefined}
      className="sidebar-support-link"
      href={VOSIO_SUPPORT_URL}
      rel="noopener noreferrer"
      target="_blank"
      title={compact ? "Kup mi kafe" : undefined}
    >
      <Coffee size={16} />
      <span className="navigation-label">Kup mi kafe</span>
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
