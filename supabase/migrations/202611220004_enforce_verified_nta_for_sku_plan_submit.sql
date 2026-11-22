drop policy if exists sku_completion_plans_insert_self on public.sku_completion_plans;
create policy sku_completion_plans_insert_self
on public.sku_completion_plans for insert to authenticated
with check (
  id_user = (select auth.uid())
  and (select private.is_active_role('peserta_didik'::text))
  and status in ('rancangan','diajukan')
  and (
    status = 'rancangan'
    or exists (
      select 1
      from public.profil_peserta_didik pp
      join public.sku_items si on si.id_sku_item = sku_completion_plans.id_sku_item
      where pp.id_user = sku_completion_plans.id_user
        and nullif(trim(pp.nta),'') is not null
        and pp.nta_bukti_kta is not null
        and pp.nta_bukti_kta <> '{}'::jsonb
        and pp.nta_status_verifikasi in ('disetujui_pembina','terverifikasi_resmi')
        and not (pp.tingkatan::text = 'Bantara' and si.tingkat = 'Bantara')
    )
  )
);

drop policy if exists sku_completion_plans_update_self on public.sku_completion_plans;
create policy sku_completion_plans_update_self
on public.sku_completion_plans for update to authenticated
using (
  id_user = (select auth.uid())
  and (select private.is_active_role('peserta_didik'::text))
)
with check (
  id_user = (select auth.uid())
  and (select private.is_active_role('peserta_didik'::text))
  and status in ('rancangan','diajukan')
  and (
    status = 'rancangan'
    or exists (
      select 1
      from public.profil_peserta_didik pp
      join public.sku_items si on si.id_sku_item = sku_completion_plans.id_sku_item
      where pp.id_user = sku_completion_plans.id_user
        and nullif(trim(pp.nta),'') is not null
        and pp.nta_bukti_kta is not null
        and pp.nta_bukti_kta <> '{}'::jsonb
        and pp.nta_status_verifikasi in ('disetujui_pembina','terverifikasi_resmi')
        and not (pp.tingkatan::text = 'Bantara' and si.tingkat = 'Bantara')
    )
  )
);
