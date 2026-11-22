create or replace function public.pembina_review_nta(p_student_user_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_status not in ('disetujui_pembina','ditolak') then
    raise exception 'Permintaan verifikasi tidak valid.';
  end if;
  if not private.can_review_student(p_student_user_id) then
    raise exception 'Anda tidak berwenang memeriksa peserta ini.';
  end if;
  update public.profil_peserta_didik
     set nta_status_verifikasi = p_status
   where id_user = p_student_user_id
     and nta is not null
     and nta_bukti_kta is not null
     and nta_bukti_kta <> '{}'::jsonb;
  if not found then
    raise exception 'Data NTA atau bukti KTA peserta belum lengkap.';
  end if;
end;
$$;
revoke all on function public.pembina_review_nta(uuid,text) from public;
grant execute on function public.pembina_review_nta(uuid,text) to authenticated;
