"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Coffee, FileAudio, FileText, LogOut, Menu, Plus, Settings2, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Drawer } from "@/components/ui/drawer";
import { getEmailInitials } from "@/components/workspace/utils";
import { signOutAction } from "@/lib/auth/actions";
import {
  documentationNavigationItem,
  primaryNavigationItems,
  utilityNavigationItems,
  VOSIO_SUPPORT_URL,
  type NavigationHrefOverrides,
  type NavigationItem,
  type WorkspaceNavigationHref,
  type WorkspaceView
} from "@/lib/workspace-data";

const mobileNavigationItems: NavigationItem[] = [
  { href: "/recordings", label: "Nahrávky", icon: FileAudio, view: "recordings" },
  { href: "/recordings/new", label: "Nová", icon: Plus, view: "recordings" },
  { href: "/templates", label: "AI prompty", icon: FileText, view: "templates" },
  { href: "/settings", label: "Nastavení", icon: Settings2, view: "settings" }
];

// resolveNavigationHref swaps only explicitly supplied fixture destinations while production keeps canonical routes.
function resolveNavigationHref(href: WorkspaceNavigationHref, overrides?: NavigationHrefOverrides) {
  return overrides?.[href] ?? href;
}

// NewRecordingNavigationLink gives the desktop create route the same active and pending feedback as navigation rows.
export function NewRecordingNavigationLink({
  compact = false,
  hrefOverrides
}: {
  compact?: boolean;
  hrefOverrides?: NavigationHrefOverrides;
}) {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setPending(false);
  }, [pathname]);

  return (
    <Link
      aria-label={compact ? "Nová nahrávka" : undefined}
      aria-current={pathname === "/recordings/new" ? "page" : undefined}
      className={[
        "new-recording-button",
        pathname === "/recordings/new" ? "new-recording-button-active" : "",
        pending ? "new-recording-button-pending" : ""
      ].filter(Boolean).join(" ")}
      href={resolveNavigationHref("/recordings/new", hrefOverrides)}
      onClick={(event) => {
        if (event.defaultPrevented) return;
        setPending(true);
      }}
      title={compact ? "Nová nahrávka" : undefined}
    >
      <Plus size={16} />
      <span className="navigation-label">Nová nahrávka</span>
    </Link>
  );
}

// isNavigationItemActive resolves route-aware selection while keeping recording details in the recordings section.
export function isNavigationItemActive(
  item: NavigationItem,
  activeView: WorkspaceView,
  pathname: string
) {
  if (item.href === "/recordings/new") return pathname === item.href;
  if (item.href === "/recordings") {
    return activeView === "recordings" && pathname !== "/recordings/new";
  }
  return item.view === activeView;
}

