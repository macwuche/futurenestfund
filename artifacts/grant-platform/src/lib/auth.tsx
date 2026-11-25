import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createSession, deleteSession, getAuthConfig, getMe, setAuthTokenGetter, setExtraHeaders, type Me } from '@workspace/api-client-react';

export type AuthStatus = 'loading' | 'error' | 'demo' | 'signed-out' | 'signed-in';
interface Auth {
  status: AuthStatus;
  /** The signed-in caller (null in demo mode or when signed out). */
  me: Me | null;
  /** Supabase Auth client; null in demo mode. */
  client: SupabaseClient | null;
  /** True after a password-reset link signed the user in, until they set a new password. */
  recovering: boolean;
  finishRecovery: () => void;
  /** Signed out on purpose (not an expired session), so sign-in shouldn't offer to return to the last page. */
  signedOutByUser: boolean;
  /** True in a tab an administrator opened with "Sign in as user": `me` is that user, `me.actingAdmin` the administrator. */
  actingAs: boolean;
  /** Leaves a sign-in-as tab (closes it, or goes back to the admin workspace); the administrator stays signed in. */
  stopActingAs: () => Promise<void>;
  /** 'local' signs this browser out; 'global' signs out every device, this one included. */
  signOut: (scope?: 'local' | 'global') => Promise<void>;
  /** Ends this account's sessions on every other device; this one stays signed in. */
  signOutOthers: () => Promise<void>;
  retry: () => void;
}
const Ctx = createContext<Auth | null>(null);

/** Where Supabase email links come back to (must be on the project's Redirect URLs list). */
export const appUrl = (path = '') => `${window.location.origin}${import.meta.env.BASE_URL}${path}`;

/**
 * "Sign in as user": the admin page opens `?act_as=<userId>` in a new tab. The ID is kept in sessionStorage, which
 * belongs to that one tab (and survives reloads), and sent as X-Act-As with the administrator's own sign-in. Other tabs,
 * the administrator's included, are unaffected.
 */
const ACT_AS_KEY = 'gp_act_as';
export const signInAsUrl = (userId: string) => appUrl(`?act_as=${encodeURIComponent(userId)}`);
function readActAs(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('act_as');
  if (fromUrl) {
    sessionStorage.setItem(ACT_AS_KEY, fromUrl);
    url.searchParams.delete('act_as');
    window.history.replaceState(window.history.state, '', url);
  }
  return sessionStorage.getItem(ACT_AS_KEY);
}
const applyActAs = (id: string | null) => setExtraHeaders(id ? { 'X-Act-As': id } : {});

