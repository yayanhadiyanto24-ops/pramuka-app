-- Add Kwarran identity to Pembina profiles.
ALTER TABLE public.profil_pembina
  ADD COLUMN IF NOT EXISTS id_kwarran bigint
  REFERENCES public.kwarran(id_kwarran) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profil_pembina_id_kwarran_idx
  ON public.profil_pembina(id_kwarran);
