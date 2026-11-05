import { createContext, useCallback, useEffect, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetApplicantDashboard, getGetApplicantDashboardQueryKey, useGetApplicantAccount, getGetApplicantAccountQueryKey,
  useListApplicantApplications, getListApplicantApplicationsQueryKey, useListApplicantMilestones, getListApplicantMilestonesQueryKey, getListApplicantGrantPlansQueryKey,
  useListApplicantNotifications, getListApplicantNotificationsQueryKey,
  type ApplicantApplication, type ApplicantDashboard, type ApplicantAccount, type Milestone, type NotificationList,
} from '@workspace/api-client-react';
export type { Milestone };

/** One category list shared by grant cards, the new-application form and sample applications. */
export const CATEGORIES = ['Technology & innovation', 'Arts & culture', 'Community', 'Environment', 'Education', 'Health'] as const;

/** The dev server answers unknown /api paths with index.html; treat anything without a profile as an error instead of crashing. */
function asDashboard(d: unknown): ApplicantDashboard {
  if (!d || typeof d !== 'object' || !('profile' in d)) throw new Error('Unexpected dashboard response');
  return d as ApplicantDashboard;
}
/** Single applicant dashboard query used by every user-side screen (one cache entry, monthly trend). */
export function useApplicantDashboard(period: 'weekly' | 'monthly' = 'monthly') {
  const params = { period };
  return useGetApplicantDashboard(params, { query: { queryKey: getGetApplicantDashboardQueryKey(params), select: asDashboard } });
}

function asAccount(d: unknown): ApplicantAccount {
  if (!d || typeof d !== 'object' || !('balances' in d)) throw new Error('Unexpected account response');
  return d as ApplicantAccount;
}
/** Balances, cards and money movements for the signed-in (demo) applicant. */
export function useApplicantAccount() {
  return useGetApplicantAccount({ query: { queryKey: getGetApplicantAccountQueryKey(), select: asAccount } });
}

const asArray = <T,>(d: unknown): T[] => { if (!Array.isArray(d)) throw new Error('Unexpected list response'); return d as T[]; };
function asNotifications(d: unknown): NotificationList {
  if (!d || typeof d !== 'object' || !('items' in d)) throw new Error('Unexpected notifications response');
  return d as NotificationList;
}
/** All of the applicant's applications, newest first (includes withdrawn ones). */
export function useApplications() {
  return useListApplicantApplications({ query: { queryKey: getListApplicantApplicationsQueryKey(), select: asArray<ApplicantApplication> } });
}
export function useMilestones() {
  return useListApplicantMilestones({ query: { queryKey: getListApplicantMilestonesQueryKey(), select: asArray<Milestone> } });
}
/** Server notifications; polled so events created elsewhere (e.g. admin top-ups) show up. */
export function useNotifications() {
  return useListApplicantNotifications({ query: { queryKey: getListApplicantNotificationsQueryKey(), select: asNotifications, refetchInterval: 30_000 } });
}
/** Refetch everything that changes after an applicant action. */
export function useRefreshApplicant() {
  const qc = useQueryClient();
  return useCallback(() => {
    for (const key of [getListApplicantApplicationsQueryKey(), getGetApplicantDashboardQueryKey(), getGetApplicantAccountQueryKey(), getListApplicantNotificationsQueryKey(), getListApplicantMilestonesQueryKey(), getListApplicantGrantPlansQueryKey()]) {
      qc.invalidateQueries({ queryKey: key });
    }
  }, [qc]);
}

/** Pull the API's `{ error }` message out of a failed request. */
export const apiError = (e: unknown, fallback: string) =>
  (e as { data?: { error?: string } } | null)?.data?.error ?? fallback;

export const matchesSearch = (a: { title: string; category: string }, s: string) => {
  const q = s.trim().toLowerCase();
  return !q || a.title.toLowerCase().includes(q) || a.category.toLowerCase().includes(q);
};

interface Demo {
  search: string;
  setSearch: (s: string) => void;
  savedGrants: string[];
  toggleSavedGrant: (id: string) => boolean;
}
const Ctx = createContext<Demo | null>(null);

/** `scope` keeps each signed-in user's browser-only state apart ("" = the demo preview's original keys). */
function usePersisted<T>(scope: string, name: string, init: T) {
  const key = `grant-demo:${scope ? `${scope}:` : ''}${name}`;
  const [v, setV] = useState<T>(() => {
    try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : init; } catch { return init; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }, [key, v]);
  return [v, setV] as const;
}

export function DemoProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const [search, setSearch] = useState('');
  const [savedGrants, setSaved] = usePersisted<string[]>(scope, 'saved-grants', []);
  const value = useMemo<Demo>(() => ({
    search, setSearch, savedGrants,
    toggleSavedGrant: (id) => {
      const saving = !savedGrants.includes(id);
      setSaved((p) => (saving ? [...p, id] : p.filter((x) => x !== id)));
      return saving;
    },
  }), [search, savedGrants, setSaved]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useDemo() {
  const c = useContext(Ctx);
  if (!c) throw new Error('DemoProvider missing');
  return c;
}
