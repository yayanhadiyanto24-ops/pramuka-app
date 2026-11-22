import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('Form login Belajar mempertahankan autofill Android', () => {
  const html = read('belajar.html');
  assert.match(html, /id="email" name="email" type="email"[^>]*autocomplete="username"/);
  assert.match(html, /id="password" name="password" type="password"[^>]*autocomplete="current-password"/);
  assert.match(html, /\$\('email'\)\.value=emailValue/);
  assert.match(html, /\$\('password'\)\.value=passwordValue/);
});

test('Memilih halaman Peserta Didik/Pembina tidak mereset formulir', () => {
  const html = read('index.html');
  const start = html.indexOf('function switchTab(role)');
  const end = html.indexOf("let loadedPangkalanKey", start);
  assert.ok(start >= 0 && end > start, 'switchTab harus ditemukan');
  const handler = html.slice(start, end);
  assert.doesNotMatch(handler, /\.reset\s*\(/);
  assert.doesNotMatch(handler, /\.value\s*=\s*['"]['"]/);
});

test('Semua dataset dashboard memakai paginasi bertahap', () => {
  const source = read('supabase/functions/pramuka-register/index.ts');
  assert.match(source, /async function fetchAllRows\(buildQuery:\(\)=>any,pageSize=500\)/);
  assert.match(source, /buildQuery\(\)\.range\(offset,offset\+pageSize-1\)/);
  const blocks = [
    source.slice(source.indexOf('if(action==="sekretaris_dashboard")'), source.indexOf('if(action==="kwarran_options")')),
    source.slice(source.indexOf('if(action==="admin_kwarran_dashboard")'), source.indexOf('if(action==="save_profile")')),
    source.slice(source.indexOf('if(action==="dashboard")'), source.indexOf('if(action==="buat_kode_akses")'))
  ];
  const required = ['pangkalan','v_admin_ambalan_rekap','profil_pembina','profil_peserta_didik','sku_learning_progress','sku_items','v_pangkalan_peringkat','v_kwarran_comparison'];
  for (const [i, block] of blocks.entries()) {
    assert.ok(block.length > 0, 'Blok dashboard ' + i + ' ditemukan');
    for (const table of required) {
      if (table === 'profil_pembina' && i === 1) continue;
      assert.match(block, new RegExp('fetchAllRows\\(\\(\\)=>admin\\.from\\("' + table + '"\\)'));
    }
  }
});

test('Pembaruan pangkalan dan riwayat audit memakai satu RPC atomik', () => {
  const source = read('supabase/functions/pramuka-register/index.ts');
  assert.match(source, /admin\.rpc\("pembina_update_pangkalan_with_audit"/);
  assert.doesNotMatch(source, /admin\.from\("pangkalan_change_audit"\)\.insert/);
});

test('Service Worker tidak mengirim URL berbeda ke belajar.html saat offline', () => {
  const sw = read('sw.js');
  assert.match(sw, /cache\.match\(request\)\|\|await cache\.match\(requestedUrl\.toString\(\)\)/);
  assert.doesNotMatch(sw, /cache\.match\(['"]\.\/belajar\.html['"]\)/);
});

test('Android WebView mengizinkan autofill dan tidak menonaktifkannya', () => {
  const java = read('android/app/src/main/java/id/ruangtegak/app/MainActivity.java');
  assert.match(java, /setImportantForAutofill\(View\.IMPORTANT_FOR_AUTOFILL_YES\)/);
  assert.doesNotMatch(java, /IMPORTANT_FOR_AUTOFILL_NO/);
});

test('Workflow Android mendukung keystore rilis melalui GitHub Secrets', () => {
  const workflow = read('.github/workflows/build-android.yml');
  for (const secret of ['ANDROID_KEYSTORE_BASE64','ANDROID_KEYSTORE_PASSWORD','ANDROID_KEY_ALIAS','ANDROID_KEY_PASSWORD']) {
    assert.ok(workflow.includes('secrets.' + secret), 'Secret ' + secret);
  }
  assert.match(workflow, /gradle :app:assembleRelease/);
  assert.match(workflow, /ANDROID_SIGNING_READY == 'true'/);
});

test('Inline JavaScript pada halaman inti lolos pemeriksaan sintaks Node', () => {
  const pages = ['index.html','belajar.html','admin-utama.html','admin-kwarran.html','sekretaris-kwarcab.html','login-confirm.html','sekretaris-daftar.html'];
  for (const page of pages) {
    const html = read(page);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const [index, match] of scripts.entries()) {
      if (/\bsrc\s*=/.test(match[1]) || /application\/(json|ld\+json)/i.test(match[1])) continue;
      const result = spawnSync(process.execPath, ['--check','-'], { input: match[2], encoding: 'utf8' });
      assert.equal(result.status, 0, page + ' script #' + (index + 1) + ': ' + result.stderr);
    }
  }
});
