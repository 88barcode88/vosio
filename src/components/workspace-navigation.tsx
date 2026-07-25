"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import {
  documentationNavigationItem,
  navigationItems,
  type WorkspaceView
} from "@/lib/workspace-data";

// getMobileNavigationLabel keeps bottom navigation readable on narrow screens.
function getMobileNavigationLabel(label: string) {
  const labels: Record<string, string> = {
    Dokumentace: "Dok.",
    Nastavení: "Nast."
  };

  return labels[label] ?? label;
}

// WorkspaceNavigation renders sidebar links with immediate pending feedback on route changes.
export function WorkspaceNavigation({ activeView }: { activeView: WorkspaceView }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  return (
    <nav className="nav-list" aria-label="Hlavní sekce">
      {navigationItems.map((item) => {
        const isPending = pendingHref === item.href;
        const className = [
          "nav-item",
          item.view === activeView ? "nav-item-active" : "",
          isPending ? "nav-item-pending" : ""
        ].filter(Boolean).join(" ");

        return (
          <Link
            aria-current={item.view === activeView ? "page" : undefined}
            className={className}
            href={item.href}
            key={item.label}
            onClick={() => setPendingHref(item.href)}
          >
            <item.icon size={16} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

// SidebarDocumentationLink renders secondary documentation access above the account card.
export function SidebarDocumentationLink({ activeView }: { activeView: WorkspaceView }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const href = documentationNavigationItem.href;
  const isActive = activeView === "documentation";
  const isPending = pendingHref === href;
  const DocumentationIcon = documentationNavigationItem.icon;
  const className = [
    "sidebar-doc-link",
    isActive ? "sidebar-doc-link-active" : "",
    isPending ? "sidebar-doc-link-pending" : ""
  ].filter(Boolean).join(" ");

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={className}
      href={href}
      onClick={() => setPendingHref(href)}
    >
      <DocumentationIcon size={16} />
      <span>{documentationNavigationItem.label}</span>
    </Link>
  );
}

// MobileNav keeps compact primary app navigation available after the desktop sidebar collapses.
export function MobileNav({ activeView }: { activeView: WorkspaceView }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const mobileNavigationItems = [
    ...navigationItems.slice(0, 2),
    documentationNavigationItem,
    ...navigationItems.slice(2)
  ];

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  return (
    <nav className="mobile-nav" aria-label="Mobilní navigace">
      <Link
        className={pendingHref === "/recordings/new" ? "mobile-nav-item mobile-nav-create mobile-nav-item-pending" : "mobile-nav-item mobile-nav-create"}
        href="/recordings/new"
        onClick={() => setPendingHref("/recordings/new")}
      >
        <Plus size={16} />
        <span>Nová</span>
      </Link>
      {mobileNavigationItems.map((item) => {
        const isPending = pendingHref === item.href;
        const className = [
          "mobile-nav-item",
          item.view === activeView ? "mobile-nav-item-active" : "",
          isPending ? "mobile-nav-item-pending" : ""
        ].filter(Boolean).join(" ");

        return (
          <Link
            aria-current={item.view === activeView ? "page" : undefined}
            className={className}
            href={item.href}
            key={item.label}
            onClick={() => setPendingHref(item.href)}
          >
            <item.icon size={16} />
            <span>{getMobileNavigationLabel(item.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
