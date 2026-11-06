import { useListAdminTierRequests, getListAdminTierRequestsQueryKey } from '@workspace/api-client-react';

/** Pending tier upgrade requests (Step 9.4). The menu badge, the dashboard and Tier Upgrades share this query. */
export const usePendingTierRequests = (refetchInterval?: number) =>
  useListAdminTierRequests({ status: 'pending' }, { query: { queryKey: getListAdminTierRequestsQueryKey({ status: 'pending' }), ...(refetchInterval ? { refetchInterval } : {}) } });
