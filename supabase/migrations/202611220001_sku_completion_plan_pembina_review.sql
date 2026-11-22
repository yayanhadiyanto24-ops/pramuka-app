alter table public.sku_completion_plans
  add column if not exists status_pembina text,
  add column if not exists catatan_pembina text,
  add column if not exists ditanggapi_oleh uuid references auth.users(id),
  add column if not exists ditanggapi_at timestamptz;

alter table public.sku_completion_plans
  drop constraint if exists sku_completion_plans_status_pembina_check;
alter table public.sku_completion_plans
  add constraint sku_completion_plans_status_pembina_check
  check (status_pembina is null or status_pembina in ('disetujui','perlu_perbaikan'));

drop policy if exists sku_completion_plans_update_reviewer on public.sku_completion_plans;
create policy sku_completion_plans_update_reviewer
on public.sku_completion_plans for update to authenticated
using (private.can_review_student(id_user))
with check (private.can_review_student(id_user) and ditanggapi_oleh = (select auth.uid()));

create or replace function private.guard_sku_completion_plan_review()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() = old.id_user then
    if new.status_pembina is distinct from old.status_pembina
      or new.catatan_pembina is distinct from old.catatan_pembina
      or new.ditanggapi_oleh is distinct from old.ditanggapi_oleh
      or new.ditanggapi_at is distinct from old.ditanggapi_at then
      raise exception 'Kolom tanggapan hanya dapat diubah oleh Pembina.';
    end if;
  elsif private.can_review_student(old.id_user) then
    if new.id_user is distinct from old.id_user
      or new.id_sku_item is distinct from old.id_sku_item
      or new.rencana_kegiatan is distinct from old.rencana_kegiatan
      or new.target_tanggal is distinct from old.target_tanggal
      or new.status is distinct from old.status
      or new.diajukan_at is distinct from old.diajukan_at then
      raise exception 'Pembina hanya dapat mengubah tanggapan rancangan.';
    end if;
  else
    raise exception 'Tidak berwenang mengubah rancangan SKU.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_sku_completion_plan_review on public.sku_completion_plans;
create trigger trg_guard_sku_completion_plan_review
before update on public.sku_completion_plans
for each row execute function private.guard_sku_completion_plan_review();