/**
 * PKCE flow: no session tokens ever appear in a URL. Our emails link to /auth/confirm with a one-time token hash
 * (exchanged by verifyOtp, so links work on any device); Supabase's own redirects come back with a ?code.
 *
 * Asks the API whether sign-in is on, then keeps the Supabase session, the API's bearer token, the GET-only
 * download cookie and the caller's identity in step. Signing out (or switching user) clears all cached data.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [signedOutByUser, setSignedOutByUser] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const userId = useRef<string | null>(null);
  const [actAs, setActAs] = useState<string | null>(() => { const id = readActAs(); applyActAs(id); return id; });
  // Leaving a user's account in this tab: the sign-in (the administrator's) doesn't change, so forget everything shown.
  const dropActAs = useCallback(() => {
    sessionStorage.removeItem(ACT_AS_KEY);
    applyActAs(null);
    userId.current = null;
    qc.clear();
    setMe(null);
    setStatus('loading');
    setActAs(null);
  }, [qc]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    (async () => {
      let config;
      try { config = await getAuthConfig(); } catch { if (!cancelled) setStatus('error'); return; }
      if (cancelled) return;
      if (config.mode === 'demo' || !config.supabaseUrl || !config.publishableKey) {
        // No accounts in demo mode, but a sign-in-as tab still needs to know whom it shows (for its banner).
        if (actAs) {
          try { await createSession(); const who = await getMe(); if (!cancelled) setMe(who); } catch { if (!cancelled) dropActAs(); return; }
        }
        if (!cancelled) setStatus('demo');
        return;
      }

      const sb = createClient(config.supabaseUrl, config.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      });
      setAuthTokenGetter(async () => (await sb.auth.getSession()).data.session?.access_token ?? null);
      setClient(sb);

      const signedOut = () => {
        // The administrator signed out (e.g. in their own tab): this tab is no longer anyone's, so whoever signs in
        // here next must not land in the user's account.
        if (actAs) dropActAs();
        userId.current = null;
        qc.clear();
        setMe(null);
        setStatus('signed-out');
      };
      const signedIn = async (session: Session) => {
        if (userId.current !== session.user.id) qc.clear(); // never show one user's cached data to the next
        userId.current = session.user.id;
        setSignedOutByUser(false);
        try {
          await createSession(); // the cookie must exist before any <img> or download link renders
          const who = await getMe();
          if (!cancelled) { setMe(who); setStatus('signed-in'); }
        } catch (e) {
          const code = (e as { status?: number }).status;
          // A sign-in-as tab whose user was deleted, or whose administrator lost the role: carry on as yourself.
          if (actAs && (code === 403 || code === 404)) { dropActAs(); return; }
          if (code === 401) await sb.auth.signOut({ scope: 'local' }); // e.g. the account was deleted
          else if (!cancelled) setStatus('error');
        }
      };
      const { data } = sb.auth.onAuthStateChange((event, session) => {
        // Supabase warns against awaiting its own calls inside this callback, so defer the work.
        setTimeout(() => {
          if (cancelled) return;
          if (event === 'PASSWORD_RECOVERY') setRecovering(true);
          if (event === 'SIGNED_OUT' || !session) signedOut();
          else if (event === 'TOKEN_REFRESHED') void createSession().catch(() => {});
          else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY' || event === 'USER_UPDATED') {
            if (event === 'USER_UPDATED' && userId.current === session.user.id) return;
            void signedIn(session);
          }
        }, 0);
      });
      unsubscribe = () => data.subscription.unsubscribe();
    })();
    return () => { cancelled = true; unsubscribe(); };
  }, [qc, attempt, actAs, dropActAs]);

  // Images and downloads use a cookie, which all tabs share: with two sign-in-as tabs open, the one in front owns it.
  useEffect(() => {
    if (!actAs || (status !== 'signed-in' && status !== 'demo')) return;
    const claim = () => { if (document.visibilityState === 'visible') void createSession().catch(() => {}); };
    window.addEventListener('focus', claim);
    document.addEventListener('visibilitychange', claim);
    return () => { window.removeEventListener('focus', claim); document.removeEventListener('visibilitychange', claim); };
  }, [actAs, status]);

  const stopActingAs = useCallback(async () => {
    await deleteSession().catch(() => {}); // sent with X-Act-As, so only the act-as cookie goes
    dropActAs();
    window.close(); // works for the tab the admin page opened; otherwise go back to the admin workspace
    window.location.assign(appUrl('admin'));
  }, [dropActAs, qc]);

  const signOut = useCallback(async (scope: 'local' | 'global' = 'local') => {
    if (actAs) { await stopActingAs(); return; } // never sign the administrator out from a user's tab
    if (!client) return;
    setSignedOutByUser(true);
    await deleteSession().catch(() => {}); // needs the bearer token, so before Supabase forgets it
    const { error } = await client.auth.signOut({ scope });
    if (error && scope === 'global') throw error; // a local sign-out always clears this browser, even offline
  }, [client, actAs, stopActingAs]);

  const signOutOthers = useCallback(async () => {
    if (!client || actAs) return;
    const { error } = await client.auth.signOut({ scope: 'others' });
    if (error) throw error;
  }, [client, actAs]);

  const value = useMemo<Auth>(() => ({
    status, me, client, recovering, signedOutByUser,
    finishRecovery: () => setRecovering(false),
    actingAs: !!me?.actingAdmin, stopActingAs,
    signOut, signOutOthers,
    retry: () => { setStatus('loading'); setAttempt((n) => n + 1); },
  }), [status, me, client, recovering, signedOutByUser, stopActingAs, signOut, signOutOthers]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
