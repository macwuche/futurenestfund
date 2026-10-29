import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createSession, deleteSession, getAuthConfig, getMe, setAuthTokenGetter, type Me } from '@workspace/api-client-react';

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
  signOut: () => Promise<void>;
  retry: () => void;
}
const Ctx = createContext<Auth | null>(null);

/** Where Supabase email links come back to (must be on the project's Redirect URLs list). */
export const appUrl = (path = '') => `${window.location.origin}${import.meta.env.BASE_URL}${path}`;

/**
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

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    (async () => {
      let config;
      try { config = await getAuthConfig(); } catch { if (!cancelled) setStatus('error'); return; }
      if (cancelled) return;
      if (config.mode === 'demo' || !config.supabaseUrl || !config.publishableKey) { setStatus('demo'); return; }

      const sb = createClient(config.supabaseUrl, config.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
      });
      setAuthTokenGetter(async () => (await sb.auth.getSession()).data.session?.access_token ?? null);
      setClient(sb);

      const signedOut = () => {
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
          if ((e as { status?: number }).status === 401) await sb.auth.signOut({ scope: 'local' }); // e.g. the account was deleted
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
  }, [qc, attempt]);

  const signOut = useCallback(async () => {
    if (!client) return;
    setSignedOutByUser(true);
    await deleteSession().catch(() => {}); // needs the bearer token, so before Supabase forgets it
    await client.auth.signOut({ scope: 'local' });
  }, [client]);

  const value = useMemo<Auth>(() => ({
    status, me, client, recovering, signedOutByUser,
    finishRecovery: () => setRecovering(false),
    signOut,
    retry: () => { setStatus('loading'); setAttempt((n) => n + 1); },
  }), [status, me, client, recovering, signedOutByUser, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}

/** Plain-language messages for Supabase Auth errors (codes from the Auth API). */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  const msg = (e as { message?: string } | null)?.message ?? '';
  switch (code) {
    case 'invalid_credentials': return 'Email or password is incorrect.';
    case 'email_not_confirmed': return 'Please confirm your email address first. Check your inbox for the link.';
    case 'over_email_send_rate_limit': return 'Too many emails have been sent. Please wait a while and try again.';
    case 'over_request_rate_limit': return 'Too many attempts. Please wait a few minutes and try again.';
    case 'weak_password': return msg || 'Choose a stronger password.';
    case 'same_password': return 'Choose a password different from your current one.';
    case 'user_already_exists': case 'email_exists': return 'An account with this email already exists. Sign in instead.';
    case 'signup_disabled': return 'New sign-ups are currently closed.';
    case 'email_address_invalid': return 'Enter a valid email address.';
    default: return msg || 'Something went wrong. Please try again.';
  }
}
