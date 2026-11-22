create or replace function public.pembina_update_pangkalan_with_audit(
  p_id_pangkalan bigint,
  p_actor_user_id uuid,
  p_patch jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_before jsonb;
begin
  if p_id_pangkalan is null or p_actor_user_id is null
     or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Data perubahan pangkalan tidak valid.';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_patch) as key_name
    where key_name not in (
      'nama_pangkalan','no_gudep','nama_ambalan_putra','nama_ambalan_putri',
      'nama_ketua_gudep','nama_ketua_mabigus','struktur_gudep'
    )
  ) then
    raise exception 'Kolom perubahan pangkalan tidak diizinkan.';
  end if;

  if not exists (
    select 1
    from public.profil_pembina pb
    join public.users u on u.id_user = pb.id_user
    where pb.id_user = p_actor_user_id
      and pb.id_pangkalan = p_id_pangkalan
      and u.role::text = 'pembina'
      and u.status_akun::text = 'aktif'
  ) then
    raise exception 'Pembina tidak berwenang mengubah pangkalan ini.';
  end if;

  select jsonb_build_object(
    'nama_pangkalan', p.nama_pangkalan,
    'no_gudep', p.no_gudep,
    'nama_ambalan_putra', p.nama_ambalan_putra,
    'nama_ambalan_putri', p.nama_ambalan_putri,
    'nama_ketua_gudep', p.nama_ketua_gudep,
    'nama_ketua_mabigus', p.nama_ketua_mabigus,
    'struktur_gudep', p.struktur_gudep
  )
  into v_before
  from public.pangkalan p
  where p.id_pangkalan = p_id_pangkalan
  for update;

  if not found then
    raise exception 'Pangkalan tidak ditemukan.';
  end if;

  update public.pangkalan p
  set
    nama_pangkalan = case when p_patch ? 'nama_pangkalan' then p_patch->>'nama_pangkalan' else p.nama_pangkalan end,
    no_gudep = case when p_patch ? 'no_gudep' then p_patch->>'no_gudep' else p.no_gudep end,
    nama_ambalan_putra = case when p_patch ? 'nama_ambalan_putra' then p_patch->>'nama_ambalan_putra' else p.nama_ambalan_putra end,
    nama_ambalan_putri = case when p_patch ? 'nama_ambalan_putri' then p_patch->>'nama_ambalan_putri' else p.nama_ambalan_putri end,
    nama_ketua_gudep = case when p_patch ? 'nama_ketua_gudep' then p_patch->>'nama_ketua_gudep' else p.nama_ketua_gudep end,
    nama_ketua_mabigus = case when p_patch ? 'nama_ketua_mabigus' then p_patch->>'nama_ketua_mabigus' else p.nama_ketua_mabigus end,
    struktur_gudep = case when p_patch ? 'struktur_gudep' then p_patch->'struktur_gudep' else p.struktur_gudep end
  where p.id_pangkalan = p_id_pangkalan;

  insert into public.pangkalan_change_audit (
    id_pangkalan, changed_by, before_data, after_data
  ) values (
    p_id_pangkalan, p_actor_user_id, v_before, p_patch
  );
end;
$function$;

revoke all on function public.pembina_update_pangkalan_with_audit(bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pembina_update_pangkalan_with_audit(bigint, uuid, jsonb) to service_role;
