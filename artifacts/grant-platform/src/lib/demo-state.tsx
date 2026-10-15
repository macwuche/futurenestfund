import { createContext, useCallback, useEffect, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  useGetApplicantDashboard, getGetApplicantDashboardQueryKey, useGetApplicantAccount, getGetApplicantAccountQueryKey,
  type ApplicantApplication, type ApplicantDashboard, type ApplicantAccount,
} from '@workspace/api-client-react';

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

/** Pull the API's `{ error }` message out of a failed request. */
export const apiError = (e: unknown, fallback: string) =>
  (e as { data?: { error?: string } } | null)?.data?.error ?? fallback;

export const matchesSearch = (a: { title: string; category: string }, s: string) => {
  const q = s.trim().toLowerCase();
  return !q || a.title.toLowerCase().includes(q) || a.category.toLowerCase().includes(q);
};

export interface Milestone { id: string; title: string; grant: string; due: string; done: boolean }
const seedMilestones: Milestone[] = [
  { id: 'ms-1', title: 'Project kickoff', grant: 'Sustainable Futures Fund', due: '2026-10-01', done: true },
  { id: 'ms-2', title: 'Interim progress report', grant: 'Sustainable Futures Fund', due: '2026-11-15', done: false },
  { id: 'ms-3', title: 'Budget review with funder', grant: 'Sustainable Futures Fund', due: '2026-12-10', done: false },
  { id: 'ms-4', title: 'Final impact report', grant: 'Sustainable Futures Fund', due: '2027-03-31', done: false },
];

export interface NewAppPrefill { title?: string; category?: string; amount?: number }
interface Demo {
  apps: ApplicantApplication[];
  addApp: (a: { title: string; category: string; amount: number }) => void;
  search: string;
  setSearch: (s: string) => void;
  adminSearch: string;
  setAdminSearch: (s: string) => void;
  doneSetup: string[];
  completeSetup: (id: string) => void;
  newApp: NewAppPrefill | null;
  openNewApp: (prefill?: NewAppPrefill) => void;
  closeNewApp: () => void;
  savedGrants: string[];
  toggleSavedGrant: (id: string) => boolean;
  milestones: Milestone[];
  addMilestone: (m: Omit<Milestone, 'id' | 'done'>) => void;
  toggleMilestone: (id: string) => void;
  removeMilestone: (id: string) => void;
  notes: string[];
  unread: number;
  markRead: () => void;
  notify: (s: string) => void;
}
const Ctx = createContext<Demo | null>(null);

function usePersisted<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => {
    try { const r = localStorage.getItem('grant-demo:' + key); return r ? (JSON.parse(r) as T) : init; } catch { return init; }
  });
  useEffect(() => { try { localStorage.setItem('grant-demo:' + key, JSON.stringify(v)); } catch { /* ignore */ } }, [key, v]);
  return [v, setV] as const;
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [apps, setApps] = usePersisted<ApplicantApplication[]>('apps', []);
  const [search, setSearch] = useState('');
  const [adminSearch, setAdminSearch] = useState('');
  const [doneSetup, setDone] = usePersisted<string[]>('setup', []);
  const [savedGrants, setSaved] = usePersisted<string[]>('saved-grants', []);
  const [newApp, setNewApp] = useState<NewAppPrefill | null>(null);
  const [milestones, setMilestones] = usePersisted<Milestone[]>('milestones', seedMilestones);
  const [notes, setNotes] = useState<string[]>([]);
  const [unread, setUnread] = useState(0);
  const notify = useCallback((s: string) => { setNotes((n) => [s, ...n].slice(0, 8)); setUnread((u) => u + 1); }, []);
  const completeSetup = useCallback((id: string) => setDone((p) => (p.includes(id) ? p : [...p, id])), [setDone]);
  const value = useMemo<Demo>(() => ({
    apps, search, setSearch, adminSearch, setAdminSearch, doneSetup, completeSetup, newApp, savedGrants, notes, unread, notify, milestones,
    addMilestone: (m) => { setMilestones((p) => [...p, { ...m, id: `ms-${Date.now()}`, done: false }]); notify(`Milestone "${m.title}" added`); },
    toggleMilestone: (id) => setMilestones((p) => p.map((x) => (x.id === id ? { ...x, done: !x.done } : x))),
    removeMilestone: (id) => setMilestones((p) => p.filter((x) => x.id !== id)),
    openNewApp: (prefill) => setNewApp(prefill ?? {}),
    closeNewApp: () => setNewApp(null),
    markRead: () => setUnread(0),
    addApp: (a) => {
      setApps((p) => [{ id: `local-${Date.now()}`, status: 'Submitted', submittedAt: new Date().toISOString(), ...a } as ApplicantApplication, ...p]);
      completeSetup('proposal');
      notify(`Demo application "${a.title}" saved in this browser only`);
    },
    toggleSavedGrant: (id) => {
      const saving = !savedGrants.includes(id);
      setSaved((p) => (saving ? [...p, id] : p.filter((x) => x !== id)));
      if (saving) completeSetup('matchmaking');
      return saving;
    },
  }), [apps, search, adminSearch, doneSetup, completeSetup, newApp, savedGrants, notes, unread, notify, milestones, setApps, setSaved, setMilestones]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useDemo() {
  const c = useContext(Ctx);
  if (!c) throw new Error('DemoProvider missing');
  return c;
}