// WorkspaceNavigation renders only the primary desktop destinations with route pending feedback.
export function WorkspaceNavigation({
  activeView,
  compact = false,
  hrefOverrides
}: {
  activeView: WorkspaceView;
  compact?: boolean;
  hrefOverrides?: NavigationHrefOverrides;
}) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<WorkspaceNavigationHref | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  return (
    <nav className="nav-list" aria-label="Hlavní sekce">
      {primaryNavigationItems.map((item) => {
        const isActive = isNavigationItemActive(item, activeView, pathname);
        const isPending = pendingHref === item.href;
        const className = [
          "nav-item",
          isActive ? "nav-item-active" : "",
          isPending ? "nav-item-pending" : ""
        ].filter(Boolean).join(" ");

        return (
          <Link
            aria-label={compact ? item.label : undefined}
            aria-current={isActive ? "page" : undefined}
            className={className}
            href={resolveNavigationHref(item.href, hrefOverrides)}
            key={item.label}
            onClick={(event) => {
              if (event.defaultPrevented) return;
              setPendingHref(item.href);
            }}
            title={compact ? item.label : undefined}
          >
            <item.icon size={16} />
            <span className="navigation-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// SidebarUtilityNavigation groups secondary desktop destinations above support and account controls.
export function SidebarUtilityNavigation({
  activeView,
  compact = false,
  hrefOverrides
}: {
  activeView: WorkspaceView;
  compact?: boolean;
  hrefOverrides?: NavigationHrefOverrides;
}) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<WorkspaceNavigationHref | null>(null);
  const items = [...utilityNavigationItems, documentationNavigationItem];

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  return (
    <nav className="sidebar-utility-nav" aria-label="Nástroje workspace">
      {items.map((item) => {
        const isActive = isNavigationItemActive(item, activeView, pathname);
        const isPending = pendingHref === item.href;

        return (
          <Link
            aria-label={compact ? item.label : undefined}
            aria-current={isActive ? "page" : undefined}
            className={[
              "nav-item",
              isActive ? "nav-item-active" : "",
              isPending ? "nav-item-pending" : ""
            ].filter(Boolean).join(" ")}
            href={resolveNavigationHref(item.href, hrefOverrides)}
            key={item.label}
            onClick={(event) => {
              if (event.defaultPrevented) return;
              setPendingHref(item.href);
            }}
            title={compact ? item.label : undefined}
          >
            <item.icon size={16} />
            <span className="navigation-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// MobileAccount exposes the authenticated identity and existing sign-out server action inside More.
function MobileAccount({ userEmail }: { userEmail: string }) {
  return (
    <section className="mobile-more-account">
      <div className="avatar">{getEmailInitials(userEmail)}</div>
      <div>
        <strong>Vosio účet</strong>
        <span>{userEmail}</span>
      </div>
      <form action={signOutAction} className="mobile-more-sign-out" data-navigation-guard="true">
        <button type="submit">
          <LogOut size={16} />
          Odhlásit
        </button>
      </form>
    </section>
  );
}

// MobileMoreDrawer makes non-primary destinations and utilities reachable without widening bottom navigation.
function MobileMoreDrawer({
  activeView,
  hrefOverrides,
  onClose,
  open,
  setPendingHref,
  userEmail
}: {
  activeView: WorkspaceView;
  hrefOverrides?: NavigationHrefOverrides;
  onClose: () => void;
  open: boolean;
  setPendingHref: (href: WorkspaceNavigationHref) => void;
  userEmail: string;
}) {
  const pathname = usePathname();
  const drawerItems = [utilityNavigationItems[0], documentationNavigationItem];

  return (
    <Drawer className="mobile-more-drawer" label="Další možnosti" onClose={onClose} open={open}>
      <header className="mobile-more-header">
        <div>
          <strong>Další možnosti</strong>
          <span>Workspace a účet</span>
        </div>
        <button aria-label="Zavřít další možnosti" className="mobile-more-close" onClick={onClose} type="button">
          <X size={18} />
        </button>
      </header>

      <nav className="mobile-more-links" aria-label="Další sekce">
        {drawerItems.map((item) => {
          const isActive = isNavigationItemActive(item, activeView, pathname);

          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={isActive ? "mobile-more-link mobile-more-link-active" : "mobile-more-link"}
              href={resolveNavigationHref(item.href, hrefOverrides)}
              key={item.label}
              onClick={(event) => {
                if (event.defaultPrevented) return;
                setPendingHref(item.href);
                onClose();
              }}
            >
              <item.icon size={18} />
              {item.label}
            </Link>
          );
        })}
        <a
          className="mobile-more-link mobile-more-support"
          href={VOSIO_SUPPORT_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Coffee size={18} />
          Kup mi kafe
        </a>
      </nav>

      <div className="mobile-more-theme">
        <span>Motiv aplikace</span>
        <ThemeToggle compact />
      </div>
      <MobileAccount userEmail={userEmail} />
    </Drawer>
  );
}

// MobileNav renders four direct routes and an accessible More drawer at the mobile shell breakpoint.
export function MobileNav({
  activeView,
  hrefOverrides,
  userEmail = ""
}: {
  activeView: WorkspaceView;
  hrefOverrides?: NavigationHrefOverrides;
  userEmail?: string;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<WorkspaceNavigationHref | null>(null);
  const moreIsActive = activeView === "trash" || activeView === "documentation";
  const moreIsPending = pendingHref === "/trash" || pendingHref === "/documentation";

  useEffect(() => {
    setPendingHref(null);
    setMoreOpen(false);
  }, [pathname]);

  return (
    <>
      <nav className="mobile-nav" aria-label="Mobilní navigace">
        {mobileNavigationItems.map((item) => {
          const isActive = isNavigationItemActive(item, activeView, pathname);
          const isPending = pendingHref === item.href;

          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={[
                "mobile-nav-item",
                item.href === "/recordings/new" ? "mobile-nav-create" : "",
                isActive ? "mobile-nav-item-active" : "",
                isPending ? "mobile-nav-item-pending" : ""
              ].filter(Boolean).join(" ")}
              href={resolveNavigationHref(item.href, hrefOverrides)}
              key={item.href}
              onClick={(event) => {
                if (event.defaultPrevented) return;
                setPendingHref(item.href);
              }}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          aria-expanded={moreOpen}
          aria-pressed={moreIsActive}
          className={[
            "mobile-nav-item",
            moreIsActive ? "mobile-nav-item-active" : "",
            moreIsPending ? "mobile-nav-item-pending" : ""
          ].filter(Boolean).join(" ")}
          onClick={() => setMoreOpen(true)}
          type="button"
        >
          <Menu size={18} />
          <span>Více</span>
        </button>
      </nav>

      <MobileMoreDrawer
        activeView={activeView}
        hrefOverrides={hrefOverrides}
        onClose={() => setMoreOpen(false)}
        open={moreOpen}
        setPendingHref={setPendingHref}
        userEmail={userEmail}
      />
    </>
  );
}
