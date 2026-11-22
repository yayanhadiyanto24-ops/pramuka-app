create unique index if not exists uq_peserta_nta_normalized
on public.profil_peserta_didik (upper(regexp_replace(trim(nta), '\\s+', '', 'g')))
where nullif(trim(nta), '') is not null;
