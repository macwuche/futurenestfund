import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { DemoProvider } from '@/lib/demo-state';
import {
  DashboardPage, GrantsPage, ApplicationsPage, CardsPage, TransactionsPage, WithdrawalsPage, DepositsPage, SettingsPage,
} from '@/pages/applicant';
import {
  AdminOverviewPage, AdminUsersPage, AdminUserPage, AdminTransactionsPage, AdminDepositsPage, AdminWithdrawalsPage, AdminKycPage, AdminSettingsPage,
} from '@/pages/admin';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/grants" component={GrantsPage} />
        <Route path="/applications" component={ApplicationsPage} />
        <Route path="/cards" component={CardsPage} />
        <Route path="/transactions" component={TransactionsPage} />
        <Route path="/withdrawals" component={WithdrawalsPage} />
        <Route path="/deposits" component={DepositsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/admin" component={AdminOverviewPage} />
        <Route path="/admin/users" component={AdminUsersPage} />
        <Route path="/admin/users/:userId" component={AdminUserPage} />
        <Route path="/admin/transactions" component={AdminTransactionsPage} />
        <Route path="/admin/deposits" component={AdminDepositsPage} />
        <Route path="/admin/withdrawals" component={AdminWithdrawalsPage} />
        <Route path="/admin/kyc" component={AdminKycPage} />
        <Route path="/admin/settings" component={AdminSettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
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
        <DemoProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </DemoProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
