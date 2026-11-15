-- Admin tunggal, registrasi melalui RPC tepercaya, dan rekap ambalan.
create table if not exists public.app_admin_config (
  singleton boolean primary key default true check (singleton),
  admin_email text,
  updated_at timestamptz not null default now()
);
insert into public.app_admin_config(singleton, admin_email) values (true, null) on conflict (singleton) do nothing;
alter table public.app_admin_config enable row level security;

create or replace function public.pramuka_register_profile(p_user_id uuid, p_email text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role public.app_role;
  v_status public.account_status := 'pending';
  v_pangkalan_id bigint;
  v_pangkalan public.pangkalan%rowtype;
  v_mode text;
begin
  if p_user_id is null or nullif(trim(p_email), '') is null then raise exception 'Data akun tidak lengkap'; end if;
  if p_payload->>'role' = 'peserta_didik' then
    v_role := 'peserta_didik';
    select * into v_pangkalan from public.pangkalan where kode_gabung_peserta = upper(trim(p_payload->>'kode_gabung')) limit 1;
    if v_pangkalan.id_pangkalan is null then raise exception 'Kode gabung peserta tidak valid'; end if;
    insert into public.users(id_user,email,role,status_akun) values (p_user_id,lower(trim(p_email)),v_role,v_status);
    insert into public.profil_peserta_didik(id_user,id_pangkalan,nama_lengkap,jenis_kelamin,tingkatan)
    values (p_user_id,v_pangkalan.id_pangkalan,trim(p_payload->>'nama_lengkap'),(p_payload->>'jenis_kelamin')::public.jenis_kelamin,(p_payload->>'tingkatan')::public.tingkatan_penegak);
    return jsonb_build_object('ok',true,'status','pending','nama_pangkalan',v_pangkalan.nama_pangkalan,'nama_ambalan',case when p_payload->>'jenis_kelamin'='L' then v_pangkalan.nama_ambalan_putra else v_pangkalan.nama_ambalan_putri end);
  elsif p_payload->>'role' = 'pembina' then
    v_role := 'pembina'; v_mode := p_payload->>'mode';
    if v_mode = 'baru' then
      insert into public.pangkalan(nama_pangkalan,no_gudep,nama_ambalan_putra,nama_ambalan_putri)
      values (trim(p_payload->>'nama_pangkalan'),nullif(trim(p_payload->>'no_gudep'),''),trim(p_payload->>'nama_ambalan_putra'),trim(p_payload->>'nama_ambalan_putri')) returning * into v_pangkalan;
    elsif v_mode = 'gabung' then
      select * into v_pangkalan from public.pangkalan where kode_gabung_pembina=upper(trim(p_payload->>'kode_gabung')) limit 1;
      if v_pangkalan.id_pangkalan is null then raise exception 'Kode gabung pembina tidak valid'; end if;
    else raise exception 'Mode pendaftaran pembina tidak valid'; end if;
    insert into public.users(id_user,email,role,status_akun) values (p_user_id,lower(trim(p_email)),v_role,v_status);
    insert into public.profil_pembina(id_user,id_pangkalan,nama_lengkap,jenis_kelamin,jabatan,is_admin_pangkalan)
    values (p_user_id,v_pangkalan.id_pangkalan,trim(p_payload->>'nama_lengkap'),(p_payload->>'jenis_kelamin')::public.jenis_kelamin,(p_payload->>'jabatan')::public.jabatan_pembina,false);
    return jsonb_build_object('ok',true,'status','pending','nama_pangkalan',v_pangkalan.nama_pangkalan,'kode_gabung_peserta',case when v_mode='baru' then v_pangkalan.kode_gabung_peserta else null end,'kode_gabung_pembina',case when v_mode='baru' then v_pangkalan.kode_gabung_pembina else null end);
  else raise exception 'Peran pendaftaran tidak dikenal'; end if;
end; $$;
revoke all on function public.pramuka_register_profile(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.pramuka_register_profile(uuid,text,jsonb) to service_role;

create or replace view public.v_admin_ambalan_rekap with (security_invoker=true) as
select p.id_pangkalan,p.nama_pangkalan,p.no_gudep,a.jenis_kelamin,a.nama_ambalan,
 count(pd.id_peserta)::integer as jumlah_peserta,
 count(pd.id_peserta) filter(where u.status_akun='aktif')::integer as peserta_aktif,
 count(pd.id_peserta) filter(where u.status_akun='pending')::integer as menunggu_persetujuan,
 count(pd.id_peserta) filter(where pd.tingkatan='Calon Penegak')::integer as calon_penegak,
 count(pd.id_peserta) filter(where pd.tingkatan='Bantara')::integer as bantara,
 count(pd.id_peserta) filter(where pd.tingkatan='Laksana')::integer as laksana,
 count(pd.id_peserta) filter(where pd.tingkatan='Garuda')::integer as garuda,
 count(distinct pd.sangga) filter(where pd.sangga is not null and pd.sangga<>'')::integer as jumlah_sangga
from public.pangkalan p cross join lateral(values('L'::public.jenis_kelamin,p.nama_ambalan_putra),('P'::public.jenis_kelamin,p.nama_ambalan_putri)) a(jenis_kelamin,nama_ambalan)
left join public.profil_peserta_didik pd on pd.id_pangkalan=p.id_pangkalan and pd.jenis_kelamin=a.jenis_kelamin
left join public.users u on u.id_user=pd.id_user
group by p.id_pangkalan,p.nama_pangkalan,p.no_gudep,a.jenis_kelamin,a.nama_ambalan;
revoke all on public.v_admin_ambalan_rekap from anon,authenticated;
grant select on public.v_admin_ambalan_rekap to service_role;