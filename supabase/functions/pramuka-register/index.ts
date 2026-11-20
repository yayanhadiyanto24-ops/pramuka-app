import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
const clean=(v:unknown,max=180)=>typeof v==="string"?v.trim().slice(0,max):"";
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return reply({ok:false,message:"Metode tidak didukung."},405);
 const url=Deno.env.get("SUPABASE_URL")!,secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,anon=Deno.env.get("SUPABASE_ANON_KEY");
 if(!url||!secret)return reply({ok:false,message:"Konfigurasi server belum lengkap."},500);
 const admin=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
 try{
  const body=await req.json(),action=clean(body.action||"register",60);
  if(action==="kwarran_registration_options"){
   const {data,error}=await admin.from("kwarran").select("id_kwarran,nama_kwarran").order("nama_kwarran");
   if(error)throw error;return reply({ok:true,kwarran:data||[]});
  }
  if(action==="kwarran_invite_options"){
   const code=clean(body.kode_aktivasi,64).toUpperCase();
   if(!code)return reply({ok:false,message:"Masukkan kode aktivasi undangan."},400);
   const {data:invite,error:inviteError}=await admin.from("kwarran_admin_invites").select("id_kwarran").eq("invite_code",code).is("used_at",null).is("revoked_at",null).maybeSingle();
   if(inviteError)throw inviteError;if(!invite)return reply({ok:false,message:"Kode aktivasi tidak valid, sudah digunakan, atau telah dicabut."},404);
   const {data:region,error:regionError}=await admin.from("kwarran").select("nama_kwarran").eq("id_kwarran",invite.id_kwarran).single();
   if(regionError)throw regionError;
   return reply({ok:true,nama_kwarran:region.nama_kwarran});
  }
  if(action==="registration_options"){
   const code=clean(body.kode_gabung,30).toUpperCase(),gender=clean(body.jenis_kelamin,1);
   if(!code||!["L","P"].includes(gender))return reply({ok:false,message:"Masukkan kode gabung dan jenis kelamin."},400);
   const {data:p,error:pe}=await admin.from("pangkalan").select("id_pangkalan,nama_pangkalan,nama_ambalan_putra,nama_ambalan_putri,id_kwarran,kwarran!inner(nama_kwarran)").eq("kode_gabung_peserta",code).maybeSingle();
   if(pe)throw pe;if(!p)return reply({ok:false,message:"Kode gabung pangkalan tidak ditemukan."},404);
   const {data:sangga,error:se}=await admin.from("pangkalan_sangga").select("id_sangga,nama_sangga,urutan").eq("id_pangkalan",p.id_pangkalan).eq("jenis_kelamin",gender).eq("aktif",true).order("urutan");
   if(se)throw se;
   return reply({ok:true,nama_pangkalan:p.nama_pangkalan,nama_kwarran:p.kwarran?.nama_kwarran||"",id_kwarran:p.id_kwarran,nama_ambalan:gender==="L"?p.nama_ambalan_putra:p.nama_ambalan_putri,sangga:sangga||[]});
  }
  if(action==="register"){
   const role=clean(body.role,30),email=clean(body.email,254).toLowerCase(),password=typeof body.password==="string"?body.password:"",name=clean(body.nama_lengkap,150);
   if(!["peserta_didik","pembina","admin_kwarran"].includes(role)||!email.includes("@")||password.length<(role==="admin_kwarran"?10:8)||!name)return reply({ok:false,message:"Periksa nama, email, dan password. Password Admin Kwarran minimal 10 karakter."},400);
   let kwarranInvite:any=null;
   if(role==="admin_kwarran"){
    const code=clean(body.kode_aktivasi,64).toUpperCase();
    if(!code)return reply({ok:false,message:"Kode aktivasi undangan wajib diisi."},400);
    const {data:invite,error:inviteError}=await admin.from("kwarran_admin_invites").select("id_invite,id_kwarran").eq("invite_code",code).is("used_at",null).is("revoked_at",null).maybeSingle();
    if(inviteError)throw inviteError;if(!invite)return reply({ok:false,message:"Kode aktivasi tidak valid, sudah digunakan, atau telah dicabut."},404);
    kwarranInvite=invite;
   }
   if(role==="peserta_didik"&&(!clean(body.kode_gabung,30)||!["L","P"].includes(body.jenis_kelamin)||!["X","XI","XII"].includes(body.kelas_sekolah)||!clean(body.jurusan,100)||!new RegExp("^[0-9]{4}/[0-9]{4}$").test(clean(body.tahun_pelajaran,9))||!Number.isInteger(Number(body.id_sangga))))return reply({ok:false,message:"Lengkapi data peserta, sangga, kelas, jurusan, dan tahun pelajaran."},400);
   if(role==="pembina"){
    if(!["L","P"].includes(body.jenis_kelamin)||!["Pembina Satuan Putera","Pembina Satuan Puteri"].includes(body.jabatan)||((body.jenis_kelamin==="L")!==(body.jabatan==="Pembina Satuan Putera")))return reply({ok:false,message:"Jenis kelamin atau jabatan pembina tidak valid."},400);
    if(body.mode==="baru"&&(!clean(body.nama_pangkalan)||!clean(body.nama_ambalan_putra)||!clean(body.nama_ambalan_putri)))return reply({ok:false,message:"Nama pangkalan dan kedua nama ambalan wajib diisi."},400);
    if(body.mode==="gabung"&&!clean(body.kode_gabung,30))return reply({ok:false,message:"Kode gabung pembina wajib diisi."},400);
   }
   // Tolak email yang sudah dipakai akun aplikasi sebelum memanggil Auth.
   const {data:existingAccount,error:existingAccountError}=await admin.from("users").select("id_user").eq("email",email).maybeSingle();
   if(existingAccountError)throw existingAccountError;
   if(existingAccount)return reply({ok:false,message:"Email ini sudah terdaftar. Gunakan email lain atau masuk dengan akun yang sudah ada."},409);
   let userId:string;
   const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:name}});
   if(error||!data.user)return reply({ok:false,message:error?.message||"Akun tidak dapat dibuat."},400);
   userId=data.user.id;
   if(role==="admin_kwarran"){
    const {error:userError}=await admin.from("users").insert({id_user:userId,email,role:"admin_kwarran",status_akun:"aktif"});
    if(userError){await admin.auth.admin.deleteUser(userId);throw userError;}
    const {error:assignmentError}=await admin.from("admin_kwarran").insert({id_user:userId,id_kwarran:kwarranInvite.id_kwarran,nama_lengkap:name});
    if(assignmentError){await admin.from("users").delete().eq("id_user",userId);await admin.auth.admin.deleteUser(userId);throw assignmentError;}
    const {data:consumed,error:consumeError}=await admin.from("kwarran_admin_invites").update({used_at:new Date().toISOString(),used_by:userId}).eq("id_invite",kwarranInvite.id_invite).is("used_at",null).is("revoked_at",null).select("id_invite").maybeSingle();
    if(consumeError||!consumed){await admin.from("admin_kwarran").delete().eq("id_user",userId);await admin.from("users").delete().eq("id_user",userId);await admin.auth.admin.deleteUser(userId);if(consumeError)throw consumeError;return reply({ok:false,message:"Kode aktivasi baru saja digunakan orang lain. Minta undangan baru kepada Admin Utama."},409);}
    return reply({ok:true,message:"Pendaftaran Admin Kwarran berhasil. Akun aktif dan terhubung ke Kwarran dalam undangan.",status:"aktif"});
   }
   const payload={...body};delete payload.password;delete payload.email;delete payload.action;
   const {data:profile,error:profileError}=await admin.rpc("pramuka_register_profile",{p_user_id:userId,p_email:email,p_payload:payload});
   if(profileError||!profile?.ok){await admin.auth.admin.deleteUser(userId);return reply({ok:false,message:profileError?.message||"Profil gagal disimpan."},400);}
   const result:Record<string,unknown>={ok:true,message:role==="pembina"?"Pendaftaran Pembina berhasil. Akun langsung aktif dan dapat digunakan.":"Pendaftaran peserta didik berhasil. Akun langsung aktif dan ditempatkan pada Ambalan "+(profile.nama_ambalan||"yang tersedia")+".",status:"aktif",nama_pangkalan:profile.nama_pangkalan,nama_ambalan:profile.nama_ambalan};
   if(profile.id_ambalan)result.id_ambalan=profile.id_ambalan;
   if(profile.urutan_ambalan)result.urutan_ambalan=profile.urutan_ambalan;
   if(profile.status_ambalan)result.status_ambalan=profile.status_ambalan;
   const {data:createdAccount,error:createdAccountError}=await admin.from("users").select("kode_unik").eq("id_user",userId).single();
   if(createdAccountError)throw createdAccountError;
   result.kode_unik=createdAccount.kode_unik;
   if(profile.kode_gabung_pangkalan)result.kode_gabung_pangkalan=profile.kode_gabung_pangkalan;

   return reply(result);
  }
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return reply({ok:false,message:"Silakan login sebagai Admin Utama."},401);
  const {data:authData,error:authErr}=await admin.auth.getUser(token);
  if(authErr||!authData.user?.email)return reply({ok:false,message:"Sesi login tidak valid."},401);

  if(action==="kwarran_options"){
   const {data:me,error:meError}=await admin.from("users").select("role,status_akun").eq("id_user",authData.user.id).maybeSingle();
   if(meError)throw meError;if(!me||me.role!=="pembina"||me.status_akun!=="aktif")return reply({ok:false,message:"Akses hanya untuk Pembina aktif."},403);
   const {data,error}=await admin.from("kwarran").select("id_kwarran,nama_kwarran").order("nama_kwarran");if(error)throw error;
   return reply({ok:true,kwarran:data||[]});
  }
  if(action==="gudep_penilaian_kwarran_data"||action==="gudep_penilaian_kwarran_detail"||action==="gudep_penilaian_kwarran_simpan"||action==="gudep_penilaian_kwarran_verifikasi_bukti"||action==="gudep_penilaian_kwarran_keputusan"){
   const {data:me,error:meError}=await admin.from("users").select("role,status_akun").eq("id_user",authData.user.id).maybeSingle();
   if(meError)throw meError;
   if(!me||me.role!=="admin_kwarran"||me.status_akun!=="aktif")return reply({ok:false,message:"Akses hanya untuk Admin Kwarran aktif."},403);
   const {data:assignment,error:assignmentError}=await admin.from("admin_kwarran").select("id_kwarran").eq("id_user",authData.user.id).maybeSingle();
   if(assignmentError)throw assignmentError;if(!assignment)return reply({ok:false,message:"Akun Admin Kwarran belum memiliki wilayah tugas."},403);
   if(action==="gudep_penilaian_kwarran_data"){
    const {data,error}=await admin.from("gudep_penilaian").select("id_penilaian,id_periode,status,poin_total_usulan,poin_total_verifikasi,diajukan_at,ditinjau_at,catatan_pembina,catatan_kwarran,pangkalan!inner(id_pangkalan,nama_pangkalan,no_gudep),gudep_penilaian_periode!inner(nama_periode,tahun)").eq("id_kwarran",assignment.id_kwarran).order("diajukan_at",{ascending:false,nullsFirst:false}).order("created_at",{ascending:false});
    if(error)throw error;
    return reply({ok:true,penilaian:data||[],id_kwarran:assignment.id_kwarran});
   }
   if(action==="gudep_penilaian_kwarran_detail"){
    const id=Number(body.id_penilaian);
    if(!Number.isInteger(id)||id<=0)return reply({ok:false,message:"Nomor penilaian tidak valid."},400);
    const {data:penilaian,error:pe}=await admin.from("gudep_penilaian").select("*,pangkalan!inner(id_pangkalan,nama_pangkalan,no_gudep),gudep_penilaian_periode!inner(nama_periode,tahun)").eq("id_penilaian",id).eq("id_kwarran",assignment.id_kwarran).maybeSingle();
    if(pe)throw pe;if(!penilaian)return reply({ok:false,message:"Penilaian tidak ditemukan dalam wilayah Anda."},404);
    const [{data:kategori,error:ke},{data:kriteria,error:kr},{data:nilai,error:ne},{data:bukti,error:be}]=await Promise.all([
     admin.from("gudep_penilaian_kategori").select("id_kategori,parent_id,kode,nama,deskripsi,urutan").eq("id_template",penilaian.id_template).eq("aktif",true).order("urutan"),
     admin.from("gudep_penilaian_kriteria").select("id_kriteria,id_kategori,kode,nama,panduan_penilaian,poin_maks,bukti_wajib,urutan").eq("aktif",true).order("urutan"),
     admin.from("gudep_penilaian_nilai").select("id_kriteria,nilai_usulan,nilai_verifikator,catatan_pembina,catatan_penilai").eq("id_penilaian",id),
     admin.from("gudep_penilaian_bukti").select("id_bukti,id_kriteria,nama_file,mime_type,ukuran_byte,status_verifikasi,catatan_verifikasi,storage_bucket,storage_path,created_at").eq("id_penilaian",id).order("created_at",{ascending:false})
    ]);
    if(ke)throw ke;if(kr)throw kr;if(ne)throw ne;if(be)throw be;
    const cats=kategori||[],catIds=new Set(cats.map(x=>x.id_kategori)),criteria=(kriteria||[]).filter(x=>catIds.has(x.id_kategori));
    const nilaiMap=new Map((nilai||[]).map(x=>[String(x.id_kriteria),x]));
    let evidence=bukti||[];
    if(evidence.length){
     const {data:signed,error:signedError}=await admin.storage.from("gudep-penilaian-bukti").createSignedUrls(evidence.map(x=>x.storage_path),600);
     if(signedError)throw signedError;
     const urlMap=new Map((signed||[]).map(x=>[x.path,x.signedUrl]));
     evidence=evidence.map(x=>({...x,url:urlMap.get(x.storage_path)||null}));
    }
    const evidenceMap=new Map<number,any[]>();
    for(const b of evidence){const key=Number(b.id_kriteria);if(!evidenceMap.has(key))evidenceMap.set(key,[]);evidenceMap.get(key)!.push(b);}
    return reply({ok:true,penilaian,kategori:cats,kriteria:criteria.map(k=>({...k,...(nilaiMap.get(String(k.id_kriteria))||{}),nilai_usulan:Number(nilaiMap.get(String(k.id_kriteria))?.nilai_usulan||0),nilai_verifikator:nilaiMap.get(String(k.id_kriteria))?.nilai_verifikator===null?null:Number(nilaiMap.get(String(k.id_kriteria))?.nilai_verifikator||0),bukti:evidenceMap.get(Number(k.id_kriteria))||[]}))});
   }
   if(action==="gudep_penilaian_kwarran_simpan"){
    const id=Number(body.id_penilaian),nilai=Array.isArray(body.nilai)?body.nilai:[];
    if(!Number.isInteger(id)||id<=0)return reply({ok:false,message:"Nomor penilaian tidak valid."},400);
    const {data,error}=await admin.rpc("gudep_penilaian_kwarran_simpan",{p_user_id:authData.user.id,p_id_penilaian:id,p_nilai:nilai,p_catatan:clean(body.catatan,3000)});
    if(error)return reply({ok:false,message:error.message||"Nilai verifikasi gagal disimpan."},400);
    return reply({ok:true,...data,message:"Nilai verifikasi berhasil disimpan."});
   }
   if(action==="gudep_penilaian_kwarran_verifikasi_bukti"){
    const id=Number(body.id_bukti),status=clean(body.status_verifikasi,20);
    if(!Number.isInteger(id)||id<=0||!["valid","tidak_valid"].includes(status))return reply({ok:false,message:"Data verifikasi bukti tidak valid."},400);
    const {data,error}=await admin.rpc("gudep_penilaian_kwarran_verifikasi_bukti",{p_user_id:authData.user.id,p_id_bukti:id,p_status:status,p_catatan:clean(body.catatan,2000)});
    if(error)return reply({ok:false,message:error.message||"Verifikasi bukti gagal."},400);
    return reply({ok:true,...data,message:"Status bukti berhasil diperbarui."});
   }
   if(action==="gudep_penilaian_kwarran_keputusan"){
    const id=Number(body.id_penilaian),keputusan=clean(body.keputusan,30);
    if(!Number.isInteger(id)||id<=0||!["verifikasi","perlu_perbaikan"].includes(keputusan))return reply({ok:false,message:"Keputusan pemeriksaan tidak valid."},400);
    const {data,error}=await admin.rpc("gudep_penilaian_kwarran_keputusan",{p_user_id:authData.user.id,p_id_penilaian:id,p_keputusan:keputusan,p_catatan:clean(body.catatan,3000)});
    if(error)return reply({ok:false,message:error.message||"Keputusan pemeriksaan gagal disimpan."},400);
    return reply({ok:true,...data,message:keputusan==="verifikasi"?"Penilaian berhasil diverifikasi dan diteruskan ke Admin Utama.":"Penilaian dikembalikan kepada Pembina untuk perbaikan."});
   }
  }
  if(action==="gudep_penilaian_kwarcab_data"||action==="gudep_penilaian_kwarcab_detail"||action==="gudep_penilaian_kwarcab_finalkan"){
   const {data:me,error:meError}=await admin.from("users").select("role,status_akun").eq("id_user",authData.user.id).maybeSingle();
   if(meError)throw meError;
   if(!me||me.role!=="admin_kwarcab"||me.status_akun!=="aktif")return reply({ok:false,message:"Akses hanya untuk Admin Utama aktif."},403);
   if(action==="gudep_penilaian_kwarcab_data"){
    const {data,error}=await admin.from("gudep_penilaian").select("id_penilaian,id_periode,id_kwarran,status,poin_total_usulan,poin_total_verifikasi,poin_total_final,diajukan_at,ditinjau_at,difinalkan_at,pangkalan!inner(id_pangkalan,nama_pangkalan,no_gudep),kwarran!inner(id_kwarran,nama_kwarran),gudep_penilaian_periode!inner(nama_periode,tahun)").in("status",["terverifikasi_kwarran","final"]).order("updated_at",{ascending:false});
    if(error)throw error;
    return reply({ok:true,penilaian:data||[]});
   }
   if(action==="gudep_penilaian_kwarcab_detail"){
    const id=Number(body.id_penilaian);
    if(!Number.isInteger(id)||id<=0)return reply({ok:false,message:"Nomor penilaian tidak valid."},400);
    const {data:penilaian,error:pe}=await admin.from("gudep_penilaian").select("*,pangkalan!inner(id_pangkalan,nama_pangkalan,no_gudep),kwarran!inner(id_kwarran,nama_kwarran),gudep_penilaian_periode!inner(nama_periode,tahun)").eq("id_penilaian",id).maybeSingle();
    if(pe)throw pe;if(!penilaian)return reply({ok:false,message:"Penilaian tidak ditemukan."},404);
    const [{data:kategori,error:ke},{data:kriteria,error:kr},{data:nilai,error:ne},{data:bukti,error:be}]=await Promise.all([
     admin.from("gudep_penilaian_kategori").select("id_kategori,parent_id,kode,nama,deskripsi,urutan").eq("id_template",penilaian.id_template).eq("aktif",true).order("urutan"),
     admin.from("gudep_penilaian_kriteria").select("id_kriteria,id_kategori,kode,nama,panduan_penilaian,poin_maks,bukti_wajib,urutan").eq("aktif",true).order("urutan"),
     admin.from("gudep_penilaian_nilai").select("id_kriteria,nilai_usulan,nilai_verifikator,nilai_final,catatan_pembina,catatan_penilai").eq("id_penilaian",id),
     admin.from("gudep_penilaian_bukti").select("id_bukti,id_kriteria,nama_file,mime_type,ukuran_byte,status_verifikasi,catatan_verifikasi,storage_bucket,storage_path,created_at").eq("id_penilaian",id).order("created_at",{ascending:false})
    ]);
    if(ke)throw ke;if(kr)throw kr;if(ne)throw ne;if(be)throw be;
    const cats=kategori||[],catIds=new Set(cats.map(x=>x.id_kategori)),criteria=(kriteria||[]).filter(x=>catIds.has(x.id_kategori));
    const nilaiMap=new Map((nilai||[]).map(x=>[String(x.id_kriteria),x]));
    let evidence=bukti||[];
    if(evidence.length){
     const {data:signed,error:signedError}=await admin.storage.from("gudep-penilaian-bukti").createSignedUrls(evidence.map(x=>x.storage_path),600);
     if(signedError)throw signedError;
     const urlMap=new Map((signed||[]).map(x=>[x.path,x.signedUrl]));
     evidence=evidence.map(x=>({...x,url:urlMap.get(x.storage_path)||null}));
    }
    const evidenceMap=new Map<number,any[]>();
    for(const b of evidence){const key=Number(b.id_kriteria);if(!evidenceMap.has(key))evidenceMap.set(key,[]);evidenceMap.get(key)!.push(b);}
    return reply({ok:true,penilaian,kategori:cats,kriteria:criteria.map(k=>({...k,...(nilaiMap.get(String(k.id_kriteria))||{}),nilai_usulan:Number(nilaiMap.get(String(k.id_kriteria))?.nilai_usulan||0),nilai_verifikator:Number(nilaiMap.get(String(k.id_kriteria))?.nilai_verifikator||0),nilai_final:nilaiMap.get(String(k.id_kriteria))?.nilai_final===null?null:Number(nilaiMap.get(String(k.id_kriteria))?.nilai_final||0),bukti:evidenceMap.get(Number(k.id_kriteria))||[]}))});
   }
   if(action==="gudep_penilaian_kwarcab_finalkan"){
    const id=Number(body.id_penilaian),nilai=Array.isArray(body.nilai)?body.nilai:[];
    if(!Number.isInteger(id)||id<=0)return reply({ok:false,message:"Nomor penilaian tidak valid."},400);
    const {data,error}=await admin.rpc("gudep_penilaian_kwarcab_finalkan",{p_user_id:authData.user.id,p_id_penilaian:id,p_nilai:nilai,p_catatan:clean(body.catatan,3000)});
    if(error)return reply({ok:false,message:error.message||"Finalisasi penilaian gagal."},400);
    return reply({ok:true,...data,message:"Nilai final Gudep Tergiat berhasil ditetapkan."});
   }
  }
  if(action==="admin_kwarran_dashboard"){
   const {data:me,error:meError}=await admin.from("users").select("role,status_akun").eq("id_user",authData.user.id).maybeSingle();
   if(meError)throw meError;
   if(!me||me.role!=="admin_kwarran"||me.status_akun!=="aktif")return reply({ok:false,message:"Akses hanya untuk Admin Kwarran aktif."},403);
   const {data:assignment,error:assignmentError}=await admin.from("admin_kwarran").select("id_kwarran,nama_lengkap,kwarran!inner(id_kwarran,nama_kwarran)").eq("id_user",authData.user.id).maybeSingle();
   if(assignmentError)throw assignmentError;
   if(!assignment)return reply({ok:false,message:"Akun Admin Kwarran belum ditetapkan wilayahnya. Hubungi Admin Utama."},403);
   const [comparison,pangkalan]=await Promise.all([
    admin.from("v_kwarran_comparison").select("*").order("nama_kwarran"),
    admin.from("pangkalan").select("id_pangkalan,nama_pangkalan,no_gudep,nama_ambalan_putra,nama_ambalan_putri").eq("id_kwarran",assignment.id_kwarran).order("nama_pangkalan")
   ]);
   if(comparison.error)throw comparison.error;if(pangkalan.error)throw pangkalan.error;
   const ids=(pangkalan.data||[]).map(x=>x.id_pangkalan);
   let rekap=[],rankingPangkalan:any[]=[];
   if(ids.length){
    const [{data:rows,error:rowsError},{data:ranking,error:rankingError}]=await Promise.all([
     admin.from("v_admin_ambalan_rekap").select("*").in("id_pangkalan",ids).order("nama_pangkalan").order("jenis_kelamin"),
     admin.from("v_pangkalan_peringkat").select("*").eq("id_kwarran",assignment.id_kwarran).order("peringkat_kwarran",{ascending:true,nullsFirst:false}).order("nama_pangkalan")
    ]);
    if(rowsError)throw rowsError;if(rankingError)throw rankingError;rekap=rows||[];rankingPangkalan=ranking||[];
   }
   return reply({ok:true,admin:{nama_lengkap:assignment.nama_lengkap||authData.user.user_metadata?.display_name||"Admin Kwarran",nama_kwarran:assignment.kwarran.nama_kwarran,id_kwarran:assignment.id_kwarran},comparison:comparison.data||[],pangkalan:pangkalan.data||[],rekap,ranking_pangkalan:rankingPangkalan});
  }
  if(action==="save_profile"){
   const {data:me,error:meError}=await admin.from("users").select("role,status_akun").eq("id_user",authData.user.id).single();
   if(meError)throw meError;if(me.status_akun!=="aktif")return reply({ok:false,message:"Akun belum aktif."},403);
   const photo=typeof body.foto_profil_data==="string"?body.foto_profil_data:"";
   if(photo&&(!photo.startsWith("data:image/")||photo.length>700000))return reply({ok:false,message:"Foto harus berupa gambar dan berukuran maksimal sekitar 500 KB."},400);
   const ktaEvidence=body.nta_bukti_kta&&typeof body.nta_bukti_kta==="object"?body.nta_bukti_kta:null;
   if(ktaEvidence){
    const path=clean(ktaEvidence.path,500),allowedPrefix=authData.user.id+"/nta-kta/";
    if(!path.startsWith(allowedPrefix)||path.includes(".."))return reply({ok:false,message:"Lokasi berkas KTA tidak valid."},400);
   }
   if(me.role==="peserta_didik"){
    const {data:student,error:studentError}=await admin.from("profil_peserta_didik").select("tingkatan,nta").eq("id_user",authData.user.id).single();if(studentError)throw studentError;
    const nta=clean(body.nta,80)||null;
    const jabatanAmbalan=clean(body.jabatan_ambalan,100),jabatanSangga=clean(body.jabatan_sangga,30);
    if(jabatanAmbalan==="Lainnya"||jabatanSangga&&!["Pinsa","Wapinsa","Anggota"].includes(jabatanSangga))return reply({ok:false,message:"Pilihan jabatan tidak valid."},400);
    const patch={nta,foto_profil_data:photo||null,jabatan_ambalan:jabatanAmbalan||null,jabatan_sangga:jabatanSangga||null,pengalaman_kegiatan:Array.isArray(body.pengalaman_kegiatan)?body.pengalaman_kegiatan.slice(0,40):[],organisasi_aktif:Array.isArray(body.organisasi_aktif)?body.organisasi_aktif.slice(0,30):[]};
    if(ktaEvidence){patch.nta_bukti_kta=ktaEvidence;patch.nta_status_verifikasi="menunggu";}
    else if(student.nta!==nta)patch.nta_status_verifikasi="belum_ada";
    if(student.tingkatan==="Calon Penegak"&&!nta)patch.tingkatan="Peserta Tamu";
    const {error}=await admin.from("profil_peserta_didik").update(patch).eq("id_user",authData.user.id);if(error)throw error;
   }else if(me.role==="pembina"){
    const years={tahun_kmd:body.tahun_kmd,tahun_kml:body.tahun_kml,tahun_kpd:body.tahun_kpd,tahun_kpl:body.tahun_kpl};
    for(const [k,v] of Object.entries(years))if(v!==null&&v!==undefined&&v!==""&&(!Number.isInteger(Number(v))||Number(v)<1950||Number(v)>new Date().getFullYear()+1))return reply({ok:false,message:"Tahun pendidikan Pembina tidak valid."},400);
    const patch={nta:clean(body.nta,80)||null,foto_profil_data:photo||null,tahun_kmd:years.tahun_kmd?Number(years.tahun_kmd):null,tahun_kml:years.tahun_kml?Number(years.tahun_kml):null,tahun_kpd:years.tahun_kpd?Number(years.tahun_kpd):null,tahun_kpl:years.tahun_kpl?Number(years.tahun_kpl):null,tanda_tangan_data:typeof body.tanda_tangan_data==="string"&&body.tanda_tangan_data.startsWith("data:image/")&&body.tanda_tangan_data.length<300000?body.tanda_tangan_data:null,paraf_data:typeof body.paraf_data==="string"&&body.paraf_data.startsWith("data:image/")&&body.paraf_data.length<150000?body.paraf_data:null};
    if(ktaEvidence){patch.nta_bukti_kta=ktaEvidence;patch.nta_status_verifikasi="menunggu";}
    const {error}=await admin.from("profil_pembina").update(patch).eq("id_user",authData.user.id);if(error)throw error;
   }else if(me.role==="admin_kwarcab"){
    const {error}=await admin.from("users").update({foto_profil_data:photo||null}).eq("id_user",authData.user.id);if(error)throw error;
   }else return reply({ok:false,message:"Peran akun tidak diizinkan."},403);
   return reply({ok:true,message:"Profil berhasil disimpan."});
  }
  if(action==="pembina_pangkalan"||action==="simpan_pangkalan_pembina"||action==="simpan_tanda_tangan_pangkalan"||action==="pembina_peserta_pending"||action==="setujui_peserta_pembina"||action==="pembina_sangga_data"||action==="pindah_sangga_peserta"||action==="pindah_ambalan_peserta"||action==="activate_access_code"||action==="gudep_penilaian_pembina_data"||action==="gudep_penilaian_pembina_simpan"||action==="gudep_penilaian_pembina_kirim"||action==="gudep_penilaian_bukti_upload"||action==="gudep_penilaian_bukti_hapus"){
   const {data:authData,error:authErr}=await admin.auth.getUser(token);
   if(authErr||!authData.user)return reply({ok:false,message:"Sesi login tidak valid."},401);
   const {data:pb,error:pbErr}=await admin.from("profil_pembina").select("id_pangkalan,id_user,jabatan,jenis_kelamin,nta,jumlah_ambalan_berbayar,users!inner(status_akun,role)").eq("id_user",authData.user.id).maybeSingle();
   if(pbErr)throw pbErr;
   if(!pb||pb.users?.status_akun!=="aktif"||pb.users?.role!=="pembina")return reply({ok:false,message:"Akses hanya untuk akun Pembina aktif."},403);
   if(action==="activate_access_code"){
    if(!clean(pb.nta,80))return reply({ok:false,message:"Lengkapi NTA/KTA terlebih dahulu. Tanpa NTA/KTA, kuota dibatasi 5 peserta."},403);
    const code=clean(body.kode_akses,40).toUpperCase();if(!code)return reply({ok:false,message:"Masukkan kode akses dari Admin Utama."},400);
    const {data:row,error}=await admin.from("pembina_access_codes").select("id,akses_tanpa_batas,tambahan_kuota").eq("kode_akses",code).eq("id_pembina",authData.user.id).eq("status","aktif").maybeSingle();if(error)throw error;
    if(!row)return reply({ok:false,message:"Kode akses tidak ditemukan, sudah dipakai, atau bukan untuk akun ini."},404);
    if(row.akses_tanpa_batas===true||Number(row.tambahan_kuota)!==32)return reply({ok:false,message:"Kode lama tidak berlaku untuk penambahan ambalan. Minta kode baru kepada Admin Utama."},400);
    const {data:jumlah,error:activationError}=await admin.rpc("pramuka_activate_ambalan_code",{p_code:code,p_user_id:authData.user.id});if(activationError)throw activationError;
    const total=Number(jumlah||0);
    return reply({ok:true,jumlah_ambalan_berbayar:total,kuota_maksimal:total*32,message:"Kode berhasil diaktifkan. Satu ambalan tambahan terbuka untuk 32 peserta didik. Total kuota kini "+(total*32)+" peserta."});
   }
   if(action==="gudep_penilaian_pembina_data"){
    const {data:periode,error:periodeError}=await admin.from("gudep_penilaian_periode").select("id_periode,id_template,nama_periode,tahun,tanggal_mulai,tanggal_akhir,status").eq("status","dibuka").order("tahun",{ascending:false}).limit(1).maybeSingle();
    if(periodeError)throw periodeError;
    if(!periode)return reply({ok:true,periode:null,penilaian:null,kategori:[],kriteria:[],message:"Belum ada periode penilaian Gudep Tergiat yang dibuka."});
    const today=new Date().toISOString().slice(0,10);
    if(periode.tanggal_mulai&&today<periode.tanggal_mulai)return reply({ok:true,periode:null,penilaian:null,kategori:[],kriteria:[],message:"Periode penilaian belum dimulai. Perhatikan tanggal mulai yang ditetapkan Admin Utama."});
    if(periode.tanggal_akhir&&today>periode.tanggal_akhir)return reply({ok:true,periode:null,penilaian:null,kategori:[],kriteria:[],message:"Batas waktu pengisian penilaian telah berakhir."});
    const [{data:penilaian,error:penilaianError},{data:kategori,error:kategoriError},{data:kriteria,error:kriteriaError}]=await Promise.all([
     admin.from("gudep_penilaian").select("id_penilaian,id_periode,status,poin_total_usulan,catatan_pembina").eq("id_periode",periode.id_periode).eq("id_pangkalan",pb.id_pangkalan).maybeSingle(),
     admin.from("gudep_penilaian_kategori").select("id_kategori,parent_id,kode,nama,deskripsi,urutan").eq("id_template",periode.id_template).eq("aktif",true).order("urutan"),
     admin.from("gudep_penilaian_kriteria").select("id_kriteria,id_kategori,kode,nama,panduan_penilaian,poin_maks,bukti_wajib,urutan").eq("aktif",true).order("urutan")
    ]);
    if(penilaianError)throw penilaianError;if(kategoriError)throw kategoriError;if(kriteriaError)throw kriteriaError;
    const cats=kategori||[],catIds=new Set(cats.map(x=>x.id_kategori)),criteria=(kriteria||[]).filter(x=>catIds.has(x.id_kategori));
    let nilai:any[]=[];
    let bukti:any[]=[];
    if(penilaian){
     const [{data:n,error:ne},{data:b,error:be}]=await Promise.all([
      admin.from("gudep_penilaian_nilai").select("id_kriteria,nilai_usulan,catatan_pembina").eq("id_penilaian",penilaian.id_penilaian),
      admin.from("gudep_penilaian_bukti").select("id_bukti,id_kriteria,nama_file,mime_type,ukuran_byte,status_verifikasi,storage_bucket,storage_path,created_at").eq("id_penilaian",penilaian.id_penilaian).order("created_at",{ascending:false})
     ]);
     if(ne)throw ne;if(be)throw be;nilai=n||[];bukti=b||[];
     if(bukti.length){
      const paths=bukti.map(x=>x.storage_path);
      const {data:signed,error:signedError}=await admin.storage.from("gudep-penilaian-bukti").createSignedUrls(paths,600);
      if(signedError)throw signedError;
      const urlMap=new Map((signed||[]).map(x=>[x.path,x.signedUrl]));
      bukti=bukti.map(x=>({...x,url:urlMap.get(x.storage_path)||null}));
     }
    }
    const nilaiMap=new Map(nilai.map(x=>[String(x.id_kriteria),x]));
    const buktiMap=new Map<number,any[]>();
    for(const b of bukti){const key=Number(b.id_kriteria);if(!buktiMap.has(key))buktiMap.set(key,[]);buktiMap.get(key)!.push(b);}
    return reply({ok:true,periode,penilaian,kategori:cats,kriteria:criteria.map(k=>({...k,nilai_usulan:Number(nilaiMap.get(String(k.id_kriteria))?.nilai_usulan||0),catatan_pembina:nilaiMap.get(String(k.id_kriteria))?.catatan_pembina||"",bukti:buktiMap.get(Number(k.id_kriteria))||[]}))});
   }
   if(action==="gudep_penilaian_pembina_simpan"){
    const periodeId=Number(body.id_periode),nilai=Array.isArray(body.nilai)?body.nilai:[];
    if(!Number.isInteger(periodeId)||periodeId<=0)return reply({ok:false,message:"Periode penilaian tidak valid."},400);
    const {data,error}=await admin.rpc("gudep_penilaian_pembina_simpan",{p_user_id:authData.user.id,p_id_periode:periodeId,p_nilai:nilai,p_catatan:clean(body.catatan,3000)});
    if(error)return reply({ok:false,message:error.message||"Draft penilaian gagal disimpan."},400);
    return reply({ok:true,...data,message:"Draft penilaian berhasil disimpan."});
   }
   if(action==="gudep_penilaian_pembina_kirim"){
    const periodeId=Number(body.id_periode);
    if(!Number.isInteger(periodeId)||periodeId<=0)return reply({ok:false,message:"Periode penilaian tidak valid."},400);
    const {data,error}=await admin.rpc("gudep_penilaian_pembina_kirim",{p_user_id:authData.user.id,p_id_periode:periodeId,p_catatan:clean(body.catatan,3000)});
    if(error)return reply({ok:false,message:error.message||"Penilaian gagal diajukan."},400);
    return reply({ok:true,...data,message:"Penilaian berhasil diajukan kepada Admin Kwarran."});
   }
   if(action==="gudep_penilaian_bukti_upload"){
    const idPenilaian=Number(body.id_penilaian),idKriteria=Number(body.id_kriteria),namaAsli=clean(body.nama_file,180),mime=clean(body.mime_type,100),ukuran=Number(body.ukuran_byte);
    const allowed=["application/pdf","image/jpeg","image/png","image/webp"];
    if(!Number.isInteger(idPenilaian)||idPenilaian<=0||!Number.isInteger(idKriteria)||idKriteria<=0||!namaAsli||!allowed.includes(mime)||!Number.isInteger(ukuran)||ukuran<=0||ukuran>10485760)return reply({ok:false,message:"Berkas harus berupa PDF/JPG/PNG/WebP dan maksimal 10 MB."},400);
    const {data:penilaian,error:penilaianError}=await admin.from("gudep_penilaian").select("id_penilaian,id_periode,id_template,id_pangkalan,status").eq("id_penilaian",idPenilaian).eq("id_pangkalan",pb.id_pangkalan).maybeSingle();
    if(penilaianError)throw penilaianError;if(!penilaian||!["draft","perlu_perbaikan"].includes(penilaian.status))return reply({ok:false,message:"Penilaian tidak ditemukan atau sudah dikunci."},403);
    const {data:periode,error:periodeError}=await admin.from("gudep_penilaian_periode").select("status,tanggal_mulai,tanggal_akhir").eq("id_periode",penilaian.id_periode).single();
    if(periodeError)throw periodeError;if(periode.status!=="dibuka"||(periode.tanggal_mulai&&new Date().toISOString().slice(0,10)<periode.tanggal_mulai)||(periode.tanggal_akhir&&new Date().toISOString().slice(0,10)>periode.tanggal_akhir))return reply({ok:false,message:"Periode penilaian tidak sedang menerima berkas."},400);
    const {data:criterion,error:criterionError}=await admin.from("gudep_penilaian_kriteria").select("id_kriteria,id_kategori").eq("id_kriteria",idKriteria).eq("aktif",true).maybeSingle();
    if(criterionError)throw criterionError;if(!criterion)return reply({ok:false,message:"Indikator tidak ditemukan."},404);
    const {data:category,error:categoryError}=await admin.from("gudep_penilaian_kategori").select("id_kategori").eq("id_kategori",criterion.id_kategori).eq("id_template",penilaian.id_template).eq("aktif",true).maybeSingle();
    if(categoryError)throw categoryError;if(!category)return reply({ok:false,message:"Indikator bukan bagian dari template penilaian ini."},400);
    const safeName=namaAsli.replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120)||"bukti";
    const path="pangkalan/"+pb.id_pangkalan+"/periode/"+penilaian.id_periode+"/"+idPenilaian+"/"+idKriteria+"/"+crypto.randomUUID()+"-"+safeName;
    const {data:signed,error:signedError}=await admin.storage.from("gudep-penilaian-bukti").createSignedUploadUrl(path,{upsert:false});
    if(signedError)throw signedError;
    const {data:meta,error:metaError}=await admin.from("gudep_penilaian_bukti").insert({id_penilaian:idPenilaian,id_kriteria:idKriteria,storage_bucket:"gudep-penilaian-bukti",storage_path:path,nama_file:namaAsli,mime_type:mime,ukuran_byte:ukuran,diunggah_oleh:authData.user.id}).select("id_bukti").single();
    if(metaError)throw metaError;
    return reply({ok:true,id_bukti:meta.id_bukti,path,token:signed.token,bucket:"gudep-penilaian-bukti",message:"Tautan unggah bukti berhasil dibuat."});
   }
   if(action==="gudep_penilaian_bukti_hapus"){
    const idBukti=Number(body.id_bukti);
    if(!Number.isInteger(idBukti)||idBukti<=0)return reply({ok:false,message:"Bukti tidak valid."},400);
    const {data:bukti,error:buktiError}=await admin.from("gudep_penilaian_bukti").select("id_bukti,id_penilaian,storage_bucket,storage_path").eq("id_bukti",idBukti).maybeSingle();
    if(buktiError)throw buktiError;if(!bukti)return reply({ok:false,message:"Bukti tidak ditemukan."},404);
    const {data:penilaian,error:penilaianError}=await admin.from("gudep_penilaian").select("id_penilaian,id_pangkalan,status").eq("id_penilaian",bukti.id_penilaian).maybeSingle();
    if(penilaianError)throw penilaianError;if(!penilaian||penilaian.id_pangkalan!==pb.id_pangkalan||!["draft","perlu_perbaikan"].includes(penilaian.status))return reply({ok:false,message:"Bukti tidak dapat dihapus setelah penilaian diajukan."},403);
    const {error:removeError}=await admin.storage.from(bukti.storage_bucket).remove([bukti.storage_path]);
    if(removeError)throw removeError;
    const {error:deleteError}=await admin.from("gudep_penilaian_bukti").delete().eq("id_bukti",idBukti);
    if(deleteError)throw deleteError;
    return reply({ok:true,message:"Bukti pendukung berhasil dihapus."});
   }
   if(action==="pembina_sangga_data"){
    const gender=pb.jenis_kelamin;
    const [{data:sangga,error:se},{data:peserta,error:pe},{data:ambalan,error:ae},{data:pangkalan,error:pae}]=await Promise.all([
     admin.from("pangkalan_sangga").select("id_sangga,nama_sangga,urutan").eq("id_pangkalan",pb.id_pangkalan).eq("jenis_kelamin",gender).eq("aktif",true).order("urutan"),
     admin.from("profil_peserta_didik").select("id_user,nama_lengkap,jenis_kelamin,sangga,id_sangga,id_ambalan,kelas_sekolah,jurusan,tahun_pelajaran,status_keanggotaan,users!inner(status_akun)").eq("id_pangkalan",pb.id_pangkalan).eq("jenis_kelamin",gender).eq("users.status_akun","aktif").neq("status_keanggotaan","alumni").order("nama_lengkap"),
     admin.from("pangkalan_ambalan").select("id_ambalan,nama_ambalan,urutan,status").eq("id_pangkalan",pb.id_pangkalan).eq("jenis_kelamin",gender).neq("status","nonaktif").order("urutan"),
     admin.from("pangkalan").select("id_kwarran").eq("id_pangkalan",pb.id_pangkalan).single()
    ]);if(se)throw se;if(pe)throw pe;if(ae)throw ae;if(pae)throw pae;
    let rankingPangkalan:any[]=[];
    if(pangkalan?.id_kwarran){
     const {data:ranking,error:rankingError}=await admin.from("v_pangkalan_peringkat").select("id_pangkalan,nama_pangkalan,no_gudep,jumlah_ambalan,jumlah_ambalan_layak,peserta_aktif,peserta_tamu,total_poin,layak_peringkat,peringkat_kwarran").eq("id_kwarran",pangkalan.id_kwarran).order("peringkat_kwarran",{ascending:true,nullsFirst:false}).order("nama_pangkalan");
     if(rankingError)throw rankingError;rankingPangkalan=ranking||[];
    }
    return reply({ok:true,sangga:sangga||[],peserta:peserta||[],ambalan:ambalan||[],ranking_pangkalan:rankingPangkalan,id_pangkalan:pb.id_pangkalan});
   }
   if(action==="pindah_ambalan_peserta"){
    const targetId=clean(body.user_id,50),idAmbalan=Number(body.id_ambalan),alasan=clean(body.alasan,500);
    if(!targetId||!Number.isInteger(idAmbalan))return reply({ok:false,message:"Peserta atau Ambalan tujuan tidak valid."},400);
    const {data:target,error:te}=await admin.from("profil_peserta_didik").select("id_user,id_pangkalan,jenis_kelamin").eq("id_user",targetId).eq("id_pangkalan",pb.id_pangkalan).maybeSingle();
    if(te)throw te;
    if(!target||target.jenis_kelamin!==pb.jenis_kelamin)return reply({ok:false,message:"Peserta bukan anggota satuan yang menjadi kewenangan Anda."},403);
    const {data:result,error:moveError}=await admin.rpc("pramuka_pindah_peserta_ambalan",{p_user_id:targetId,p_id_ambalan_tujuan:idAmbalan,p_actor_user_id:authData.user.id,p_alasan:alasan});
    if(moveError)return reply({ok:false,message:moveError.message||"Pemindahan Ambalan gagal."},400);
    return reply({ok:true,...result,message:result?.moved===false?result.message:"Peserta berhasil dipindahkan ke "+(result?.nama_ambalan_tujuan||"Ambalan tujuan")+". Riwayat perpindahan telah dicatat."});
   }
   if(action==="pindah_sangga_peserta"){
    const targetId=clean(body.user_id,50),idSangga=Number(body.id_sangga);if(!targetId||!Number.isInteger(idSangga))return reply({ok:false,message:"Peserta atau Sangga tidak valid."},400);
    const [{data:target,error:te},{data:sangga,error:se}]=await Promise.all([
     admin.from("profil_peserta_didik").select("id_user,jenis_kelamin,id_pangkalan").eq("id_user",targetId).eq("id_pangkalan",pb.id_pangkalan).maybeSingle(),
     admin.from("pangkalan_sangga").select("id_sangga,nama_sangga").eq("id_sangga",idSangga).eq("id_pangkalan",pb.id_pangkalan).eq("jenis_kelamin",pb.jenis_kelamin).eq("aktif",true).maybeSingle()
    ]);if(te)throw te;if(se)throw se;
    if(!target||target.jenis_kelamin!==pb.jenis_kelamin||!sangga)return reply({ok:false,message:"Penempatan Sangga tidak sesuai satuan Pembina."},403);
    const {error}=await admin.from("profil_peserta_didik").update({id_sangga:idSangga,sangga:sangga.nama_sangga}).eq("id_user",targetId);if(error)throw error;return reply({ok:true,message:"Sangga peserta berhasil diperbarui."});
   }
   if(action==="pembina_peserta_pending"){
    const {data:rows,error:rowsError}=await admin.from("profil_peserta_didik").select("id_user,nama_lengkap,jenis_kelamin,tingkatan,sangga,users!inner(email,status_akun,created_at)").eq("id_pangkalan",pb.id_pangkalan).eq("users.status_akun","pending").order("nama_lengkap");
    if(rowsError)throw rowsError;
    const peserta=(rows||[]).filter(x=>(pb.jabatan==="Pembina Satuan Putera"&&x.jenis_kelamin==="L")||(pb.jabatan==="Pembina Satuan Puteri"&&x.jenis_kelamin==="P")).map(x=>({id_user:x.id_user,nama_lengkap:x.nama_lengkap,jenis_kelamin:x.jenis_kelamin,tingkatan:x.tingkatan,sangga:x.sangga,email:x.users?.email,created_at:x.users?.created_at}));
    return reply({ok:true,peserta});
   }
   if(action==="setujui_peserta_pembina"){
    const targetId=clean(body.user_id,50);
    if(!targetId)return reply({ok:false,message:"Peserta tidak valid."},400);
    const {data:target,error:targetError}=await admin.from("profil_peserta_didik").select("id_user,jenis_kelamin,id_pangkalan,nta").eq("id_user",targetId).eq("id_pangkalan",pb.id_pangkalan).maybeSingle();
    if(targetError)throw targetError;
    const matching=(pb.jabatan==="Pembina Satuan Putera"&&target?.jenis_kelamin==="L")||(pb.jabatan==="Pembina Satuan Puteri"&&target?.jenis_kelamin==="P");
    if(!target||!matching)return reply({ok:false,message:"Peserta bukan anggota satuan yang menjadi kewenangan Anda."},403);
    const {data:activation,error:activationError}=await admin.rpc("pramuka_activate_pending_participant",{p_user_id:targetId});
    if(activationError)return reply({ok:false,message:activationError.message||"Kuota atau penempatan Ambalan tidak dapat diproses."},403);
    return reply({ok:true,message:"Peserta didik berhasil disetujui dan ditempatkan pada "+(activation?.nama_ambalan||"Ambalan yang tersedia")+".",id_ambalan:activation?.id_ambalan,nama_ambalan:activation?.nama_ambalan,urutan_ambalan:activation?.urutan_ambalan});
   }
   if(action==="simpan_tanda_tangan_pangkalan"){
    const field=body.jenis_tanda_tangan==="ketua_gudep"?"tanda_tangan_ketua_gudep_data":body.jenis_tanda_tangan==="mabigus"?"tanda_tangan_mabigus_data":null;
    const signature=typeof body.tanda_tangan_data==="string"?body.tanda_tangan_data:"";
    if(!field)return reply({ok:false,message:"Jenis tanda tangan tidak valid."},400);
    if(!signature.startsWith("data:image/png;base64,")||signature.length>300000)return reply({ok:false,message:"Tanda tangan tidak valid atau terlalu besar. Silakan gambar ulang."},400);
    const {error}=await admin.from("pangkalan").update({[field]:signature}).eq("id_pangkalan",pb.id_pangkalan);
    if(error)throw error;
    return reply({ok:true,message:"Tanda tangan berhasil disimpan."});
   }
   if(action==="pembina_pangkalan"){
    const [{data:p,error:pe},{data:u,error:ue}]=await Promise.all([
     admin.from("pangkalan").select("id_pangkalan,nama_pangkalan,no_gudep,nama_ambalan_putra,nama_ambalan_putri,nama_ketua_gudep,nama_ketua_mabigus,tanda_tangan_ketua_gudep_data,tanda_tangan_mabigus_data,kode_gabung_peserta").eq("id_pangkalan",pb.id_pangkalan).single(),
     admin.from("users").select("kode_unik").eq("id_user",authData.user.id).single()
    ]);
    if(pe)throw pe;if(ue)throw ue;
    return reply({ok:true,pangkalan:p,kode_unik:u.kode_unik});
   }
   const patch={nama_pangkalan:clean(body.nama_pangkalan),no_gudep:clean(body.no_gudep,40)||null,nama_ambalan_putra:clean(body.nama_ambalan_putra,120),nama_ambalan_putri:clean(body.nama_ambalan_putri,120),nama_ketua_gudep:clean(body.nama_ketua_gudep,150)||null,nama_ketua_mabigus:clean(body.nama_ketua_mabigus,150)||null};
   if(!patch.nama_pangkalan||!patch.nama_ambalan_putra||!patch.nama_ambalan_putri)return reply({ok:false,message:"Nama pangkalan dan kedua nama ambalan wajib diisi."},400);
   const {data:before,error:beforeError}=await admin.from("pangkalan").select("nama_pangkalan,no_gudep,nama_ambalan_putra,nama_ambalan_putri,nama_ketua_gudep,nama_ketua_mabigus").eq("id_pangkalan",pb.id_pangkalan).single();
   if(beforeError)throw beforeError;
   const {error:updateError}=await admin.from("pangkalan").update(patch).eq("id_pangkalan",pb.id_pangkalan);
   if(updateError)throw updateError;
   const {error:auditError}=await admin.from("pangkalan_change_audit").insert({id_pangkalan:pb.id_pangkalan,changed_by:authData.user.id,before_data:before,after_data:patch});
   if(auditError)throw auditError;
   return reply({ok:true,message:"Administrasi pangkalan berhasil disimpan."});
  }
  const {data:config}=await admin.from("app_admin_config").select("admin_email").eq("singleton",true).single();
  const configuredEmail=clean(config?.admin_email,254).toLowerCase();
  if(!configuredEmail||authData.user.email.toLowerCase()!==configuredEmail)return reply({ok:false,message:"Akses khusus Admin Utama."},403);

  if(action==="gudep_penilaian_admin_data"){
   const [{data:template,error:te},{data:kategori,error:ke},{data:kriteria,error:kr},{data:periode,error:pe}]=await Promise.all([
    admin.from("gudep_penilaian_template").select("*").eq("kode_template","CIANJUR_2023_SMA_SMK_MA").maybeSingle(),
    admin.from("gudep_penilaian_kategori").select("*").order("urutan"),
    admin.from("gudep_penilaian_kriteria").select("*").order("urutan"),
    admin.from("gudep_penilaian_periode").select("id_periode,id_template,nama_periode,tahun,tanggal_mulai,tanggal_akhir,status,catatan,created_at").order("tahun",{ascending:false}).order("created_at",{ascending:false})
   ]);
   if(te)throw te;if(ke)throw ke;if(kr)throw kr;if(pe)throw pe;
   const tplId=template?.id_template;
   const categoriesForTemplate=(kategori||[]).filter(x=>!tplId||x.id_template===tplId);
   const categoryIds=new Set(categoriesForTemplate.map(x=>x.id_kategori));
   return reply({ok:true,template:template||null,kategori:categoriesForTemplate,kriteria:(kriteria||[]).filter(x=>categoryIds.has(x.id_kategori)),periode:(periode||[]).filter(x=>!tplId||x.id_template===tplId)});
  }
  if(action==="gudep_penilaian_simpan_kriteria"){
   const idKategori=Number(body.id_kategori),idKriteria=body.id_kriteria?Number(body.id_kriteria):null;
   const kode=clean(body.kode,40).toUpperCase(),nama=clean(body.nama,180),panduan=clean(body.panduan_penilaian,3000);
   const poinMaks=Number(body.poin_maks),buktiWajib=body.bukti_wajib!==false;
   if(!Number.isInteger(idKategori)||idKategori<=0||!kode||!nama||!Number.isFinite(poinMaks)||poinMaks<=0||poinMaks>10000)return reply({ok:false,message:"Lengkapi kategori, kode, nama indikator, dan nilai maksimum yang valid."},400);
   const {data:cat,error:catError}=await admin.from("gudep_penilaian_kategori").select("id_kategori,id_template,parent_id").eq("id_kategori",idKategori).maybeSingle();
   if(catError)throw catError;if(!cat||!cat.parent_id)return reply({ok:false,message:"Pilih komponen penilaian, bukan kelompok utama."},400);
   const {data:tpl,error:tplError}=await admin.from("gudep_penilaian_template").select("id_template,status").eq("id_template",cat.id_template).single();
   if(tplError)throw tplError;if(tpl.status!=="draft")return reply({ok:false,message:"Template sudah aktif. Buat versi baru untuk mengubah indikator dan bobot."},409);
   const values={id_kategori:idKategori,kode,nama,panduan_penilaian:panduan,poin_maks:poinMaks,bukti_wajib:buktiWajib,aturan_skor:{}};
   let saved:any,error:any;
   if(idKriteria){
    const {data:existing,error:existingError}=await admin.from("gudep_penilaian_kriteria").select("id_kriteria,id_kategori").eq("id_kriteria",idKriteria).maybeSingle();
    if(existingError)throw existingError;if(!existing||existing.id_kategori!==idKategori)return reply({ok:false,message:"Indikator tidak ditemukan pada komponen yang dipilih."},404);
    const result=await admin.from("gudep_penilaian_kriteria").update(values).eq("id_kriteria",idKriteria).select("*").single();saved=result.data;error=result.error;
   }else{
    const result=await admin.from("gudep_penilaian_kriteria").insert(values).select("*").single();saved=result.data;error=result.error;
   }
   if(error){if(error.code==="23505")return reply({ok:false,message:"Kode indikator sudah digunakan pada komponen ini."},409);throw error;}
   return reply({ok:true,kriteria:saved,message:"Indikator penilaian berhasil disimpan."});
  }
  if(action==="gudep_penilaian_nonaktifkan_kriteria"){
   const id=Number(body.id_kriteria);
   if(!Number.isInteger(id)||id<=0)return reply({ok:false,message:"Indikator tidak valid."},400);
   const {data:row,error:rowError}=await admin.from("gudep_penilaian_kriteria").select("id_kriteria,id_kategori,gudep_penilaian_kategori!inner(id_template)").eq("id_kriteria",id).maybeSingle();
   if(rowError)throw rowError;if(!row)return reply({ok:false,message:"Indikator tidak ditemukan."},404);
   const {data:tpl,error:tplError}=await admin.from("gudep_penilaian_template").select("status").eq("id_template",row.gudep_penilaian_kategori.id_template).single();
   if(tplError)throw tplError;if(tpl.status!=="draft")return reply({ok:false,message:"Template aktif tidak dapat diubah. Buat versi baru."},409);
   const {error}=await admin.from("gudep_penilaian_kriteria").update({aktif:false}).eq("id_kriteria",id);
   if(error)throw error;return reply({ok:true,message:"Indikator dinonaktifkan."});
  }
  if(action==="gudep_penilaian_aktifkan_template"){
   const id=Number(body.id_template);
   if(!Number.isInteger(id)||id<=0)return reply({ok:false,message:"Template tidak valid."},400);
   const {data:tpl,error:te}=await admin.from("gudep_penilaian_template").select("id_template,status").eq("id_template",id).single();
   if(te)throw te;if(tpl.status!=="draft")return reply({ok:false,message:"Template bukan berstatus draft."},409);
   const [{data:leaf,error:le},{data:criteria,error:ce}]=await Promise.all([
    admin.from("gudep_penilaian_kategori").select("id_kategori").eq("id_template",id).not("parent_id","is",null).eq("aktif",true),
    admin.from("gudep_penilaian_kriteria").select("id_kriteria,id_kategori,poin_maks").eq("aktif",true)
   ]);
   if(le)throw le;if(ce)throw ce;
   const leafIds=(leaf||[]).map(x=>x.id_kategori),criteriaForTemplate=(criteria||[]).filter(x=>leafIds.includes(x.id_kategori));
   const missing=leafIds.filter(x=>!criteriaForTemplate.some(k=>k.id_kategori===x));
   if(!leafIds.length||missing.length)return reply({ok:false,message:"Setiap komponen penilaian wajib memiliki minimal satu indikator aktif sebelum template dapat diaktifkan."},400);
   if(!criteriaForTemplate.length||criteriaForTemplate.some(x=>Number(x.poin_maks)<=0))return reply({ok:false,message:"Bobot indikator belum lengkap."},400);
   const {data:updated,error:updateError}=await admin.from("gudep_penilaian_template").update({status:"aktif",updated_at:new Date().toISOString()}).eq("id_template",id).select("*").single();
   if(updateError)throw updateError;
   return reply({ok:true,template:updated,message:"Template penilaian berhasil diaktifkan."});
  }
  if(action==="gudep_penilaian_simpan_periode"){
   const idTemplate=Number(body.id_template),tahun=Number(body.tahun),nama=clean(body.nama_periode,180);
   const mulai=clean(body.tanggal_mulai,10)||null,akhir=clean(body.tanggal_akhir,10)||null;
   if(!Number.isInteger(idTemplate)||idTemplate<=0||!Number.isInteger(tahun)||tahun<2020||tahun>2100||!nama)return reply({ok:false,message:"Nama periode, tahun, dan template wajib diisi."},400);
   if(mulai&&akhir&&akhir<mulai)return reply({ok:false,message:"Tanggal akhir tidak boleh lebih awal dari tanggal mulai."},400);
   const {data:tpl,error:te}=await admin.from("gudep_penilaian_template").select("id_template,status").eq("id_template",idTemplate).single();
   if(te)throw te;if(tpl.status!=="aktif")return reply({ok:false,message:"Aktifkan template dan lengkapi semua komponennya sebelum membuat periode."},400);
   const {data,error}=await admin.from("gudep_penilaian_periode").insert({id_template:idTemplate,nama_periode:nama,tahun,tanggal_mulai:mulai,tanggal_akhir:akhir,status:"draft",created_by:authData.user.id}).select("*").single();
   if(error){if(error.code==="23505")return reply({ok:false,message:"Periode terbuka untuk template dan tahun ini sudah ada."},409);throw error;}
   return reply({ok:true,periode:data,message:"Periode penilaian berhasil dibuat sebagai draft."});
  }
  if(action==="gudep_penilaian_ubah_status_periode"){
   const id=Number(body.id_periode),status=clean(body.status,20);
   if(!Number.isInteger(id)||id<=0||!["dibuka","ditutup"].includes(status))return reply({ok:false,message:"Periode atau status tidak valid."},400);
   const {data:periode,error:pe}=await admin.from("gudep_penilaian_periode").select("id_periode,id_template,tahun,status").eq("id_periode",id).single();
   if(pe)throw pe;
   if(status==="dibuka"){
    if(!["draft","ditutup"].includes(periode.status))return reply({ok:false,message:"Periode tidak dapat dibuka dari status saat ini."},409);
    const {data:tpl,error:te}=await admin.from("gudep_penilaian_template").select("status").eq("id_template",periode.id_template).single();
    if(te)throw te;if(tpl.status!=="aktif")return reply({ok:false,message:"Template penilaian belum aktif."},400);
    const {data:leaf,error:le}=await admin.from("gudep_penilaian_kategori").select("id_kategori").eq("id_template",periode.id_template).not("parent_id","is",null).eq("aktif",true);
    if(le)throw le;const leafIds=(leaf||[]).map(x=>x.id_kategori);
    if(!leafIds.length)return reply({ok:false,message:"Komponen penilaian belum tersedia."},400);
    const {count,error:ce}=await admin.from("gudep_penilaian_kriteria").select("id_kriteria",{count:"exact",head:true}).in("id_kategori",leafIds).eq("aktif",true);
    if(ce)throw ce;if(!count)return reply({ok:false,message:"Indikator penilaian wajib tersedia."},400);
   }else if(periode.status!=="dibuka")return reply({ok:false,message:"Hanya periode yang sedang dibuka yang dapat ditutup."},409);
   const {data:updated,error:updateError}=await admin.from("gudep_penilaian_periode").update({status,updated_at:new Date().toISOString()}).eq("id_periode",id).select("*").single();
   if(updateError){if(updateError.code==="23505")return reply({ok:false,message:"Sudah ada periode terbuka untuk template dan tahun ini."},409);throw updateError;}
   return reply({ok:true,periode:updated,message:status==="dibuka"?"Periode penilaian berhasil dibuka.":"Periode penilaian berhasil ditutup."});
  }
  if(action==="kwarran_management_data"){
   const [kwarran,pangkalan,admins,invites]=await Promise.all([
    admin.from("kwarran").select("id_kwarran,nama_kwarran").order("nama_kwarran"),
    admin.from("pangkalan").select("id_pangkalan,nama_pangkalan,no_gudep,id_kwarran").order("nama_pangkalan"),
    admin.from("admin_kwarran").select("id_user,id_kwarran,nama_lengkap,kwarran!inner(nama_kwarran),users!admin_kwarran_id_user_fkey!inner(email,status_akun)").order("nama_lengkap"),
    admin.from("kwarran_admin_invites").select("id_invite,id_kwarran,invite_code,created_at,used_at,revoked_at,kwarran!inner(nama_kwarran)").order("created_at",{ascending:false}).limit(100)
   ]);
   for(const x of [kwarran,pangkalan,admins,invites])if(x.error)throw x.error;
   return reply({ok:true,kwarran:kwarran.data||[],pangkalan:pangkalan.data||[],admins:admins.data||[],invites:invites.data||[]});
  }
  if(action==="kwarran_create"){
   const name=clean(body.nama_kwarran,120);
   if(!name)return reply({ok:false,message:"Nama Kwarran wajib diisi."},400);
   const {data,error}=await admin.from("kwarran").insert({nama_kwarran:name}).select("id_kwarran,nama_kwarran").single();
   if(error)throw error;
   return reply({ok:true,kwarran:data,message:"Kwarran berhasil ditambahkan."});
  }
  if(action==="kwarran_assign_pangkalan"){
   const idPangkalan=Number(body.id_pangkalan);
   const idKwarran=body.id_kwarran===null||body.id_kwarran===""?null:Number(body.id_kwarran);
   if(!Number.isInteger(idPangkalan)||idPangkalan<=0||idKwarran!==null&&(!Number.isInteger(idKwarran)||idKwarran<=0))return reply({ok:false,message:"Pangkalan atau Kwarran tidak valid."},400);
   if(idKwarran!==null){
    const {data:target,error:targetError}=await admin.from("kwarran").select("id_kwarran").eq("id_kwarran",idKwarran).maybeSingle();
    if(targetError)throw targetError;if(!target)return reply({ok:false,message:"Kwarran tidak ditemukan."},404);
   }
   const {data,error}=await admin.from("pangkalan").update({id_kwarran:idKwarran}).eq("id_pangkalan",idPangkalan).select("id_pangkalan").maybeSingle();
   if(error)throw error;if(!data)return reply({ok:false,message:"Pangkalan tidak ditemukan."},404);
   return reply({ok:true,message:"Pemetaan pangkalan berhasil diperbarui."});
  }
  if(action==="kwarran_create_invite"){
   const idKwarran=Number(body.id_kwarran);
   if(!Number.isInteger(idKwarran)||idKwarran<=0)return reply({ok:false,message:"Pilih Kwarran yang akan diberi undangan."},400);
   const {data:region,error:regionError}=await admin.from("kwarran").select("id_kwarran,nama_kwarran").eq("id_kwarran",idKwarran).maybeSingle();
   if(regionError)throw regionError;if(!region)return reply({ok:false,message:"Kwarran tidak ditemukan."},404);
   const inviteCode=crypto.randomUUID().replaceAll("-","").toUpperCase();
   const {data:invite,error:inviteError}=await admin.from("kwarran_admin_invites").insert({id_kwarran:idKwarran,invite_code:inviteCode,created_by:authData.user.id}).select("id_invite,invite_code,created_at").single();
   if(inviteError)throw inviteError;
   return reply({ok:true,invite:{...invite,nama_kwarran:region.nama_kwarran},message:"Undangan Admin Kwarran berhasil dibuat. Bagikan nama Kwarran dan kode aktivasi ini kepada orang yang ditunjuk."});
  }
  if(action==="bootstrap_admin"){
   const {error}=await admin.from("users").upsert({id_user:authData.user.id,email:configuredEmail,role:"admin_kwarcab",status_akun:"aktif"},{onConflict:"id_user"});
   if(error)throw error;return reply({ok:true,message:"Akun Admin Utama aktif."});
  }
  if(action==="dashboard"){
   const [pangkalan,rekap,pembina,peserta,progress,sku,peringkatPangkalan,peringkatKwarran]=await Promise.all([
    admin.from("pangkalan").select("id_pangkalan,id_kwarran,nama_pangkalan,no_gudep,nama_ambalan_putra,nama_ambalan_putri,nama_ketua_gudep,nama_ketua_mabigus,kode_gabung_peserta,created_at,kwarran(nama_kwarran)").order("nama_pangkalan"),
    admin.from("v_admin_ambalan_rekap").select("*").order("nama_pangkalan").order("jenis_kelamin").order("urutan_ambalan"),
    admin.from("profil_pembina").select("id_pembina,id_user,id_pangkalan,nama_lengkap,jabatan,jenis_kelamin,nta,jumlah_ambalan_berbayar,users!inner(email,status_akun)").order("nama_lengkap"),
    admin.from("profil_peserta_didik").select("id_peserta,id_user,id_pangkalan,nama_lengkap,jenis_kelamin,nta,tingkatan,sangga,kelas_sekolah,jurusan,tahun_pelajaran,status_keanggotaan,tanggal_alumni").order("nama_lengkap"),
    admin.from("sku_learning_progress").select("id_progress,id_user,id_sku_item,status").order("id_progress",{ascending:false}),
    admin.from("sku_items").select("id_sku_item,tingkat").eq("aktif",true),
    admin.from("v_pangkalan_peringkat").select("*").order("id_kwarran").order("peringkat_kwarran",{ascending:true,nullsFirst:false}).order("nama_pangkalan"),
    admin.from("v_kwarran_comparison").select("*").order("peringkat_kwarran",{ascending:true,nullsFirst:false}).order("nama_kwarran")
   ]);
   for(const x of [pangkalan,rekap,pembina,peserta,progress,sku,peringkatPangkalan,peringkatKwarran])if(x.error)throw x.error;
   const pangkalanMap=new Map((pangkalan.data||[]).map(x=>[String(x.id_pangkalan),x]));
   const skuMap=new Map((sku.data||[]).map(x=>[String(x.id_sku_item),x]));
   const latest=new Map();
   for(const row of progress.data||[]){
    const key=row.id_user+":"+row.id_sku_item;
    if(!latest.has(key))latest.set(key,row);
   }
   const emptyCounts=()=>({Bantara:{lulus:0,siap_diuji:0,perlu_perbaikan:0,dipelajari:0},Laksana:{lulus:0,siap_diuji:0,perlu_perbaikan:0,dipelajari:0}});
   const progressByUser=new Map();
   for(const row of latest.values()){
    const item=skuMap.get(String(row.id_sku_item));
    if(!item)continue;
    const counts=progressByUser.get(row.id_user)||emptyCounts();
    if(Object.prototype.hasOwnProperty.call(counts[item.tingkat]||{},row.status))counts[item.tingkat][row.status]++;
    progressByUser.set(row.id_user,counts);
   }
   const pesertaDetail=(peserta.data||[]).map(p=>{
    const g=pangkalanMap.get(String(p.id_pangkalan))||{};
    return {...p,nama_pangkalan:g.nama_pangkalan||"-",no_gudep:g.no_gudep||"",nama_ambalan:p.jenis_kelamin==="L"?(g.nama_ambalan_putra||"Ambalan Putra"):(g.nama_ambalan_putri||"Ambalan Putri"),progress:progressByUser.get(p.id_user)||emptyCounts()};
   });
   const rekapDenganKwarran=(rekap.data||[]).map(x=>{const g=pangkalanMap.get(String(x.id_pangkalan))||{};return {...x,id_kwarran:g.id_kwarran||null,nama_kwarran:g.kwarran?.nama_kwarran||"-"};});
   const {data:kwarran,error:kwarranError}=await admin.from("kwarran").select("id_kwarran,nama_kwarran").order("nama_kwarran");if(kwarranError)throw kwarranError;
   return reply({ok:true,pangkalan:pangkalan.data,rekap:rekapDenganKwarran,peringkat_pangkalan:peringkatPangkalan.data||[],peringkat_kwarran:peringkatKwarran.data||[],kwarran:kwarran||[],pembina:pembina.data,peserta:pesertaDetail});
  }
  if(action==="buat_kode_akses"){
   const targetId=clean(body.id_pembina,50);if(!targetId)return reply({ok:false,message:"Pilih akun Pembina."},400);
   const {data:target,error:te}=await admin.from("profil_pembina").select("id_user,nta").eq("id_user",targetId).maybeSingle();if(te)throw te;if(!target)return reply({ok:false,message:"Akun Pembina tidak ditemukan."},404);if(!clean(target.nta,80))return reply({ok:false,message:"Pembina harus melengkapi NTA/KTA sebelum menerima kode akses tambahan."},403);
   const code="RT-"+crypto.randomUUID().replaceAll("-","").slice(0,10).toUpperCase();
   const {error}=await admin.from("pembina_access_codes").insert({id_pembina:targetId,kode_akses:code,tambahan_kuota:32,akses_tanpa_batas:false,dibuat_oleh:authData.user.id});if(error)throw error;
   return reply({ok:true,kode_akses:code,message:"Kode penambahan satu ambalan (32 peserta) berhasil dibuat."});
  }
  return reply({ok:false,message:"Aksi tidak dikenal."},400);
 }catch(error){console.error(error);return reply({ok:false,message:"Kesalahan server. Periksa log Edge Function."},500);}
});