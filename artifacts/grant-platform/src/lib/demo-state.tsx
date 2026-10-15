import { createContext, useCallback, useEffect, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ApplicantApplication } from '@workspace/api-client-react';

export interface DemoRequest { id: string; kind: 'Deposit' | 'Withdrawal'; amount: number; note: string; status: string; createdAt: string }
interface Demo {
  apps: ApplicantApplication[];
  addApp: (a: { title: string; category: string; amount: number }) => void;
  search: string;
  setSearch: (s: string) => void;
  adminSearch: string;
  setAdminSearch: (s: string) => void;
  doneSetup: string[];
  completeSetup: (id: string) => void;
  requests: DemoRequest[];
  addRequest: (r: Omit<DemoRequest, 'id' | 'status' | 'createdAt'>) => void;
  newAppOpen: boolean;
  setNewAppOpen: (b: boolean) => void;
  notes: string[];
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
  const [requests, setReqs] = usePersisted<DemoRequest[]>('requests', []);
  const [newAppOpen, setNewAppOpen] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const notify = useCallback((s: string) => setNotes((n) => [s, ...n].slice(0, 8)), []);
  const value = useMemo<Demo>(() => ({
    apps, search, setSearch, adminSearch, setAdminSearch, doneSetup, requests, newAppOpen, setNewAppOpen, notes, notify,
    addApp: (a) => {
      setApps((p) => [{ id: `local-${p.length + 1}`, status: 'Submitted', submittedAt: new Date().toISOString(), ...a } as ApplicantApplication, ...p]);
      notify(`Demo application "${a.title}" saved in this browser only`);
    },
    completeSetup: (id) => { setDone((p) => (p.includes(id) ? p : [...p, id])); notify('Setup step marked complete in preview'); },
    addRequest: (r) => {
      setReqs((p) => [{ ...r, id: `req-${p.length + 1}`, status: 'Pending', createdAt: new Date().toISOString() }, ...p]);
      notify(`${r.kind} request recorded in demo ledger`);
    },
  }), [apps, search, adminSearch, doneSetup, requests, newAppOpen, notes, notify]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useDemo() {
  const c = useContext(Ctx);
  if (!c) throw new Error('DemoProvider missing');
  return c;
}
