"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { labelFor, useMessages } from "../i18n";
import { ConfirmationDialog } from "./confirmation-dialog";
import type { SessionUser } from "./session";

type NavigationGroup = "workspace" | "management";
type NavigationKey = "overview" | "operations" | "compensation" | "settings";
const navigationGroups: NavigationGroup[] = ["workspace", "management"];
const navigation: { key: NavigationKey; href: string; group: NavigationGroup }[] = [
  { key: "overview", href: "/", group: "workspace" },
  { key: "operations", href: "/operations", group: "workspace" },
  { key: "compensation", href: "/compensation", group: "management" },
  { key: "settings", href: "/settings", group: "management" },
];

type Props = {
  children?: ReactNode;
  user: SessionUser;
  onSignOut: () => void;
  hasUnsavedChanges?: boolean;
};

export function AppShell({
  children,
  user,
  onSignOut,
  hasUnsavedChanges = false,
}: Props) {
  const t = useMessages();
  const pathname = usePathname();
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const requestAction = (action: () => void) => {
    if (hasUnsavedChanges) setPendingAction(() => action);
    else action();
  };
  const navigate = (href: string) => requestAction(() => router.push(href));
  const navigationLink = (item: (typeof navigation)[number]) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={pathname === item.href ? "page" : undefined}
      onClick={(event) => {
        if (!hasUnsavedChanges || pathname === item.href) return;
        event.preventDefault();
        navigate(item.href);
      }}
    >
      {t.shell.nav[item.key]}
    </Link>
  );
  return (
    <>
      <div id="app-shell-content" className="app-shell">
        <a className="skip-link" href="#main-content">
          {t.shell.skipLink}
        </a>
        <aside className="app-sidebar" aria-label={t.shell.primaryNavigation}>
          <Link
            className="brand"
            href="/"
            onClick={(event) => {
              event.preventDefault();
              navigate("/");
            }}
          >
            {t.meta.title}
          </Link>
          <p className="organization-context">{t.shell.organizationContext}</p>
          <nav>
            {navigationGroups.map((group) => (
              <div className="nav-group" key={group}>
                <p>{t.shell.groups[group]}</p>
                {navigation
                  .filter((item) => item.group === group)
                  .map(navigationLink)}
              </div>
            ))}
          </nav>
          <div className="profile">
            <strong>{user.email}</strong>
            <span>{labelFor(t.codes.role, user.role)}</span>
            <button
              className="text-button"
              type="button"
              onClick={() => requestAction(onSignOut)}
            >
              {t.shell.signOut}
            </button>
          </div>
        </aside>
        <main id="main-content" className="app-main">
          {children}
        </main>
        <nav className="mobile-navigation" aria-label={t.shell.primaryNavigation}>
          {navigation.map(navigationLink)}
        </nav>
      </div>
      {pendingAction && (
        <ConfirmationDialog
          title={t.shell.discardTitle}
          description={t.shell.discardDescription}
          confirmLabel={t.shell.discardConfirm}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            const action = pendingAction;
            setPendingAction(null);
            action();
          }}
        />
      )}
    </>
  );
}
