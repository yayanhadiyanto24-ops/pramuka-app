-- Secure, atomic Pembina review and sign-off for direct and delegated SKU assessments.
create or replace function private.can_review_student_for(p_reviewer_user_id uuid, p_student_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profil_pembina pb
    join public.users pu on pu.id_user = pb.id_user
    join public.profil_peserta_didik pd on pd.id_pangkalan = pb.id_pangkalan
    join public.users su on su.id_user = pd.id_user
    where pb.id_user = p_reviewer_user_id
      and pd.id_user = p_student_user_id
      and pu.role::text = 'pembina'
      and pu.status_akun::text = 'aktif'
      and su.role::text = 'peserta_didik'
      and su.status_akun::text = 'aktif'
      and (
        pb.jabatan::text in ('Kamabigus', 'Pembina Gudep')
        or (pb.jabatan::text = 'Pembina Satuan Putera' and pd.jenis_kelamin::text = 'L')
        or (pb.jabatan::text = 'Pembina Satuan Puteri' and pd.jenis_kelamin::text = 'P')
      )
  );
$function$;

create or replace function private.can_review_student(p_student_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null
     and private.can_review_student_for(auth.uid(), p_student_user_id);
$function$;

create or replace function public.pembina_signoff_sku_progress(
  p_reviewer_user_id uuid,
  p_student_user_id uuid,
  p_target_type text,
  p_progress_id bigint,
  p_note text,
  p_paraf_data text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role text;
  v_status text;
  v_student_id uuid;
  v_teacher_name text;
  v_now timestamptz := now();
begin
  select u.role::text into v_role
  from public.users u
  where u.id_user = p_reviewer_user_id and u.status_akun::text = 'aktif';

  if v_role is null or v_role not in ('pembina', 'admin_utama') then
    raise exception 'Akun tidak berwenang mengesahkan SKU.';
  end if;

  if v_role = 'pembina' and not private.can_review_student_for(p_reviewer_user_id, p_student_user_id) then
    raise exception 'Peserta bukan dalam cakupan binaan Anda.';
  end if;

  if p_paraf_data is null
     or p_paraf_data not like 'data:image/png;base64,%'
     or length(p_paraf_data) > 120000 then
    raise exception 'Paraf Pembina belum tersedia atau formatnya tidak valid.';
  end if;

  select pb.nama_lengkap into v_teacher_name
  from public.profil_pembina pb
  where pb.id_user = p_reviewer_user_id;

  if v_role = 'admin_utama' then
    v_teacher_name := coalesce(v_teacher_name, 'Admin Utama');
  elsif v_teacher_name is null then
    raise exception 'Profil Pembina tidak ditemukan.';
  end if;

  if p_target_type = 'butir' then
    select lp.id_user, lp.status into v_student_id, v_status
    from public.sku_learning_progress lp
    where lp.id_progress = p_progress_id
    for update;

    if v_student_id is null or v_student_id <> p_student_user_id then
      raise exception 'Progres butir SKU tidak ditemukan untuk peserta ini.';
    end if;
    if v_status not in ('siap_diuji', 'perlu_perbaikan') then
      raise exception 'Butir belum diajukan untuk penilaian atau sudah lulus.';
    end if;

    update public.sku_learning_progress
    set status = 'lulus',
        catatan_pembina = coalesce(nullif(btrim(p_note), ''), 'Dinyatakan lulus dan disahkan Pembina.'),
        diperiksa_oleh = p_reviewer_user_id,
        diperiksa_at = v_now,
        paraf_pembina_data = p_paraf_data,
        nama_pembina_pengesah = v_teacher_name
    where id_progress = p_progress_id;
  elsif p_target_type = 'subpoin' then
    select sp.id_user, sp.status into v_student_id, v_status
    from public.sku_subpoint_progress sp
    where sp.id_subpoint_progress = p_progress_id
    for update;

    if v_student_id is null or v_student_id <> p_student_user_id then
      raise exception 'Progres subpoin SKU tidak ditemukan untuk peserta ini.';
    end if;
    if v_status not in ('siap_diuji', 'perlu_perbaikan') then
      raise exception 'Subpoin belum diajukan untuk penilaian atau sudah lulus.';
    end if;

    update public.sku_subpoint_progress
    set status = 'lulus',
        catatan_pembina = coalesce(nullif(btrim(p_note), ''), 'Dinyatakan lulus dan disahkan Pembina.'),
        diperiksa_oleh = p_reviewer_user_id,
        diperiksa_at = v_now,
        paraf_pembina_data = p_paraf_data,
        nama_pembina_pengesah = v_teacher_name,
        updated_at = v_now
    where id_subpoint_progress = p_progress_id;
  else
    raise exception 'Jenis target SKU tidak dikenal.';
  end if;

  return jsonb_build_object('ok', true, 'message', 'Butir SKU berhasil dinyatakan lulus dan diparaf Pembina.', 'status', 'lulus');
end;
$function$;

create or replace function public.pembina_review_sku_exam_referral(
  p_reviewer_user_id uuid,
  p_referral_id uuid,
  p_decision text,
  p_note text,
  p_paraf_data text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role text;
  v_ref public.sku_exam_referrals%rowtype;
  v_teacher_name text;
  v_now timestamptz := now();
  v_next_status text;
begin
  select u.role::text into v_role
  from public.users u
  where u.id_user = p_reviewer_user_id and u.status_akun::text = 'aktif';

  if v_role is null or v_role not in ('pembina', 'admin_utama') then
    raise exception 'Akun tidak berwenang memeriksa hasil ujian.';
  end if;

  select * into v_ref
  from public.sku_exam_referrals
  where id = p_referral_id
  for update;

  if not found or v_ref.status <> 'selesai'
     or v_ref.pembina_review_status not in ('menunggu', 'belum_selesai') then
    raise exception 'Hasil penguji belum tersedia atau sudah ditanggapi.';
  end if;

  if v_role = 'pembina'
     and not private.can_review_student_for(p_reviewer_user_id, v_ref.id_user) then
    raise exception 'Peserta bukan dalam cakupan binaan Anda.';
  end if;

  if p_decision not in ('selesai', 'belum_selesai') then
    raise exception 'Keputusan Pembina tidak dikenal.';
  end if;

  if p_decision = 'selesai' then
    if v_ref.result <> 'lulus' then
      raise exception 'Hasil penguji bukan LULUS. Pembina tidak dapat mengesahkannya sebagai kelulusan.';
    end if;
    if p_paraf_data is null
       or p_paraf_data not like 'data:image/png;base64,%'
       or length(p_paraf_data) > 120000 then
      raise exception 'Paraf Pembina wajib tersedia untuk mengesahkan kelulusan.';
    end if;
  end if;

  select pb.nama_lengkap into v_teacher_name
  from public.profil_pembina pb
  where pb.id_user = p_reviewer_user_id;

  if v_role = 'admin_utama' then
    v_teacher_name := coalesce(v_teacher_name, 'Admin Utama');
  elsif v_teacher_name is null then
    raise exception 'Profil Pembina tidak ditemukan.';
  end if;

  v_next_status := case when p_decision = 'selesai' then 'lulus' else 'perlu_perbaikan' end;

  update public.sku_exam_referrals
  set pembina_review_status = p_decision,
      pembina_review_note = nullif(btrim(p_note), ''),
      pembina_paraf_data = case when p_decision = 'selesai' then p_paraf_data else null end,
      pembina_reviewed_by = p_reviewer_user_id,
      pembina_reviewed_at = v_now
  where id = v_ref.id;

  if v_ref.id_subpoint_progress is not null then
    update public.sku_subpoint_progress
    set status = v_next_status,
        catatan_pembina = coalesce(nullif(btrim(p_note), ''), case when v_next_status = 'lulus' then 'Hasil penguji diperiksa dan disahkan Pembina.' else 'Hasil penguji belum disahkan; peserta perlu perbaikan.' end),
        diperiksa_oleh = p_reviewer_user_id,
        diperiksa_at = v_now,
        paraf_pembina_data = case when v_next_status = 'lulus' then p_paraf_data else null end,
        nama_pembina_pengesah = case when v_next_status = 'lulus' then v_teacher_name else null end,
        updated_at = v_now
    where id_subpoint_progress = v_ref.id_subpoint_progress;
  elsif v_ref.id_progress is not null then
    update public.sku_learning_progress
    set status = v_next_status,
        catatan_pembina = coalesce(nullif(btrim(p_note), ''), case when v_next_status = 'lulus' then 'Hasil penguji diperiksa dan disahkan Pembina.' else 'Hasil penguji belum disahkan; peserta perlu perbaikan.' end),
        diperiksa_oleh = p_reviewer_user_id,
        diperiksa_at = v_now,
        paraf_pembina_data = case when v_next_status = 'lulus' then p_paraf_data else null end,
        nama_pembina_pengesah = case when v_next_status = 'lulus' then v_teacher_name else null end
    where id_progress = v_ref.id_progress;
  else
    raise exception 'Referensi progres SKU pada surat pengantar tidak ditemukan.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'message', case when v_next_status = 'lulus' then 'Hasil penguji disahkan Pembina dan progres SKU dinyatakan lulus.' else 'Hasil penguji ditanggapi. Progres peserta perlu perbaikan.' end,
    'progress_status', v_next_status
  );
end;
$function$;

revoke all on function public.pembina_signoff_sku_progress(uuid,uuid,text,bigint,text,text) from public, anon, authenticated;
revoke all on function public.pembina_review_sku_exam_referral(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.pembina_signoff_sku_progress(uuid,uuid,text,bigint,text,text) to service_role;
grant execute on function public.pembina_review_sku_exam_referral(uuid,uuid,text,text,text) to service_role;
