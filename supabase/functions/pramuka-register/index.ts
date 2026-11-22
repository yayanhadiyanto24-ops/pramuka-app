import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
const clean=(v:unknown,max=180)=>typeof v==="string"?v.trim().slice(0,max):"";
// Ambil seluruh baris bertahap agar batas PostgREST tidak memotong dashboard.
async function fetchAllRows(buildQuery:()=>any,pageSize=500){
 const rows:any[]=[];
 for(let offset=0;;offset+=pageSize){
  const {data,error}=await buildQuery().range(offset,offset+pageSize-1);
  if(error)throw error;
  const page=data||[];
  rows.push(...page);
  if(page.length<pageSize)break;
 }
 return {data:rows,error:null};
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return reply({ok:false,message:"Metode tidak didukung."},405);
 const url=Deno.env.get("SUPABASE_URL")!,secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,anon=Deno.env.get("SUPABASE_ANON_KEY");
 if(!url||!secret)return reply({ok:false,message:"Konfigurasi server belum lengkap."},500);
 const admin=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
 try{
  const body=await req.json(),action=clean(body.action||"register",60);
  if(action==="qr_login"){
   const qrId=clean(body.id_qr_kta,9);
   if(!/^\d{9}$/.test(qrId))return reply({ok:false,message:"ID QR KTA harus tepat 9 digit."},400);
   const {data:registry,error:registryError}=await admin.from("kta_nasional_registry").select("id_user,role").eq("id_qr_kta",qrId).maybeSingle();
   if(registryError)throw registryError;
   if(!registry)return reply({ok:false,message:"QR KTA tidak terdaftar. Lengkapi profil dan daftarkan KTA terlebih dahulu."},404);
   const {data:profile,error:profileError}=await admin.from("users").select("email,status_akun").eq("id_user",registry.id_user).maybeSingle();
   if(profileError)throw profileError;
   if(!profile?.email||profile.status_akun!=="aktif")return reply({ok:false,message:"Profil belum lengkap atau akun belum aktif. Silakan gunakan Email & Sandi atau hubungi Pembina."},403);
   const resendKey=Deno.env.get("RESEND_API_KEY");
   const resendFrom=Deno.env.get("RESEND_FROM_EMAIL")||"onboarding@resend.dev";
   if(!resendKey)return reply({ok:false,message:"Layanan email konfirmasi belum dikonfigurasi. Hubungi Admin Utama."},503);
   const rawToken=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
   const tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(rawToken)))).map(x=>x.toString(16).padStart(2,"0")).join("");
   const {data:attempt,error:insertError}=await admin.from("qr_login_approvals").insert({user_id:registry.id_user,token_hash:tokenHash,status:"pending",expires_at:new Date(Date.now()+5*60*1000).toISOString()}).select("id").single();
   if(insertError)throw insertError;
   const baseUrl="https://yayanhadiyanto24-ops.github.io/pramuka-app/login-confirm.html";
   const yesUrl=baseUrl+"?token="+rawToken+"&decision=yes";
   const noUrl=baseUrl+"?token="+rawToken+"&decision=no";
   const emailHtml=`<!doctype html><html lang="id"><body style="margin:0;background:#f6f1e8;font-family:Arial,sans-serif;color:#302313;padding:24px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:16px;padding:26px;border:1px solid #e8d7b7"><h2 style="margin-top:0;color:#604323">Konfirmasi Login Ruang Tegak</h2><p>Ada permintaan masuk ke Ruang Tegak menggunakan pemindaian QR KTA Nasional.</p><p><b>Apakah itu Anda?</b></p><p style="color:#765235">Tautan ini berlaku selama 5 menit. Halaman berikutnya akan meminta konfirmasi sekali lagi sebelum keputusan dikirim.</p><p><a href="${yesUrl}" style="display:inline-block;background:#27733d;color:#fff;text-decoration:none;padding:13px 24px;border-radius:9px;font-weight:bold;margin-right:8px">YA, ITU SAYA</a> <a href="${noUrl}" style="display:inline-block;background:#a52b2b;color:#fff;text-decoration:none;padding:13px 24px;border-radius:9px;font-weight:bold">BUKAN SAYA</a></p><p style="font-size:12px;color:#777">Jika Anda tidak sedang mencoba masuk, pilih BUKAN SAYA atau abaikan email ini.</p></div></body></html>`;
   let mailRes:Response;
   try{mailRes=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+resendKey,"Content-Type":"application/json"},body:JSON.stringify({from:"Ruang Tegak <"+resendFrom+">",to:[String(profile.email).trim().toLowerCase()],subject:"Konfirmasi Login Ruang Tegak",html:emailHtml})});}
   catch(mailError){await admin.from("qr_login_approvals").delete().eq("id",attempt.id);console.error("Resend connection error",String(mailError));return reply({ok:false,message:"Server belum berhasil terhubung ke layanan email Resend. Coba lagi nanti."},503);}
   if(!mailRes.ok){const detail=await mailRes.text();await admin.from("qr_login_approvals").delete().eq("id",attempt.id);console.error("Resend error",mailRes.status,detail);return reply({ok:false,message:mailRes.status===403?"Pengiriman email belum diizinkan Resend. Email penerima harus diizinkan untuk mode uji coba atau domain pengirim harus diverifikasi.":"Email konfirmasi ditolak oleh Resend. Periksa konfigurasi API Key dan alamat pengirim."},502);}
   return reply({ok:true,approval_token:rawToken,message:"Email konfirmasi telah dikirim ke alamat email yang terdaftar. Buka email dan pilih YA atau BUKAN."});
  }
  if(action==="qr_login_decide"){
   const rawToken=clean(body.token,128),decision=clean(body.decision,8);
   if(!/^[a-f0-9]{64}$/.test(rawToken)||!["yes","no"].includes(decision))return reply({ok:false,message:"Tautan konfirmasi tidak valid."},400);
   const tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(rawToken)))).map(x=>x.toString(16).padStart(2,"0")).join("");
   const {data:row,error}=await admin.from("qr_login_approvals").select("id,status,expires_at").eq("token_hash",tokenHash).maybeSingle();
   if(error)throw error;if(!row)return reply({ok:false,message:"Tautan konfirmasi tidak ditemukan atau sudah digunakan."},404);
   if(new Date(row.expires_at).getTime()<Date.now())return reply({ok:false,message:"Waktu konfirmasi sudah berakhir. Silakan pindai QR lagi."},410);
   if(row.status!=="pending")return reply({ok:false,message:row.status==="approved"?"Login sudah disetujui. Kembali ke perangkat pemindai QR.":row.status==="denied"?"Permintaan login sudah ditolak.":"Tautan sudah tidak aktif."},409);
   const next=decision==="yes"?"approved":"denied";
   const {data:changed,error:changeError}=await admin.from("qr_login_approvals").update({status:next,decided_at:new Date().toISOString()}).eq("id",row.id).eq("status","pending").select("id").maybeSingle();
   if(changeError)throw changeError;if(!changed)return reply({ok:false,message:"Permintaan sudah diproses sebelumnya."},409);
   return reply({ok:true,status:next,message:decision==="yes"?"Login disetujui. Kembali ke perangkat yang memindai QR.":"Login ditolak. Jika bukan Anda yang meminta, akun tetap tidak akan dibuka."});
  }
  if(action==="qr_login_status"){
   const rawToken=clean(body.token,128);if(!/^[a-f0-9]{64}$/.test(rawToken))return reply({ok:false,message:"Token permintaan tidak valid."},400);
   const tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(rawToken)))).map(x=>x.toString(16).padStart(2,"0")).join("");
   const {data:row,error}=await admin.from("qr_login_approvals").select("status,expires_at").eq("token_hash",tokenHash).maybeSingle();
   if(error)throw error;if(!row)return reply({ok:false,message:"Permintaan login tidak ditemukan."},404);
   if(new Date(row.expires_at).getTime()<Date.now()&&row.status==="pending")return reply({ok:true,status:"expired"});
   return reply({ok:true,status:row.status});
  }
  if(action==="qr_login_exchange"){
   const rawToken=clean(body.token,128);if(!/^[a-f0-9]{64}$/.test(rawToken))return reply({ok:false,message:"Token permintaan tidak valid."},400);
   if(!anon)return reply({ok:false,message:"Konfigurasi autentikasi server belum lengkap."},500);
   const tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(rawToken)))).map(x=>x.toString(16).padStart(2,"0")).join("");
   const {data:row,error}=await admin.from("qr_login_approvals").select("id,user_id,status,expires_at").eq("token_hash",tokenHash).maybeSingle();
   if(error)throw error;if(!row||row.status!=="approved"||new Date(row.expires_at).getTime()<Date.now())return reply({ok:false,message:"Login belum disetujui atau waktu konfirmasi sudah berakhir."},403);
   const {data:locked,error:lockError}=await admin.from("qr_login_approvals").update({status:"processing"}).eq("id",row.id).eq("status","approved").select("id").maybeSingle();
   if(lockError)throw lockError;if(!locked)return reply({ok:false,message:"Permintaan login sedang atau sudah diproses."},409);
   try{
    const {data:linkData,error:linkError}=await admin.auth.admin.generateLink({type:"magiclink",email:(await admin.from("users").select("email").eq("id_user",row.user_id).single()).data.email});
    if(linkError)throw linkError;
    const tokenHashAuth=linkData?.properties?.hashed_token;if(!tokenHashAuth)throw new Error("Token sesi tidak berhasil dibuat.");
    const authClient=createClient(url,anon,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data:verified,error:verifyError}=await authClient.auth.verifyOtp({token_hash:tokenHashAuth,type:"magiclink"});
    if(verifyError||!verified?.session||verified.user?.id!==row.user_id)throw new Error("Verifikasi sesi login gagal.");
    const {error:consumeError}=await admin.from("qr_login_approvals").update({status:"consumed"}).eq("id",row.id).eq("status","processing");
    if(consumeError)throw consumeError;
    return reply({ok:true,session:{access_token:verified.session.access_token,refresh_token:verified.session.refresh_token},user:{id:verified.user.id}});
   }catch(exchangeError){await admin.from("qr_login_approvals").update({status:"approved"}).eq("id",row.id).eq("status","processing");throw exchangeError;}
  }
  if(action==="kwarran_registration_options"){
   const {data,error}=await fetchAllRows(()=>admin.from("kwarran").select("id_kwarran,nama_kwarran").order("nama_kwarran"));
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
  if(action==="sekretaris_register"){
   const token=clean(body.token,128),email=clean(body.email,254).toLowerCase(),password=typeof body.password==="string"?body.password:"",name=clean(body.nama_lengkap,150);
   if(!/^[a-f0-9]{64}$/i.test(token)||!email.includes("@")||password.length<10||!name)return reply({ok:false,message:"Lengkapi nama, email, dan password minimal 10 karakter."},400);
   const {data:existingSecretary,error:secretaryError}=await admin.from("sekretaris_kwarcab").select("id_user").eq("singleton",true).maybeSingle();
   if(secretaryError)throw secretaryError;
   if(existingSecretary)return reply({ok:false,message:"Pendaftaran Sekretaris Kwarcab sudah ditutup karena akun telah dibuat."},409);
   const {data:existingUser,error:existingUserError}=await admin.from("users").select("id_user").eq("email",email).maybeSingle();
   if(existingUserError)throw existingUserError;
   if(existingUser)return reply({ok:false,message:"Email ini sudah digunakan akun lain. Gunakan email pribadi yang belum terdaftar."},409);
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,"0")).join("");
   const {data:invite,error:inviteError}=await admin.from("sekretaris_kwarcab_invites").select("id_invite").eq("token_hash",hash).is("used_at",null).is("revoked_at",null).maybeSingle();
   if(inviteError)throw inviteError;
   if(!invite)return reply({ok:false,message:"Link pendaftaran tidak valid, sudah digunakan, atau telah ditutup."},404);
   const now=new Date().toISOString();
   const {data:claimed,error:claimError}=await admin.from("sekretaris_kwarcab_invites").update({used_at:now}).eq("id_invite",invite.id_invite).is("used_at",null).is("revoked_at",null).select("id_invite").maybeSingle();
   if(claimError)throw claimError;
   if(!claimed)return reply({ok:false,message:"Link pendaftaran baru saja digunakan. Link ini hanya berlaku satu kali."},409);
   let userId:string|null=null;
   try{
    const {data:created,error:createError}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:name}});
    if(createError||!created.user)throw createError||new Error("Akun tidak dapat dibuat.");
    userId=created.user.id;
    const {error:userError}=await admin.from("users").insert({id_user:userId,email,role:"sekretaris_kwarcab",status_akun:"aktif"});
    if(userError)throw userError;
    const {error:profileError}=await admin.from("sekretaris_kwarcab").insert({singleton:true,id_user:userId,nama_lengkap:name});
    if(profileError)throw profileError;
    const {error:consumeError}=await admin.from("sekretaris_kwarcab_invites").update({used_by:userId}).eq("id_invite",invite.id_invite);
    if(consumeError)throw consumeError;
    return reply({ok:true,message:"Pendaftaran Sekretaris Kwarcab berhasil. Silakan masuk menggunakan email dan password yang baru dibuat."});
   }catch(createFailure){
    if(userId){await admin.from("sekretaris_kwarcab").delete().eq("id_user",userId);await admin.from("users").delete().eq("id_user",userId);await admin.auth.admin.deleteUser(userId);}
    await admin.from("sekretaris_kwarcab_invites").update({used_at:null,used_by:null}).eq("id_invite",invite.id_invite);
    throw createFailure;
   }
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


  if(action==="sekretaris_dashboard"){
   const {data:me,error:meError}=await admin.from("users").select("role,status_akun").eq("id_user",authData.user.id).maybeSingle();
   if(meError)throw meError;
   if(!me||me.role!=="sekretaris_kwarcab"||me.status_akun!=="aktif")return reply({ok:false,message:"Akses Sekretaris Kwarcab sudah ditutup atau tidak aktif."},403);
   const {data:secretary,error:secretaryError}=await admin.from("sekretaris_kwarcab").select("nama_lengkap").eq("id_user",authData.user.id).eq("singleton",true).maybeSingle();
   if(secretaryError)throw secretaryError;
   if(!secretary)return reply({ok:false,message:"Data akun Sekretaris Kwarcab tidak ditemukan."},403);
   const [pangkalan,rekap,pembina,peserta,progress,sku,peringkatPangkalan,peringkatKwarran,kwarranResult]=await Promise.all([
    fetchAllRows(()=>admin.from("pangkalan").select("id_pangkalan,id_kwarran,nama_pangkalan,no_gudep,nama_ambalan_putra,nama_ambalan_putri,nama_ketua_gudep,nama_ketua_mabigus,created_at,kwarran(nama_kwarran)").order("nama_pangkalan").order("id_pangkalan")),
    fetchAllRows(()=>admin.from("v_admin_ambalan_rekap").select("*").order("nama_pangkalan").order("jenis_kelamin").order("urutan_ambalan")),
    fetchAllRows(()=>admin.from("profil_pembina").select("id_pembina,id_user,id_pangkalan,nama_lengkap,jabatan,jenis_kelamin,nta,nta_status_verifikasi,users!inner(email,status_akun)").order("nama_lengkap").order("id_pembina")),
    fetchAllRows(()=>admin.from("profil_peserta_didik").select("id_peserta,id_user,id_pangkalan,nama_lengkap,jenis_kelamin,nta,tingkatan,sangga,kelas_sekolah,jurusan,tahun_pelajaran,status_keanggotaan,tanggal_alumni").order("nama_lengkap").order("id_peserta")),
    fetchAllRows(()=>admin.from("sku_learning_progress").select("id_progress,id_user,id_sku_item,status,mulai_belajar_at,diajukan_at,diperiksa_at").order("id_progress",{ascending:false})),
    fetchAllRows(()=>admin.from("sku_items").select("id_sku_item,tingkat,kode_butir,nomor_butir,judul_butir,area_pengembangan,kompetensi_dasar,aktif").eq("aktif",true).order("tingkat").order("urutan")),
    fetchAllRows(()=>admin.from("v_pangkalan_peringkat").select("*").order("id_kwarran").order("peringkat_kwarran",{ascending:true,nullsFirst:false}).order("nama_pangkalan")),
    fetchAllRows(()=>admin.from("v_kwarran_comparison").select("*").order("peringkat_kwarran",{ascending:true,nullsFirst:false}).order("nama_kwarran")),
    fetchAllRows(()=>admin.from("kwarran").select("id_kwarran,nama_kwarran").order("nama_kwarran"))
   ]);
   for(const x of [pangkalan,rekap,pembina,peserta,progress,sku,peringkatPangkalan,peringkatKwarran,kwarranResult])if(x.error)throw x.error;
   const pangkalanMap=new Map((pangkalan.data||[]).map(x=>[String(x.id_pangkalan),x]));
   const skuMap=new Map((sku.data||[]).map(x=>[String(x.id_sku_item),x]));
   const latest=new Map();
   for(const row of progress.data||[]){const key=row.id_user+":"+row.id_sku_item;if(!latest.has(key))latest.set(key,row);}
   const emptyCounts=()=>({Bantara:{lulus:0,siap_diuji:0,perlu_perbaikan:0,dipelajari:0},Laksana:{lulus:0,siap_diuji:0,perlu_perbaikan:0,dipelajari:0}});
   const progressByUser=new Map();
   for(const row of latest.values()){const item=skuMap.get(String(row.id_sku_item));if(!item)continue;const counts=progressByUser.get(row.id_user)||emptyCounts();if(Object.prototype.hasOwnProperty.call(counts[item.tingkat]||{},row.status))counts[item.tingkat][row.status]++;progressByUser.set(row.id_user,counts);}
   const pesertaDetail=(peserta.data||[]).map(p=>{const g=pangkalanMap.get(String(p.id_pangkalan))||{};return {...p,nama_pangkalan:g.nama_pangkalan||"-",no_gudep:g.no_gudep||"",nama_ambalan:p.jenis_kelamin==="L"?(g.nama_ambalan_putra||"Ambalan Putra"):(g.nama_ambalan_putri||"Ambalan Putri"),progress:progressByUser.get(p.id_user)||emptyCounts()};});
   const rekapDenganKwarran=(rekap.data||[]).map(x=>{const g=pangkalanMap.get(String(x.id_pangkalan))||{};return {...x,id_kwarran:g.id_kwarran||null,nama_kwarran:g.kwarran?.nama_kwarran||"-"};});
   const kwarran=kwarranResult.data||[];
   const pembinaDetail=(pembina.data||[]).map(p=>({...p,nama_pangkalan:pangkalanMap.get(String(p.id_pangkalan))?.nama_pangkalan||"-"}));
   const participantMap=new Map(pesertaDetail.map(p=>[p.id_user,p]));
   const skuMapDetail=new Map((sku.data||[]).map(x=>[String(x.id_sku_item),x]));
   const progressDetail=[...latest.values()].map(row=>{const person=participantMap.get(row.id_user),item=skuMapDetail.get(String(row.id_sku_item));if(!person||!item)return null;return {nama_peserta:person.nama_lengkap,nama_pangkalan:person.nama_pangkalan,nama_ambalan:person.nama_ambalan,tingkat:item.tingkat,kode_butir:item.kode_butir,nomor_butir:item.nomor_butir,judul_butir:item.judul_butir,status:row.status,mulai_belajar_at:row.mulai_belajar_at,diajukan_at:row.diajukan_at,diperiksa_at:row.diperiksa_at};}).filter(Boolean);
   return reply({ok:true,sekretaris:secretary.nama_lengkap,pangkalan:pangkalan.data||[],rekap:rekapDenganKwarran,peringkat_pangkalan:peringkatPangkalan.data||[],peringkat_kwarran:peringkatKwarran.data||[],kwarran,pembina:pembinaDetail,peserta:pesertaDetail,sku_items:sku.data||[],progress_detail:progressDetail});
  }

  if(action==="kwarran_options"){
   const {data:me,error:meError}=await admin.from("users").select("role,status_akun").eq("id_user",authData.user.id).maybeSingle();
   if(meError)throw meError;if(!me||me.role!=="pembina"||me.status_akun!=="aktif")return reply({ok:false,message:"Akses hanya untuk Pembina aktif."},403);
   const {data,error}=await fetchAllRows(()=>admin.from("kwarran").select("id_kwarran,nama_kwarran").order("nama_kwarran"));if(error)throw error;
   return reply({ok:true,kwarran:data||[]});
  }


  if(action==="admin_kwarran_dashboard"){
   const {data:me,error:meError}=await admin.from("users").select("role,status_akun").eq("id_user",authData.user.id).maybeSingle();
   if(meError)throw meError;
   if(!me||me.role!=="admin_kwarran"||me.status_akun!=="aktif")return reply({ok:false,message:"Akses hanya untuk Admin Kwarran aktif."},403);
   const {data:assignment,error:assignmentError}=await admin.from("admin_kwarran").select("id_kwarran,nama_lengkap,kwarran!inner(id_kwarran,nama_kwarran)").eq("id_user",authData.user.id).maybeSingle();
   if(assignmentError)throw assignmentError;
   if(!assignment)return reply({ok:false,message:"Akun Admin Kwarran belum ditetapkan wilayahnya. Hubungi Admin Utama."},403);
   const [comparison,pangkalan]=await Promise.all([
    fetchAllRows(()=>admin.from("v_kwarran_comparison").select("*").order("nama_kwarran")),
    fetchAllRows(()=>admin.from("pangkalan").select("id_pangkalan,nama_pangkalan,no_gudep,nama_ambalan_putra,nama_ambalan_putri").eq("id_kwarran",assignment.id_kwarran).order("nama_pangkalan").order("id_pangkalan"))
   ]);
   if(comparison.error)throw comparison.error;if(pangkalan.error)throw pangkalan.error;
   const ids=(pangkalan.data||[]).map(x=>x.id_pangkalan);
   let rekap=[],rankingPangkalan:any[]=[];
   if(ids.length){
    const [{data:rows,error:rowsError},{data:ranking,error:rankingError}]=await Promise.all([
     fetchAllRows(()=>admin.from("v_admin_ambalan_rekap").select("*").in("id_pangkalan",ids).order("nama_pangkalan").order("jenis_kelamin")),
     fetchAllRows(()=>admin.from("v_pangkalan_peringkat").select("*").eq("id_kwarran",assignment.id_kwarran).order("peringkat_kwarran",{ascending:true,nullsFirst:false}).order("nama_pangkalan"))
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
    const {data:student,error:studentError}=await admin.from("profil_peserta_didik").select("tingkatan,nta,id_qr_kta,tanggal_lahir").eq("id_user",authData.user.id).single();if(studentError)throw studentError;
    const nta=clean(body.nta,80)||null;
    const qrId=clean(body.id_qr_kta,9)||null;
    if(!qrId||!/^\d{9}$/.test(qrId))return reply({ok:false,message:"ID QR KTA Nasional wajib berupa tepat 9 digit hasil pemindaian."},400);
    if(!nta)return reply({ok:false,message:"Nomor NTA wajib diisi terpisah dari ID QR KTA."},400);
    const birthDate=typeof body.tanggal_lahir==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(body.tanggal_lahir)?body.tanggal_lahir:null;
    if(body.tanggal_lahir&&!birthDate)return reply({ok:false,message:"Tanggal lahir tidak valid."},400);
    if(nta){
     const match=nta.match(/^(\d{2})\.(\d{2})\.(\d{2})\.(\d{6})\.(\d{4})$/);
     if(!match)return reply({ok:false,message:"Format NTA harus lima kelompok angka dipisahkan titik, misalnya 09.03.30.200780.0001 untuk Kwarran Leles, Cianjur."},400);
     if(!birthDate)return reply({ok:false,message:"Isi tanggal lahir sesuai KTA terlebih dahulu."},400);
     const d=new Date(birthDate+"T00:00:00Z");
     if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==birthDate)return reply({ok:false,message:"Tanggal lahir tidak valid."},400);
     const encodedBirth=birthDate.slice(8,10)+birthDate.slice(5,7)+birthDate.slice(2,4);
     if(match[4]!==encodedBirth)return reply({ok:false,message:"Enam digit tanggal lahir pada NTA tidak cocok dengan tanggal lahir profil."},400);
    }
    const jabatanAmbalan=clean(body.jabatan_ambalan,100),jabatanSangga=clean(body.jabatan_sangga,30);
    if(jabatanAmbalan==="Lainnya"||jabatanSangga&&!["Pinsa","Wapinsa","Anggota"].includes(jabatanSangga))return reply({ok:false,message:"Pilihan jabatan tidak valid."},400);
    const patch={nta,id_qr_kta:qrId,tanggal_lahir:birthDate,foto_profil_data:photo||null,jabatan_ambalan:jabatanAmbalan||null,jabatan_sangga:jabatanSangga||null,pengalaman_kegiatan:Array.isArray(body.pengalaman_kegiatan)?body.pengalaman_kegiatan.slice(0,40):[],organisasi_aktif:Array.isArray(body.organisasi_aktif)?body.organisasi_aktif.slice(0,30):[]};
    if(ktaEvidence){patch.nta_bukti_kta=ktaEvidence;patch.nta_status_verifikasi="menunggu";}
    else if(student.nta!==nta||student.tanggal_lahir!==birthDate)patch.nta_status_verifikasi="belum_ada";
    if(student.tingkatan==="Calon Penegak"&&!nta)patch.tingkatan="Peserta Tamu";
    const {error}=await admin.from("profil_peserta_didik").update(patch).eq("id_user",authData.user.id);if(error){if(error.code==="23505")return reply({ok:false,message:"ID QR KTA atau NTA sudah terdaftar pada anggota lain."},409);throw error;}
   }else if(me.role==="pembina"){
    const {data:currentTeacher,error:currentTeacherError}=await admin.from("profil_pembina").select("nta,id_qr_kta,nta_status_verifikasi").eq("id_user",authData.user.id).single();if(currentTeacherError)throw currentTeacherError;
    const teacherNta=clean(body.nta,80)||null;
    const qrId=clean(body.id_qr_kta,9)||null;
    if(!qrId||!/^\d{9}$/.test(qrId))return reply({ok:false,message:"ID QR KTA Nasional wajib berupa tepat 9 digit hasil pemindaian."},400);
    if(!teacherNta)return reply({ok:false,message:"Nomor NTA wajib diisi terpisah dari ID QR KTA."},400);
    if(!/^\d{2}\.\d{2}\.\d{2}\.\d{6}\.\d{4}$/.test(teacherNta))return reply({ok:false,message:"Format NTA Pembina harus AA.BB.CC.DDMMYY.XXXX."},400);
    const years={tahun_kmd:body.tahun_kmd,tahun_kml:body.tahun_kml,tahun_kpd:body.tahun_kpd,tahun_kpl:body.tahun_kpl};
    for(const [k,v] of Object.entries(years))if(v!==null&&v!==undefined&&v!==""&&(!Number.isInteger(Number(v))||Number(v)<1950||Number(v)>new Date().getFullYear()+1))return reply({ok:false,message:"Tahun pendidikan Pembina tidak valid."},400);
    const patch={nta:teacherNta,id_qr_kta:qrId,foto_profil_data:photo||null,tahun_kmd:years.tahun_kmd?Number(years.tahun_kmd):null,tahun_kml:years.tahun_kml?Number(years.tahun_kml):null,tahun_kpd:years.tahun_kpd?Number(years.tahun_kpd):null,tahun_kpl:years.tahun_kpl?Number(years.tahun_kpl):null,tanda_tangan_data:typeof body.tanda_tangan_data==="string"&&body.tanda_tangan_data.startsWith("data:image/")&&body.tanda_tangan_data.length<300000?body.tanda_tangan_data:null,paraf_data:typeof body.paraf_data==="string"&&body.paraf_data.startsWith("data:image/")&&body.paraf_data.length<150000?body.paraf_data:null};
    if(ktaEvidence){
     // Foto KTA disimpan sebagai bukti; OCR tidak menjadi syarat simpan.
     // Pembina melakukan validasi akhir terhadap NTA dan foto KTA.
     patch.nta_bukti_kta=ktaEvidence;patch.nta_status_verifikasi="menunggu";
    }else if(currentTeacher.nta!==teacherNta)patch.nta_status_verifikasi="belum_ada";
    const {error}=await admin.from("profil_pembina").update(patch).eq("id_user",authData.user.id);if(error){if(error.code==="23505")return reply({ok:false,message:"ID QR KTA atau NTA sudah terdaftar pada anggota lain."},409);throw error;}
   }else if(me.role==="admin_utama"){
    const {error}=await admin.from("users").update({foto_profil_data:photo||null}).eq("id_user",authData.user.id);if(error)throw error;
   }else return reply({ok:false,message:"Peran akun tidak diizinkan."},403);
   return reply({ok:true,message:"Profil berhasil disimpan."});
  }
  if(action==="pembina_pangkalan"||action==="simpan_pangkalan_pembina"||action==="simpan_tanda_tangan_pangkalan"||action==="pembina_peserta_pending"||action==="setujui_peserta_pembina"||action==="pembina_sangga_data"||action==="pindah_sangga_peserta"||action==="pindah_ambalan_peserta"||action==="activate_access_code"){
   const {data:authData,error:authErr}=await admin.auth.getUser(token);
   if(authErr||!authData.user)return reply({ok:false,message:"Sesi login tidak valid."},401);
   const {data:pb,error:pbErr}=await admin.from("profil_pembina").select("id_pangkalan,id_user,jabatan,jenis_kelamin,nta,id_qr_kta,nta_bukti_kta,jumlah_ambalan_berbayar,users!inner(status_akun,role)").eq("id_user",authData.user.id).maybeSingle();
   if(pbErr)throw pbErr;
   if(!pb||pb.users?.status_akun!=="aktif"||pb.users?.role!=="pembina")return reply({ok:false,message:"Akses hanya untuk akun Pembina aktif."},403);
   if(action==="activate_access_code"){
    if(!clean(pb.nta,80)||!pb.nta_bukti_kta?.path)return reply({ok:false,message:"Untuk melampaui kuota 5 peserta, Pembina wajib mengisi NTA dan mengunggah foto KTA."},403);
    const code=clean(body.kode_akses,40).toUpperCase();if(!code)return reply({ok:false,message:"Masukkan kode akses dari Admin Utama."},400);
    const {data:row,error}=await admin.from("pembina_access_codes").select("id,akses_tanpa_batas,tambahan_kuota").eq("kode_akses",code).eq("id_pembina",authData.user.id).eq("status","aktif").maybeSingle();if(error)throw error;
    if(!row)return reply({ok:false,message:"Kode akses tidak ditemukan, sudah dipakai, atau bukan untuk akun ini."},404);
    if(row.akses_tanpa_batas===true||Number(row.tambahan_kuota)!==32)return reply({ok:false,message:"Kode lama tidak berlaku untuk penambahan ambalan. Minta kode baru kepada Admin Utama."},400);
    const {data:jumlah,error:activationError}=await admin.rpc("pramuka_activate_ambalan_code",{p_code:code,p_user_id:authData.user.id});if(activationError)throw activationError;
    const total=Number(jumlah||0);
    return reply({ok:true,jumlah_ambalan_berbayar:total,kuota_maksimal:total*32,message:"Kode berhasil diaktifkan. Satu ambalan tambahan terbuka untuk 32 peserta didik. Total kuota kini "+(total*32)+" peserta."});
   }
   if(action==="pembina_sangga_data"){
    const gender=pb.jenis_kelamin;
    const [{data:sangga,error:se},{data:peserta,error:pe},{data:ambalan,error:ae},{data:pangkalan,error:pae}]=await Promise.all([
     admin.from("pangkalan_sangga").select("id_sangga,nama_sangga,urutan").eq("id_pangkalan",pb.id_pangkalan).eq("jenis_kelamin",gender).eq("aktif",true).order("urutan"),
     admin.from("profil_peserta_didik").select("id_user,nama_lengkap,jenis_kelamin,sangga,id_sangga,id_ambalan,kelas_sekolah,jurusan,tahun_pelajaran,status_keanggotaan,users!inner(status_akun)").eq("id_pangkalan",pb.id_pangkalan).eq("jenis_kelamin",gender).eq("users.status_akun","aktif").or("status_keanggotaan.is.null,status_keanggotaan.eq.aktif").order("nama_lengkap"),
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
     admin.from("pangkalan").select("id_pangkalan,nama_pangkalan,no_gudep,nama_ambalan_putra,nama_ambalan_putri,nama_ketua_gudep,nama_ketua_mabigus,struktur_gudep,tanda_tangan_ketua_gudep_data,tanda_tangan_mabigus_data,kode_gabung_peserta").eq("id_pangkalan",pb.id_pangkalan).single(),
     admin.from("users").select("kode_unik").eq("id_user",authData.user.id).single()
    ]);
    if(pe)throw pe;if(ue)throw ue;
    return reply({ok:true,pangkalan:p,kode_unik:u.kode_unik});
   }
   const allowedStructureGroups=["mabigus","pengurus_gudep","dewan_kehormatan_gudep","dewan_ambalan_putra","dewan_ambalan_putri","dewan_kehormatan_penegak_putra","dewan_kehormatan_penegak_putri","unsur_pendukung"];
   const rawStructure=Array.isArray(body.struktur_gudep)?body.struktur_gudep:[];
   if(rawStructure.length>150)return reply({ok:false,message:"Jumlah personel struktur terlalu banyak."},400);
   const struktur=rawStructure.map((item:any,index:number)=>({
    kelompok:allowedStructureGroups.includes(clean(item?.kelompok,50))?clean(item.kelompok,50):"",
    jabatan:clean(item?.jabatan,100),
    nama:clean(item?.nama,150),
    jenis_kelamin:["L","P"].includes(clean(item?.jenis_kelamin,1))?clean(item.jenis_kelamin,1):null,
    unsur_asal:clean(item?.unsur_asal,100)||null,
    urutan:index+1
   })).filter((item:any)=>item.kelompok&&item.jabatan&&item.nama);
   if(rawStructure.some((item:any)=>!allowedStructureGroups.includes(clean(item?.kelompok,50))))return reply({ok:false,message:"Kelompok struktur Gudep tidak dikenal."},400);
   const patch={nama_pangkalan:clean(body.nama_pangkalan),no_gudep:clean(body.no_gudep,40)||null,nama_ambalan_putra:clean(body.nama_ambalan_putra,120),nama_ambalan_putri:clean(body.nama_ambalan_putri,120),nama_ketua_gudep:clean(body.nama_ketua_gudep,150)||null,nama_ketua_mabigus:clean(body.nama_ketua_mabigus,150)||null,struktur_gudep:struktur};
   if(!patch.nama_pangkalan||!patch.nama_ambalan_putra||!patch.nama_ambalan_putri)return reply({ok:false,message:"Nama pangkalan dan kedua nama ambalan wajib diisi."},400);
   const {error:saveError}=await admin.rpc("pembina_update_pangkalan_with_audit",{
    p_id_pangkalan:pb.id_pangkalan,
    p_actor_user_id:authData.user.id,
    p_patch:patch
   });
   if(saveError)throw saveError;
   return reply({ok:true,message:"Data Pangkalan berhasil disimpan dan riwayat perubahannya tercatat."});
  }
  const {data:config}=await admin.from("app_admin_config").select("admin_email").eq("singleton",true).single();
  const configuredEmail=clean(config?.admin_email,254).toLowerCase();
  if(!configuredEmail||authData.user.email.toLowerCase()!==configuredEmail)return reply({ok:false,message:"Akses khusus Admin Utama."},403);

  if(action==="sekretaris_management_data"){
   const [{data:secretary,error:secretaryError},{data:invites,error:inviteError}]=await Promise.all([
    admin.from("sekretaris_kwarcab").select("id_user,nama_lengkap,created_at,users!inner(email,status_akun)").eq("singleton",true).maybeSingle(),
    admin.from("sekretaris_kwarcab_invites").select("id_invite,created_at,used_at,revoked_at").order("created_at",{ascending:false}).limit(5)
   ]);
   if(secretaryError)throw secretaryError;if(inviteError)throw inviteError;
   return reply({ok:true,secretary,invites:invites||[]});
  }
  if(action==="sekretaris_create_invite"){
   const {data:existing,error:existingError}=await admin.from("sekretaris_kwarcab").select("id_user").eq("singleton",true).maybeSingle();
   if(existingError)throw existingError;
   if(existing)return reply({ok:false,message:"Akun Sekretaris Kwarcab sudah terdaftar. Tidak perlu membuat link baru."},409);
   const {error:revokeError}=await admin.from("sekretaris_kwarcab_invites").update({revoked_at:new Date().toISOString()}).is("used_at",null).is("revoked_at",null);if(revokeError)throw revokeError;
   const raw=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw)))).map(x=>x.toString(16).padStart(2,"0")).join("");
   const {data:invite,error}=await admin.from("sekretaris_kwarcab_invites").insert({token_hash:hash,created_by:authData.user.id}).select("id_invite,created_at").single();
   if(error)throw error;
   const link="https://yayanhadiyanto24-ops.github.io/pramuka-app/sekretaris-daftar.html?token="+raw;
   return reply({ok:true,invite,link,message:"Link pendaftaran sekali pakai berhasil dibuat. Kirim langsung hanya kepada Sekretaris Kwarcab yang dituju."});
  }
  if(action==="sekretaris_set_inactive"){
   const {data:secretary,error:secretaryError}=await admin.from("sekretaris_kwarcab").select("id_user").eq("singleton",true).maybeSingle();
   if(secretaryError)throw secretaryError;if(!secretary)return reply({ok:false,message:"Akun Sekretaris Kwarcab belum terdaftar."},404);
   const {error}=await admin.from("users").update({status_akun:"nonaktif"}).eq("id_user",secretary.id_user).eq("role","sekretaris_kwarcab");
   if(error)throw error;
   await admin.auth.admin.updateUserById(secretary.id_user,{ban_duration:"876000h"});
   return reply({ok:true,message:"Akses Sekretaris Kwarcab telah ditutup."});
  }
  if(action==="kwarran_management_data"){
   const [kwarran,pangkalan,admins,invites]=await Promise.all([
    fetchAllRows(()=>admin.from("kwarran").select("id_kwarran,nama_kwarran").order("nama_kwarran")),
    fetchAllRows(()=>admin.from("pangkalan").select("id_pangkalan,nama_pangkalan,no_gudep,id_kwarran").order("nama_pangkalan").order("id_pangkalan")),
    fetchAllRows(()=>admin.from("admin_kwarran").select("id_user,id_kwarran,nama_lengkap,kwarran!inner(nama_kwarran),users!admin_kwarran_id_user_fkey!inner(email,status_akun)").order("nama_lengkap").order("id_user")),
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
   const {error}=await admin.from("users").upsert({id_user:authData.user.id,email:configuredEmail,role:"admin_utama",status_akun:"aktif"},{onConflict:"id_user"});
   if(error)throw error;return reply({ok:true,message:"Akun Admin Utama aktif."});
  }
  if(action==="dashboard"){
   const [pangkalan,rekap,pembina,peserta,progress,sku,peringkatPangkalan,peringkatKwarran,pending]=await Promise.all([
    fetchAllRows(()=>admin.from("pangkalan").select("id_pangkalan,id_kwarran,nama_pangkalan,no_gudep,nama_ambalan_putra,nama_ambalan_putri,nama_ketua_gudep,nama_ketua_mabigus,kode_gabung_peserta,created_at,kwarran(nama_kwarran)").order("nama_pangkalan").order("id_pangkalan")),
    fetchAllRows(()=>admin.from("v_admin_ambalan_rekap").select("*").order("nama_pangkalan").order("jenis_kelamin").order("urutan_ambalan")),
    fetchAllRows(()=>admin.from("profil_pembina").select("id_pembina,id_user,id_pangkalan,nama_lengkap,jabatan,jenis_kelamin,nta,id_qr_kta,nta_bukti_kta,nta_status_verifikasi,jumlah_ambalan_berbayar,users!inner(email,status_akun)").order("nama_lengkap").order("id_pembina")),
    admin.from("profil_peserta_didik").select("id_peserta,id_user,id_pangkalan,nama_lengkap,jenis_kelamin,nta,id_qr_kta,tingkatan,sangga,kelas_sekolah,jurusan,tahun_pelajaran,status_keanggotaan,tanggal_alumni").order("nama_lengkap"),
    fetchAllRows(()=>admin.from("sku_learning_progress").select("id_progress,id_user,id_sku_item,status").order("id_progress",{ascending:false})),
    fetchAllRows(()=>admin.from("sku_items").select("id_sku_item,tingkat").eq("aktif",true).order("id_sku_item")),
    fetchAllRows(()=>admin.from("v_pangkalan_peringkat").select("*").order("id_kwarran").order("peringkat_kwarran",{ascending:true,nullsFirst:false}).order("nama_pangkalan")),
    fetchAllRows(()=>admin.from("v_kwarran_comparison").select("*").order("peringkat_kwarran",{ascending:true,nullsFirst:false}).order("nama_kwarran")),
    fetchAllRows(()=>admin.from("users").select("id_user,email,role,created_at").eq("status_akun","pending").order("created_at",{ascending:false}))
   ]);
   for(const x of [pangkalan,rekap,pembina,peserta,progress,sku,peringkatPangkalan,peringkatKwarran,pending])if(x.error)throw x.error;
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
   const {data:kwarran,error:kwarranError}=await fetchAllRows(()=>admin.from("kwarran").select("id_kwarran,nama_kwarran").order("nama_kwarran"));if(kwarranError)throw kwarranError;
   const pembinaDetail=await Promise.all((pembina.data||[]).map(async p=>{let ktaUrl=null;if(p.nta_bukti_kta?.path){const {data:signed}=await admin.storage.from("sku-bukti").createSignedUrl(p.nta_bukti_kta.path,300);ktaUrl=signed?.signedUrl||null;}return {...p,nta_bukti_kta_url:ktaUrl};}));
   return reply({ok:true,pangkalan:pangkalan.data,rekap:rekapDenganKwarran,peringkat_pangkalan:peringkatPangkalan.data||[],peringkat_kwarran:peringkatKwarran.data||[],kwarran:kwarran||[],pembina:pembinaDetail,peserta:pesertaDetail,pending:pending.data||[]});
  }
  if(action==="buat_kode_akses"){
   const targetId=clean(body.id_pembina,50);if(!targetId)return reply({ok:false,message:"Pilih akun Pembina."},400);
   const {data:target,error:te}=await admin.from("profil_pembina").select("id_user,nta,id_qr_kta,nta_bukti_kta").eq("id_user",targetId).maybeSingle();if(te)throw te;if(!target)return reply({ok:false,message:"Akun Pembina tidak ditemukan."},404);if(!clean(target.nta,80)||!target.nta_bukti_kta?.path)return reply({ok:false,message:"Pembina harus melengkapi NTA dan mengunggah foto KTA sebelum menerima kode akses tambahan."},403);
   const code="RT-"+crypto.randomUUID().replaceAll("-","").slice(0,10).toUpperCase();
   const {error}=await admin.from("pembina_access_codes").insert({id_pembina:targetId,kode_akses:code,tambahan_kuota:32,akses_tanpa_batas:false,dibuat_oleh:authData.user.id});if(error)throw error;
   return reply({ok:true,kode_akses:code,message:"Kode penambahan satu ambalan (32 peserta) berhasil dibuat."});
  }
  return reply({ok:false,message:"Aksi tidak dikenal."},400);
 }catch(error){console.error(error);return reply({ok:false,message:"Kesalahan server. Periksa log Edge Function."},500);}
});