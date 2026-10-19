'use strict';
// Runs the REAL built app and checks the catalog migration (wrong-gender clips -> corrected, user voices untouched).
const { app, BrowserWindow } = require('electron');
const os = require('os'), path = require('path'), fs = require('fs');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'mig-ud-')));
require('../electron/main.cjs');
let ok = true;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 80 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; await sleep(250); }
  const js = (c) => win.webContents.executeJavaScript(c, true);
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
  await sleep(2000);

  // Simulate an install made BEFORE the fix: a stale downloaded built-in + a voice the user added themselves.
  await js(`(() => {
    localStorage.removeItem('tts_studio_catalog_rev');
    localStorage.setItem('tts_studio_reference_folders', JSON.stringify([
      { id: 'folder-celebrities-iconic', name: 'Celebrities & Iconic Narrators', description: 'old', color: '#FFB547', createdAt: 1, isDefault: true },
      { id: 'folder-mine', name: 'My Folder', description: 'user made', color: '#fff', createdAt: 2, isDefault: false }
    ]));
    localStorage.setItem('tts_studio_reference_audios', JSON.stringify([
      { id: 'ref-sample-celebrity-1', name: 'Old Entry', isBuiltIn: true, isDownloaded: true, url: 'blob:stale', downloadUrl: 'https://example.invalid/OLD-WRONG-GENDER.mp3', speakerGender: 'female', referenceText: 'made-up transcript', folderId: 'f' },
      { id: 'user-voice-1', name: 'My Own Recording', isBuiltIn: false, isDownloaded: true, url: 'blob:mine', downloadUrl: '', speakerGender: 'male', folderId: 'f' }
    ])); 0
  })()`);
  win.webContents.reload();
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await sleep(2500);

  const out = await js(`(() => ({ rev: localStorage.getItem('tts_studio_catalog_rev'), list: JSON.parse(localStorage.getItem('tts_studio_reference_audios') || '[]'), folders: JSON.parse(localStorage.getItem('tts_studio_reference_folders') || '[]') }))()`);
  const stale = out.list.find((r) => r.id === 'ref-sample-celebrity-1');
  const mine = out.list.find((r) => r.id === 'user-voice-1');
  check('catalog revision recorded', out.rev === '3', String(out.rev));
  check('built-in entry renamed to a generic descriptive name', out.list.find((r) => r.id === 'ref-sample-celebrity-1').name === 'Legendary Bass Narrator', out.list.find((r) => r.id === 'ref-sample-celebrity-1').name);
  check('no generated entry still carries a real person name', !out.list.some((r) => /James Earl Jones|Meryl Streep|Tom Hanks|Oprah/.test(r.name)));
  check('built-in folder renamed, user folder untouched', out.folders.find((f) => f.id === 'folder-celebrities-iconic').name === 'Iconic-Style & Narrator Voices' && out.folders.find((f) => f.id === 'folder-mine').name === 'My Folder');
  check('stale built-in replaced with corrected clip', stale && /atkins_mha/.test(stale.downloadUrl), stale && stale.downloadUrl.split('/').pop());
  check('wrong cached audio discarded (must re-download)', stale && stale.isDownloaded === false);
  check('made-up transcript removed', stale && !stale.referenceText);
  check('user-added voice untouched', mine && mine.name === 'My Own Recording' && mine.isDownloaded === true);

  // second launch must not redo the migration
  win.webContents.reload();
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await sleep(1500);
  const again = await js(`JSON.parse(localStorage.getItem('tts_studio_reference_audios')).find((r) => r.id === 'ref-sample-celebrity-1').downloadUrl`);
  check('migration is one-time (stable on next launch)', /atkins_mha/.test(again));
  console.log(ok ? '\nMIGRATION TEST PASSED' : '\nMIGRATION TEST FAILED');
  process.exit(ok ? 0 : 1);
});
