import { type ComponentType, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { DemoProvider } from '@/lib/demo-state';
import { AuthProvider, useAuth } from '@/lib/auth';
import { SignInPage, SignUpPage, ForgotPasswordPage, ResetPasswordPage, ConfirmPage, AuthLoading, AuthUnavailable } from '@/pages/auth';
import { safeNext } from '@/lib/safe-next';
import {
  DashboardPage, GrantsPage, ApplicationsPage, ApplicationDetailPage, CardsPage, TransactionsPage, WithdrawalsPage, DepositsPage, SettingsPage,
} from '@/pages/applicant';
import { GrantSearchPage, FundingTrackerPage, ReportsPage, MilestonesPage, HelpPage } from '@/pages/applicant-more';
import { Layout } from '@/components/shell';
import { AdminOverviewPage, AdminUsersPage, AdminUserPage, AdminSettingsPage } from '@/pages/admin';
import { AdminAuditPage, AdminTransactionsPage, AdminDepositsPage, AdminWithdrawalsPage, AdminKycPage, AdminApplicationPage } from '@/pages/admin-ops';
import {
  Redirect,
  Route,
  Switch,
  useLocation,
  useSearch,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function Router() {
  const [loc] = useLocation();
  const admin = loc === '/admin' || loc.startsWith('/admin/');
  return (
    <Layout key={admin ? 'admin' : 'user'} admin={admin}>
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/grants" component={GrantsPage} />
        <Route path="/applications" component={ApplicationsPage} />
        <Route path="/applications/:id" component={ApplicationDetailPage} />
        <Route path="/cards" component={CardsPage} />
        <Route path="/transactions" component={TransactionsPage} />
        <Route path="/withdrawals" component={WithdrawalsPage} />
        <Route path="/deposits" component={DepositsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/grant-search" component={GrantSearchPage} />
        <Route path="/funding-tracker" component={FundingTrackerPage} />
        <Route path="/reports" component={ReportsPage} />
        <Route path="/milestones" component={MilestonesPage} />
        <Route path="/help" component={HelpPage} />
        <Route path="/admin" component={AdminOverviewPage} />
        <Route path="/admin/users" component={AdminUsersPage} />
        <Route path="/admin/users/:userId" component={AdminUserPage} />
        <Route path="/admin/users/:userId/applications/:applicationId" component={AdminApplicationPage} />
        <Route path="/admin/transactions" component={AdminTransactionsPage} />
        <Route path="/admin/audit" component={AdminAuditPage} />
        <Route path="/admin/deposits" component={AdminDepositsPage} />
        <Route path="/admin/withdrawals" component={AdminWithdrawalsPage} />
        <Route path="/admin/kyc" component={AdminKycPage} />
        <Route path="/admin/settings" component={AdminSettingsPage} />
        <Route path="/admin/settings/:section" component={AdminSettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
    </Layout>
  );
}

const AUTH_PAGES: Partial<Record<string, ComponentType>> = {
  '/sign-in': SignInPage, '/sign-up': SignUpPage, '/forgot-password': ForgotPasswordPage, '/reset-password': ResetPasswordPage,
};
const isAdminPath = (loc: string) => loc === '/admin' || loc.startsWith('/admin/');

/**
 * Decides what a visitor may see. Demo mode: everything, as before. Signed out: only the sign-in pages (anything else
 * redirects to sign-in and comes back afterwards). Signed in: admins stay in /admin, applicants outside it.
 */
function AuthGate() {
  const auth = useAuth();
  const [loc] = useLocation();
  const search = useSearch();
  if (auth.status === 'loading') return <AuthLoading />;
  if (auth.status === 'error') return <AuthUnavailable onRetry={auth.retry} />;
  if (auth.status === 'demo') return <Workspace scope="" />;
  // Email links land here signed in or not (an email-change link is opened while signed in).
  if (loc === '/auth/confirm') return <ConfirmPage />;

  const AuthPage = AUTH_PAGES[loc];
  if (auth.status === 'signed-out') {
    if (AuthPage) return <AuthPage />;
    const here = loc + (search ? `?${search}` : '');
    return <Redirect to={here === '/' || auth.signedOutByUser ? '/sign-in' : `/sign-in?next=${encodeURIComponent(here)}`} replace />;
  }

  const admin = auth.me!.role === 'admin' || auth.me!.role === 'root';
  const home = admin ? '/admin' : '/';
  if (loc === '/reset-password' || auth.recovering) return <ResetPasswordPage />;
  if (AuthPage) {
    const next = safeNext(new URLSearchParams(search).get('next'));
    return <Redirect to={next && isAdminPath(next) === admin ? next : home} replace />;
  }
  if (isAdminPath(loc) !== admin) return <Redirect to={home} replace />;
  return <Workspace scope={auth.me!.profileId ?? auth.me!.email} />;
}

/** The app itself. Browser-only preferences (saved grants, setup progress) are kept per signed-in user. */
function Workspace({ scope }: { scope: string }) {
  return (
    <DemoProvider key={scope} scope={scope}>
      <Router />
    </DemoProvider>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <AuthGate />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
