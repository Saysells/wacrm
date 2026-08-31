// ============================================================
// Role-based navigation policy — pure, unit-testable, no I/O.
//
// The 'agent' role gets a reduced app: Inbox, Notifications and
// Contacts (plus /settings for their own profile/security, whose
// account-level sections are already admin-gated inside the page).
// Everything else is hidden from the sidebar AND blocked in the
// middleware, so a typed URL can't reach a hidden section.
//
// Both consumers (sidebar.tsx and middleware.ts) read from here —
// changing what an agent can open is a one-file diff.
// ============================================================

import type { AccountRole } from "./roles";

/**
 * Sidebar entries an 'agent' sees — exactly Inbox, Notifications and
 * Contacts, per the reduced-agent-view decision (2026-08-31).
 */
export const AGENT_NAV_PREFIXES = [
  "/inbox",
  "/notifications",
  "/contacts",
] as const;

/**
 * Route prefixes an 'agent' may OPEN — the nav set plus /settings.
 * Settings stays reachable (via the avatar dropdown) because agents
 * still own their profile, password and appearance; the page hides
 * its account-level sections from non-admins on its own. It is kept
 * out of the sidebar so the agent nav shows exactly three entries.
 */
export const AGENT_ALLOWED_PREFIXES = [
  ...AGENT_NAV_PREFIXES,
  "/settings",
] as const;

/**
 * Every authed dashboard section. The middleware's auth redirect and
 * the role gate both iterate this list; keep it in sync when a new
 * top-level section ships.
 */
export const DASHBOARD_PREFIXES = [
  "/dashboard",
  "/inbox",
  "/notifications",
  "/contacts",
  "/pipelines",
  "/broadcasts",
  "/automations",
  "/flows",
  "/agents",
  "/settings",
] as const;

/** Prefix match that doesn't false-positive on e.g. /inbox-archive. */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** True when `pathname` belongs to the authed dashboard at all. */
export function isDashboardPath(pathname: string): boolean {
  return DASHBOARD_PREFIXES.some((p) => matchesPrefix(pathname, p));
}

/**
 * Whether `role` may open `pathname`. Non-dashboard paths are always
 * allowed (marketing pages, /join, auth pages — not this module's
 * concern). A `null` role (still loading, or unresolved profile) is
 * treated as the most restricted tier so nothing privileged flashes
 * or leaks while the profile fetch settles — same fail-closed stance
 * as `useCan`.
 */
export function canAccessPath(
  role: AccountRole | null,
  pathname: string,
): boolean {
  if (!isDashboardPath(pathname)) return true;
  if (role === "agent" || role === null) {
    return AGENT_ALLOWED_PREFIXES.some((p) => matchesPrefix(pathname, p));
  }
  return true;
}

/**
 * Whether a sidebar entry pointing at `href` should render for `role`.
 * Stricter than {@link canAccessPath}: an agent can open /settings but
 * doesn't get a nav row for it. Fails closed on a null role, same as
 * the access check.
 */
export function showsInNav(role: AccountRole | null, href: string): boolean {
  if (role === "agent" || role === null) {
    return AGENT_NAV_PREFIXES.some((p) => matchesPrefix(href, p));
  }
  return true;
}

/**
 * Landing page for a role — where blocked navigations and post-login
 * redirects should send the user. Agents live in the Inbox; everyone
 * else keeps the Dashboard home.
 */
export function homePathFor(role: AccountRole | null): string {
  return role === "agent" ? "/inbox" : "/dashboard";
}
