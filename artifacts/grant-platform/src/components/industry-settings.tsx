import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListAdminIndustriesQueryKey, getListIndustriesQueryKey, useCreateAdminIndustry, useDeleteAdminIndustry, useListAdminIndustries, useRenameAdminIndustry,
  type AdminIndustry,
} from '@workspace/api-client-react';
import { Briefcase, Pencil, Search, Trash2 } from 'lucide-react';
import { ErrorState, Skel, cx } from '@/components/bits';
import { ainput, card, danger, ghost, lime, SectionTitle } from '@/components/admin-bits';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/**
 * Admin Settings → Industries (Phase 11): the list users choose from at sign-up and grant plans belong to.
 * An industry a plan uses can't be removed; removing one asks its users to choose again.
 */
export function IndustrySettings() {
  const q = useListAdminIndustries();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateAdminIndustry();
  const [name, setName] = useState('');
  const [find, setFind] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = (list: AdminIndustry[]) => {
    qc.setQueryData(getListAdminIndustriesQueryKey(), list);
    qc.invalidateQueries({ queryKey: getListIndustriesQueryKey() });
  };
  const shown = useMemo(() => (q.data ?? []).filter((i) => i.name.toLowerCase().includes(find.trim().toLowerCase())), [q.data, find]);
  const add = () => {
    setError(null);
    create.mutate({ data: { name } }, {
      onSuccess: (list) => { refresh(list); toast({ title: `"${name.trim()}" added` }); setName(''); },
      onError: (e) => setError(apiError(e, "Couldn't add the industry.")),
    });
  };
  return (
    <section className={cx(card, 'p-5')} data-testid="card-industries">
      <SectionTitle><span className="inline-flex items-center gap-2"><Briefcase className="h-4 w-4" />Industries</span></SectionTitle>
      <p className="mb-4 text-sm text-slate-600">Users choose one when they sign up (or when asked on their dashboard), and each grant plan belongs to one. Plans in a user's industry are recommended to them.</p>
      <form className="mb-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); add(); }} noValidate>
        <label className="min-w-0 flex-1"><span className="sr-only">New industry</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add an industry, e.g. Women empowerment" maxLength={60} className={ainput} data-testid="input-new-industry" />
        </label>
        <button type="submit" className={lime} disabled={create.isPending || !name.trim()} data-testid="button-add-industry">{create.isPending ? 'Adding…' : 'Add industry'}</button>
      </form>
      {error && <p className="-mt-2 mb-3 text-sm text-red-700" role="alert" data-testid="error-industries">{error}</p>}
      {q.isLoading ? <div className="space-y-2"><Skel className="h-10" /><Skel className="h-10" /><Skel className="h-10" /></div>
        : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
        : (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-500" data-testid="text-industry-count">{q.data.length} industr{q.data.length === 1 ? 'y' : 'ies'}</p>
              <label className="relative w-full sm:w-64"><span className="sr-only">Find an industry</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find" className={cx(ainput, 'pl-9')} data-testid="input-find-industry" />
              </label>
            </div>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" data-testid="list-industries">
              {shown.map((i) => <IndustryRow key={i.id} i={i} onChanged={refresh} />)}
              {!shown.length && <li className="p-4 text-sm text-slate-500">No industry matches "{find}".</li>}
            </ul>
          </>
        )}
    </section>
  );
}

function IndustryRow({ i, onChanged }: { i: AdminIndustry; onChanged: (list: AdminIndustry[]) => void }) {
  const { toast } = useToast();
  const rename = useRenameAdminIndustry();
  const remove = useDeleteAdminIndustry();
  const [mode, setMode] = useState<'view' | 'edit' | 'remove'>('view');
  const [name, setName] = useState(i.name);
  const [error, setError] = useState<string | null>(null);
  const tid = i.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const usage = `${i.planCount} plan${i.planCount === 1 ? '' : 's'} · ${i.userCount} user${i.userCount === 1 ? '' : 's'}`;
  const save = () => {
    setError(null);
    rename.mutate({ industryId: i.id, data: { name } }, {
      onSuccess: (list) => { onChanged(list); setMode('view'); toast({ title: 'Industry renamed' }); },
      onError: (e) => setError(apiError(e, "Couldn't rename it.")),
    });
  };
  const drop = () => {
    setError(null);
    remove.mutate({ industryId: i.id }, {
      onSuccess: (list) => { onChanged(list); toast({ title: `"${i.name}" removed`, description: i.userCount ? `${i.userCount} user${i.userCount === 1 ? ' was' : 's were'} asked to choose again.` : undefined }); },
      onError: (e) => { setError(apiError(e, "Couldn't remove it.")); setMode('view'); },
    });
  };
  return (
    <li className="px-3 py-2.5" data-testid={`row-industry-${tid}`}>
      {mode === 'edit' ? (
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
          <label className="min-w-0 flex-1"><span className="sr-only">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus className={ainput} data-testid={`input-rename-${tid}`} />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={lime} disabled={rename.isPending} data-testid={`button-save-${tid}`}>Save</button>
            <button type="button" className={ghost} onClick={() => { setMode('view'); setName(i.name); setError(null); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block font-medium text-slate-900">{i.name}</span>
            <span className="block text-xs text-slate-500" data-testid={`text-usage-${tid}`}>{usage}</span>
          </span>
          {mode === 'remove' ? (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-700">{i.userCount ? `Remove? ${i.userCount} user${i.userCount === 1 ? '' : 's'} will be asked to choose again.` : 'Remove?'}</span>
              <button type="button" className={danger} disabled={remove.isPending} onClick={drop} data-testid={`button-confirm-remove-${tid}`}>Remove</button>
              <button type="button" className={ghost} onClick={() => setMode('view')}>Cancel</button>
            </span>
          ) : (
            <span className="flex gap-1">
              <button type="button" className="press grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100" aria-label={`Rename ${i.name}`} onClick={() => setMode('edit')} data-testid={`button-rename-${tid}`}><Pencil className="h-4 w-4" /></button>
              <button type="button" className="press grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40" aria-label={`Remove ${i.name}`}
                title={i.planCount ? 'Used by a grant plan: move the plan to another industry first' : undefined} disabled={i.planCount > 0}
                onClick={() => setMode('remove')} data-testid={`button-remove-${tid}`}><Trash2 className="h-4 w-4" /></button>
            </span>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-sm text-red-700" role="alert">{error}</p>}
    </li>
  );
}
