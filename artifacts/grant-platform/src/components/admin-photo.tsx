import { useEffect, useRef, useState } from 'react';
import {
  useDeleteAdminAvatar, useDeleteAdminUserAvatar, useGetAdminMe, useUploadAdminAvatar, useUploadAdminUserAvatar, type AdminUserProfile,
} from '@workspace/api-client-react';
import { Camera, Loader2 } from 'lucide-react';
import { FILE_RULES, Modal, checkFile, cx, initials } from '@/components/bits';
import { card, dark, ghost, SectionTitle, useAdminRefresh } from '@/components/admin-bits';
import { apiError } from '@/lib/demo-state';
import { useToast } from '@/hooks/use-toast';

/** Round photo in the admin palette; initials when there's no photo or it fails to load. */
export function AdminAvatar({ name, url, className, testid }: { name: string; url?: string; className: string; testid?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <span data-testid={testid} className={cx('grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#111] font-display font-bold text-[#C6F432]', className)}>
      {url && !failed ? <img src={url} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} /> : initials(name) || '?'}
    </span>
  );
}

/** The signed-in administrator's own name, email and photo. */
export const useAdminAccount = () => useGetAdminMe().data;

/** A photo with a camera button that uploads at once, and an optional remove action. Shared by Settings and the inspector. */
function PhotoPicker({ name, url, label, busy, onPick, error, size, testid }: {
  name: string; url?: string; label: string; busy: boolean; onPick: (file: File) => void; error: string; size: string; testid: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="relative shrink-0">
      <AdminAvatar name={name} url={url} className={size} testid={testid} />
      {busy && <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50"><Loader2 className="h-6 w-6 animate-spin text-white" /></span>}
      <button type="button" aria-label={label} title={label} data-testid="button-avatar-upload" disabled={busy} onClick={() => input.current?.click()}
        aria-describedby={error ? 'avatar-error' : undefined}
        className="press absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-[#C6F432] text-[#111] ring-2 ring-white before:absolute before:-inset-1.5 before:content-[''] disabled:opacity-60"><Camera className="h-4 w-4" /></button>
      <input ref={input} type="file" accept={FILE_RULES.image.accept} hidden data-testid="input-avatar-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
    </div>
  );
}

const errorBox = 'mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800';

/** Admin Settings: the administrator's own photo, shown in the sidebar and header. */
export function AdminPhotoSettings() {
  const { data: me } = useGetAdminMe();
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const upload = useUploadAdminAvatar();
  const remove = useDeleteAdminAvatar();
  const [err, setErr] = useState('');
  const busy = upload.isPending || remove.isPending;
  const pick = (file: File) => {
    const problem = checkFile(file, 'image');
    setErr(problem);
    if (problem) return;
    upload.mutate({ data: { file } }, {
      onSuccess: () => { refresh(); toast({ title: 'Your photo is updated' }); },
      onError: (e) => setErr(apiError(e, 'The photo could not be uploaded. Please try again.')),
    });
  };
  return (
    <section className={cx(card, 'p-5')} data-testid="card-admin-photo">
      <SectionTitle>Your profile photo</SectionTitle>
      <div className="flex flex-wrap items-center gap-4">
        <PhotoPicker name={me?.name ?? ''} url={me?.avatarUrl} label={me?.avatarUrl ? 'Change your photo' : 'Add your photo'} busy={busy} onPick={pick} error={err} size="h-16 w-16 text-xl" testid="avatar-admin-settings" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="truncate font-semibold" data-testid="text-admin-photo-name">{me?.name}</p>
          <p className="truncate text-slate-600">{me?.email}</p>
          <p className="mt-1 text-xs text-slate-500">JPG, PNG or WebP, up to 10 MB. Shown in the sidebar and header.</p>
          {me?.avatarUrl && (
            <button type="button" data-testid="button-avatar-remove" disabled={busy} onClick={() => { setErr(''); remove.mutate(undefined, {
              onSuccess: () => { refresh(); toast({ title: 'Your photo is removed' }); },
              onError: (e) => setErr(apiError(e, 'The photo could not be removed.')),
            }); }} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-slate-600 hover:text-red-800 disabled:opacity-60 md:min-h-0">Remove photo</button>
          )}
        </div>
      </div>
      {err && <p role="alert" id="avatar-error" className={errorBox} data-testid="text-avatar-error">{err}</p>}
    </section>
  );
}

/** User inspector: an administrator sets or removes the applicant's photo. Audited; the applicant is notified. */
export function UserPhotoControl({ u }: { u: AdminUserProfile }) {
  const refresh = useAdminRefresh();
  const { toast } = useToast();
  const upload = useUploadAdminUserAvatar();
  const remove = useDeleteAdminUserAvatar();
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const busy = upload.isPending || remove.isPending;
  const pick = (file: File) => {
    const problem = checkFile(file, 'image');
    setErr(problem);
    if (problem) return;
    upload.mutate({ userId: u.id, data: { file } }, {
      onSuccess: () => { refresh(); toast({ title: 'Profile photo updated', description: `${u.name} has been notified.` }); },
      onError: (e) => setErr(apiError(e, 'The photo could not be uploaded. Please try again.')),
    });
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <PhotoPicker name={u.name} url={u.avatarUrl} label={u.avatarUrl ? `Change ${u.name}'s photo` : `Add a photo for ${u.name}`} busy={busy} onPick={pick} error={err} size="h-16 w-16 text-xl" testid="avatar-inspector" />
      {u.avatarUrl && (
        <button type="button" data-testid="button-avatar-remove" disabled={busy} onClick={() => setConfirm(true)}
          className="inline-flex min-h-11 items-center text-xs font-semibold text-slate-600 hover:text-red-800 disabled:opacity-60 md:min-h-0 md:pt-1">Remove photo</button>
      )}
      {err && <p role="alert" id="avatar-error" className={cx(errorBox, 'mt-1 max-w-xs')} data-testid="text-avatar-error">{err}</p>}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Remove profile photo?" testid="dialog-remove-avatar">
        <p className="text-sm text-slate-600">{u.name}'s photo will be deleted and they'll be notified. They can upload a new one in Settings.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={ghost} onClick={() => setConfirm(false)}>Keep photo</button>
          <button type="button" className={dark} data-testid="button-confirm-remove-avatar" disabled={remove.isPending} onClick={() => remove.mutate({ userId: u.id }, {
            onSuccess: () => { refresh(); setConfirm(false); toast({ title: 'Profile photo removed', description: `${u.name} has been notified.` }); },
            onError: (e) => { setConfirm(false); setErr(apiError(e, 'The photo could not be removed.')); },
          })}>{remove.isPending ? 'Removing…' : 'Remove photo'}</button>
        </div>
      </Modal>
    </div>
  );
}
