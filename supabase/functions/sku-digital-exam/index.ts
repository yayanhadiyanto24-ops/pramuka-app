import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const clean = (v: unknown, max = 180) => typeof v === "string" ? v.trim().slice(0, max) : "";
const hex = (bytes: Uint8Array) => Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
const makeToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const hashToken = async (token: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ ok: false, message: "Metode tidak didukung." }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !secret) return reply({ ok: false, message: "Konfigurasi server belum lengkap." }, 500);
  const db = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const body = await req.json();
    const action = clean(body.action, 30);

    if (action === "create_referral") {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!jwt) return reply({ ok: false, message: "Silakan login sebagai Pembina." }, 401);
      const { data: auth, error: authError } = await db.auth.getUser(jwt);
      if (authError || !auth.user) return reply({ ok: false, message: "Sesi login tidak valid." }, 401);

      const { data: actor, error: actorError } = await db.from("users")
        .select("role,status_akun").eq("id_user", auth.user.id).maybeSingle();
      if (actorError || !actor || actor.status_akun !== "aktif" || !["pembina", "admin_utama"].includes(actor.role)) {
        return reply({ ok: false, message: "Pembuatan surat hanya untuk Pembina aktif atau Admin Utama." }, 403);
      }

      const studentId = clean(body.student_id, 50);
      const expectedExaminer = clean(body.examiner_name, 150);
      const expectedInstitution = clean(body.examiner_institution, 150);
      const scheduleNote = clean(body.schedule_note, 500);
      const scheduledAtRaw = clean(body.scheduled_at, 50);
      const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
      if (!scheduledAt || !Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now() || scheduledAt.getTime() > Date.now() + 90 * 24 * 60 * 60 * 1000) {
        return reply({ ok: false, message: "Jadwal ujian wajib diisi, harus di masa depan, dan maksimal 90 hari." }, 400);
      }
      if (expectedExaminer.length < 2) return reply({ ok: false, message: "Nama penguji wajib diisi pada surat pengantar." }, 400);
      const skuId = Number(body.sku_item_id);
      if (!studentId || !Number.isSafeInteger(skuId) || skuId <= 0) {
        return reply({ ok: false, message: "Peserta dan butir SKU wajib dipilih." }, 400);
      }

      const { data: student, error: studentError } = await db.from("profil_peserta_didik")
        .select("id_user,id_pangkalan,jenis_kelamin,nama_lengkap,tingkatan,sangga,nta")
        .eq("id_user", studentId).maybeSingle();
      if (studentError || !student) return reply({ ok: false, message: "Data peserta didik tidak ditemukan." }, 404);
      if (!student.nta || !student.nta.trim()) return reply({ ok: false, message: "Peserta harus melengkapi NTA/KTA Pramuka Nasional sebelum mengajukan pengujian SKU." }, 403);

      if (actor.role === "pembina") {
        const { data: pembina } = await db.from("profil_pembina")
          .select("id_pangkalan,jabatan").eq("id_user", auth.user.id).maybeSingle();
        if (!pembina || pembina.id_pangkalan !== student.id_pangkalan) {
          return reply({ ok: false, message: "Peserta bukan dari pangkalan binaan Anda." }, 403);
        }
        if ((pembina.jabatan === "Pembina Satuan Putera" && student.jenis_kelamin !== "L") ||
            (pembina.jabatan === "Pembina Satuan Puteri" && student.jenis_kelamin !== "P")) {
          return reply({ ok: false, message: "Peserta berada di luar kewenangan satuan binaan Anda." }, 403);
        }
      }

      const { data: sku, error: skuError } = await db.from("sku_items")
        .select("id_sku_item,aktif").eq("id_sku_item", skuId).maybeSingle();
      if (skuError || !sku || !sku.aktif) return reply({ ok: false, message: "Butir SKU tidak aktif atau tidak ditemukan." }, 404);

      const subpointId = Number(body.subpoint_id || 0);
      let progress: any = null;
      let progressTable = "sku_learning_progress";
      if (subpointId > 0) {
        const { data: subpoint, error: subpointError } = await db.from("sku_subpoints")
          .select("id_subpoint,id_sku_item,kode_subpoint,judul_subpoint,persyaratan,status_publikasi")
          .eq("id_subpoint", subpointId).eq("id_sku_item", skuId).maybeSingle();
        if (subpointError) throw subpointError;
        if (!subpoint || subpoint.status_publikasi !== "terbit") return reply({ ok: false, message: "Subpoin SKU tidak ditemukan atau belum diterbitkan." }, 404);
        const { data, error } = await db.from("sku_subpoint_progress")
          .select("id_subpoint_progress,status").eq("id_user", studentId).eq("id_subpoint", subpointId).maybeSingle();
        if (error) throw error;
        progress = data;
        progressTable = "sku_subpoint_progress";
      } else {
        const { data, error } = await db.from("sku_learning_progress")
          .select("id_progress,status").eq("id_user", studentId).eq("id_sku_item", skuId).maybeSingle();
        if (error) throw error;
        progress = data;
      }
      if (!progress || !["siap_diuji", "perlu_perbaikan"].includes(progress.status)) {
        return reply({ ok: false, message: "Peserta harus menyelesaikan dan mengajukan subpoin/butir ini untuk diuji terlebih dahulu." }, 409);
      }

      const token = makeToken();
      const tokenHash = await hashToken(token);
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const random = new Uint8Array(4);
      crypto.getRandomValues(random);
      const referralNo = "SKU/" + new Date().getFullYear() + "/" + hex(random).toUpperCase();
      const { data: created, error: insertError } = await db.from("sku_exam_referrals").insert({
        referral_no: referralNo,
        id_user: studentId,
        id_sku_item: skuId,
        id_progress: progressTable === "sku_learning_progress" ? progress.id_progress : null,
        id_subpoint: subpointId > 0 ? subpointId : null,
        id_subpoint_progress: progressTable === "sku_subpoint_progress" ? progress.id_subpoint_progress : null,
        dibuat_oleh: auth.user.id,
        examiner_expected_name: expectedExaminer,
        examiner_expected_institution: expectedInstitution || null,
        scheduled_at: scheduledAt.toISOString(),
        schedule_note: scheduleNote || null,
        berlaku_sampai: expires,
        token_hash: tokenHash,
        token_value: token
      }).select("id,referral_no,berlaku_sampai").single();
      if (insertError) throw insertError;

      const examUrl = "https://yayanhadiyanto24-ops.github.io/pramuka-app/uji.html#t=" + encodeURIComponent(token);
      return reply({ ok: true, referral: created, exam_url: examUrl, message: "Surat pengantar digital berhasil dibuat." });
    }

    if (action === "review_exam" || action === "review_direct") {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!jwt) return reply({ ok: false, message: "Silakan login sebagai Pembina." }, 401);
      const { data: auth, error: authError } = await db.auth.getUser(jwt);
      if (authError || !auth.user) return reply({ ok: false, message: "Sesi login tidak valid." }, 401);
      const { data: actor, error: actorError } = await db.from("users")
        .select("role,status_akun").eq("id_user", auth.user.id).maybeSingle();
      if (actorError || !actor || actor.status_akun !== "aktif" || !["pembina", "admin_utama"].includes(actor.role)) {
        return reply({ ok: false, message: "Akses pengesahan hanya untuk Pembina aktif atau Admin Utama." }, 403);
      }

      const note = clean(body.note, 2000);
      const paraf = typeof body.paraf_data === "string" ? body.paraf_data : "";

      if (action === "review_exam") {
        const referralId = clean(body.referral_id, 50);
        const decision = clean(body.decision, 30);
        if (!referralId || !["selesai", "belum_selesai"].includes(decision)) {
          return reply({ ok: false, message: "Surat pengantar dan keputusan Pembina wajib dipilih." }, 400);
        }
        if (decision === "selesai" && (!paraf.startsWith("data:image/png;base64,") || paraf.length > 120000)) {
          return reply({ ok: false, message: "Simpan paraf Pembina pada profil sebelum mengesahkan kelulusan." }, 400);
        }
        const { data, error } = await db.rpc("pembina_review_sku_exam_referral", {
          p_reviewer_user_id: auth.user.id,
          p_referral_id: referralId,
          p_decision: decision,
          p_note: note,
          p_paraf_data: paraf
        });
        if (error) return reply({ ok: false, message: error.message || "Tanggapan Pembina gagal disimpan." }, 409);
        return reply(data || { ok: true, message: "Tanggapan Pembina tersimpan." });
      }

      const studentId = clean(body.student_id, 50);
      const targetType = clean(body.target_type, 20);
      const progressId = Number(body.progress_id);
      if (!studentId || !["butir", "subpoin"].includes(targetType) || !Number.isSafeInteger(progressId) || progressId <= 0) {
        return reply({ ok: false, message: "Peserta dan butir/subpoin SKU wajib dipilih." }, 400);
      }
      const { data, error } = await db.rpc("pembina_signoff_sku_progress", {
        p_reviewer_user_id: auth.user.id,
        p_student_user_id: studentId,
        p_target_type: targetType,
        p_progress_id: progressId,
        p_note: note,
        p_paraf_data: paraf
      });
      if (error) return reply({ ok: false, message: error.message || "Pengesahan SKU gagal disimpan." }, 409);
      return reply(data || { ok: true, message: "Kelulusan SKU berhasil disahkan Pembina." });
    }

    const token = clean(body.token, 100);
    if (!token || token.length < 40) return reply({ ok: false, message: "Kode ujian tidak valid." }, 400);
    const tokenHash = await hashToken(token);
    const { data: referral, error: referralError } = await db.from("sku_exam_referrals")
      .select("id,referral_no,id_user,id_sku_item,id_progress,id_subpoint,id_subpoint_progress,dibuat_oleh,berlaku_sampai,scheduled_at,schedule_note,status,token_used_at,examiner_expected_name,examiner_expected_institution")
      .eq("token_hash", tokenHash).maybeSingle();
    if (referralError) throw referralError;
    if (!referral) return reply({ ok: false, message: "Surat tidak ditemukan atau tautan tidak valid." }, 404);
    if (referral.status !== "menunggu" || referral.token_used_at) {
      return reply({ ok: false, message: "Tautan ujian sudah digunakan atau tidak lagi aktif." }, 410);
    }
    if (["get_exam", "submit_exam"].includes(action)) {
      const { data: member, error: memberError } = await db.from("profil_peserta_didik").select("nta").eq("id_user", referral.id_user).maybeSingle();
      if (memberError) throw memberError;
      if (!member?.nta || !member.nta.trim()) return reply({ ok: false, message: "Pengujian tidak dapat dilanjutkan sebelum NTA/KTA Pramuka Nasional dilengkapi." }, 403);
    }

    if (new Date(referral.berlaku_sampai).getTime() <= Date.now()) {
      await db.from("sku_exam_referrals").update({ status: "kedaluwarsa" }).eq("id", referral.id).eq("status", "menunggu");
      return reply({ ok: false, message: "Masa berlaku surat ujian telah habis." }, 410);
    }

    if (action === "get_exam") {
      const [{ data: student, error: studentError }, { data: sku, error: skuError }, { data: pangkalan, error: pangkalanError }] = await Promise.all([
        db.from("profil_peserta_didik").select("nama_lengkap,tingkatan,sangga,jenis_kelamin,id_pangkalan").eq("id_user", referral.id_user).single(),
        db.from("sku_items").select("tingkat,kode_butir,nomor_butir,judul_butir,persyaratan,kriteria_pencapaian").eq("id_sku_item", referral.id_sku_item).single(),
        db.from("profil_peserta_didik").select("pangkalan(nama_pangkalan,nama_ambalan_putra,nama_ambalan_putri)").eq("id_user", referral.id_user).single()
      ]);
      if (studentError || skuError || pangkalanError || !student || !sku) throw new Error("Data surat tidak lengkap.");
      let subpoint = null;
      if (referral.id_subpoint) {
        const { data, error } = await db.from("sku_subpoints").select("id_subpoint,kode_subpoint,judul_subpoint,persyaratan,materi_markdown").eq("id_subpoint", referral.id_subpoint).single();
        if (error) throw error;
        subpoint = data;
      }
      const p = (pangkalan as any)?.pangkalan;
      const ambalan = student.jenis_kelamin === "L" ? p?.nama_ambalan_putra : p?.nama_ambalan_putri;
      return reply({
        ok: true,
        referral: { referral_no: referral.referral_no, berlaku_sampai: referral.berlaku_sampai, scheduled_at: referral.scheduled_at, schedule_note: referral.schedule_note, examiner_expected_name: referral.examiner_expected_name, examiner_expected_institution: referral.examiner_expected_institution },
        student: { nama_lengkap: student.nama_lengkap, tingkatan: student.tingkatan, sangga: student.sangga, nama_pangkalan: p?.nama_pangkalan, nama_ambalan: ambalan },
        sku,
        subpoint
      });
    }

    if (action === "submit_exam") {
      const examinerName = clean(body.examiner_name, 150);
      const institution = clean(body.examiner_institution, 150);
      if (referral.examiner_expected_name && examinerName.toLowerCase() !== referral.examiner_expected_name.toLowerCase()) return reply({ ok: false, message: "Nama penguji tidak sesuai dengan identitas pada surat pengantar. Minta Pembina memperbaiki surat jika ada kekeliruan." }, 403);
      const result = clean(body.result, 20);
      const notes = clean(body.notes, 2000);
      const signature = typeof body.signature_data === "string" ? body.signature_data : "";
      if (examinerName.length < 2 || !["lulus", "tidak_lulus"].includes(result) ||
          !signature.startsWith("data:image/png;base64,") || signature.length > 280000) {
        return reply({ ok: false, message: "Nama penguji, hasil ujian, dan tanda tangan wajib diisi." }, 400);
      }

      const signedAt = new Date().toISOString();
      const { data: saved, error: saveError } = await db.from("sku_exam_referrals").update({
        status: "selesai",
        token_used_at: signedAt,
        examiner_name: examinerName,
        examiner_institution: institution || null,
        pembina_review_status: "menunggu",
        result,
        examiner_notes: notes || null,
        signature_data: signature,
        signed_at: signedAt
      }).eq("id", referral.id).eq("status", "menunggu").is("token_used_at", null)
        .gt("berlaku_sampai", signedAt)
        .select("id,referral_no,id_progress").maybeSingle();
      if (saveError) throw saveError;
      if (!saved) return reply({ ok: false, message: "Surat sudah dipakai atau kedaluwarsa. Hasil ujian tidak disimpan." }, 409);

      // Hasil penguji disimpan dahulu. Progres peserta belum dinyatakan lulus
      // sampai Pembina memeriksa dokumen dan membubuhkan paraf.
      return reply({
        ok: true,
        message: "Hasil ujian dan tanda tangan penguji berhasil disimpan.",
        certificate: { referral_no: saved.referral_no, result, examiner_name: examinerName, examiner_institution: institution || null, examiner_notes: notes || null, signed_at: signedAt }
      });
    }

    return reply({ ok: false, message: "Aksi tidak dikenal." }, 400);
  } catch (error) {
    console.error(error);
    return reply({ ok: false, message: "Terjadi kesalahan server. Silakan coba kembali." }, 500);
  }
});