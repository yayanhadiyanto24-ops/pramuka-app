alter table public.profil_peserta_didik
  add column if not exists id_kwarran bigint references public.kwarran(id_kwarran) on delete set null;

create index if not exists idx_profil_peserta_didik_kwarran
  on public.profil_peserta_didik(id_kwarran);

update public.pangkalan
set id_kwarran = 20
where id_kwarran is distinct from 20;

update public.profil_pembina pb
set id_kwarran = p.id_kwarran
from public.pangkalan p
where p.id_pangkalan = pb.id_pangkalan
  and pb.id_kwarran is distinct from p.id_kwarran;

update public.profil_peserta_didik pd
set id_kwarran = p.id_kwarran
from public.pangkalan p
where p.id_pangkalan = pd.id_pangkalan
  and pd.id_kwarran is distinct from p.id_kwarran;

create or replace function public.pramuka_register_profile(p_user_id uuid, p_email text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
 v_role public.app_role;
 v_status public.account_status := 'aktif';
 v_pangkalan public.pangkalan%rowtype;
 v_sangga public.pangkalan_sangga%rowtype;
 v_mode text;
 v_jabatan text;
 v_gender text;
 v_kelas text;
 v_tahun text;
 v_tingkatan public.tingkatan_penegak;
 v_id_kwarran bigint;
begin
 if p_user_id is null or nullif(trim(p_email),'') is null then raise exception 'Data akun tidak lengkap'; end if;
 if p_payload->>'role'='peserta_didik' then
  v_role:='peserta_didik'; v_gender:=p_payload->>'jenis_kelamin'; v_kelas:=p_payload->>'kelas_sekolah'; v_tahun:=p_payload->>'tahun_pelajaran';
  if nullif(trim(p_payload->>'nama_lengkap'),'') is null then raise exception 'Nama lengkap wajib diisi'; end if;
  if v_gender not in ('L','P') then raise exception 'Jenis kelamin tidak valid'; end if;
  if v_kelas not in ('X','XI','XII') then raise exception 'Kelas harus X, XI, atau XII'; end if;
  if nullif(trim(p_payload->>'jurusan'),'') is null then raise exception 'Jurusan wajib diisi'; end if;
  if v_tahun !~ '^[0-9]{4}/[0-9]{4}$' or split_part(v_tahun,'/',2)::integer<>split_part(v_tahun,'/',1)::integer+1 then raise exception 'Tahun pelajaran harus berformat YYYY/YYYY'; end if;
  select * into v_pangkalan from public.pangkalan where kode_gabung_peserta=upper(trim(p_payload->>'kode_gabung')) limit 1;
  if v_pangkalan.id_pangkalan is null then raise exception 'Kode gabung pangkalan tidak valid'; end if;
  if v_pangkalan.id_kwarran is null then raise exception 'Pangkalan belum terhubung ke Kwarran. Hubungi Pembina atau Admin Utama.'; end if;
  select * into v_sangga from public.pangkalan_sangga where id_sangga=nullif(p_payload->>'id_sangga','')::bigint and id_pangkalan=v_pangkalan.id_pangkalan and jenis_kelamin=v_gender::public.jenis_kelamin and aktif=true;
  if v_sangga.id_sangga is null then raise exception 'Pilih sangga yang tersedia untuk ambalan Anda'; end if;
  v_tingkatan := 'Peserta Tamu'::public.tingkatan_penegak;
  insert into public.users(id_user,email,role,status_akun) values(p_user_id,lower(trim(p_email)),v_role,v_status);
  insert into public.profil_peserta_didik(id_user,id_pangkalan,id_kwarran,nama_lengkap,jenis_kelamin,nta,tingkatan,sangga,id_sangga,kelas_sekolah,jurusan,tahun_pelajaran,status_keanggotaan)
  values(p_user_id,v_pangkalan.id_pangkalan,v_pangkalan.id_kwarran,trim(p_payload->>'nama_lengkap'),v_gender::public.jenis_kelamin,nullif(trim(p_payload->>'nta'),''),v_tingkatan,v_sangga.nama_sangga,v_sangga.id_sangga,v_kelas,trim(p_payload->>'jurusan'),v_tahun,'aktif');
  perform public.pramuka_tandai_alumni_otomatis();
  return jsonb_build_object('ok',true,'status','aktif','nama_pangkalan',v_pangkalan.nama_pangkalan,'nama_kwarran',(select nama_kwarran from public.kwarran where id_kwarran=v_pangkalan.id_kwarran),'id_kwarran',v_pangkalan.id_kwarran,'nama_ambalan',case when v_gender='L' then v_pangkalan.nama_ambalan_putra else v_pangkalan.nama_ambalan_putri end,'nama_sangga',v_sangga.nama_sangga,'kelas',v_kelas,'tahun_pelajaran',v_tahun,'tingkatan',v_tingkatan);
 elsif p_payload->>'role'='pembina' then
  v_role:='pembina'; v_mode:=p_payload->>'mode'; v_gender:=p_payload->>'jenis_kelamin'; v_jabatan:=p_payload->>'jabatan';
  v_id_kwarran:=nullif(p_payload->>'id_kwarran','')::bigint;
  if v_id_kwarran is null or not exists(select 1 from public.kwarran where id_kwarran=v_id_kwarran) then raise exception 'Pilih Kwarran pada formulir pendaftaran.'; end if;
  if not ((v_gender='L' and v_jabatan='Pembina Satuan Putera') or (v_gender='P' and v_jabatan='Pembina Satuan Puteri')) then raise exception 'Akun Pembina harus sesuai jenis satuannya: Putera atau Puteri'; end if;
  if v_mode='baru' then
   insert into public.pangkalan(nama_pangkalan,no_gudep,nama_ambalan_putra,nama_ambalan_putri,id_kwarran) values(trim(p_payload->>'nama_pangkalan'),nullif(trim(p_payload->>'no_gudep'),''),trim(p_payload->>'nama_ambalan_putra'),trim(p_payload->>'nama_ambalan_putri'),v_id_kwarran) returning * into v_pangkalan;
  elsif v_mode='gabung' then
   select * into v_pangkalan from public.pangkalan where kode_gabung_peserta=upper(trim(p_payload->>'kode_gabung')) limit 1;
   if v_pangkalan.id_pangkalan is null then raise exception 'Kode gabung pangkalan tidak valid'; end if;
   if v_pangkalan.id_kwarran is distinct from v_id_kwarran then raise exception 'Kwarran yang dipilih tidak sesuai dengan Kwarran pangkalan pada kode gabung.'; end if;
  else raise exception 'Mode pendaftaran pembina tidak valid'; end if;
  insert into public.users(id_user,email,role,status_akun) values(p_user_id,lower(trim(p_email)),v_role,v_status);
  insert into public.profil_pembina(id_user,id_pangkalan,id_kwarran,nama_lengkap,jenis_kelamin,jabatan,is_admin_pangkalan) values(p_user_id,v_pangkalan.id_pangkalan,v_pangkalan.id_kwarran,trim(p_payload->>'nama_lengkap'),v_gender::public.jenis_kelamin,v_jabatan::public.jabatan_pembina,false);
  return jsonb_build_object('ok',true,'status','aktif','nama_pangkalan',v_pangkalan.nama_pangkalan,'nama_kwarran',(select nama_kwarran from public.kwarran where id_kwarran=v_pangkalan.id_kwarran),'id_kwarran',v_pangkalan.id_kwarran,'kode_gabung_pangkalan',case when v_mode='baru' then v_pangkalan.kode_gabung_peserta else null end);
 else raise exception 'Peran pendaftaran tidak dikenal'; end if;
end;
$function$;
