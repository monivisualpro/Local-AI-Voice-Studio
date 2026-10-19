'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { createVoiceFiles } = require('../electron/voiceFiles.cjs');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-'));
  const dir = path.join(root, 'voice-library');
  const outside = path.join(root, 'secret.txt'); fs.writeFileSync(outside, 'keep me');
  const revealed = [];
  const vf = createVoiceFiles(() => dir, { showItemInFolder: (p) => revealed.push(p), openPath: async () => '' });
  let ok = true;
  const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };

  const r = await vf.saveFile({ id: 'ref-sample-hi-f-01', ext: 'mp3', bytes: new Uint8Array([1, 2, 3, 4]) });
  check('save writes a real file', r.ok && fs.readFileSync(r.path).length === 4, r.path);
  check('file name is id.ext inside the library', path.basename(r.path) === 'ref-sample-hi-f-01.mp3' && path.dirname(r.path) === dir);
  check('exists() sees it', vf.exists(r.path) === true);
  check('reveal opens its folder with the file selected', vf.reveal(r.path).ok && revealed[0] === r.path);

  const evil = await vf.saveFile({ id: '../../evil', ext: '../sh', bytes: new Uint8Array([9]) });
  check('path-traversal in id/ext stays inside the library', evil.ok && path.dirname(evil.path) === dir, path.basename(evil.path));
  check('empty audio is refused', (await vf.saveFile({ id: 'x', ext: 'wav', bytes: new Uint8Array([]) })).ok === false);

  check('cannot reveal a file outside the library', vf.reveal(outside).ok === false);
  check('cannot delete a file outside the library', (await vf.deleteFile(outside)).ok === false && fs.existsSync(outside));
  check('cannot delete via ../ trick', (await vf.deleteFile(path.join(dir, '..', 'secret.txt'))).ok === false && fs.existsSync(outside));

  const rd = await vf.readFile(r.path);
  check('readFile returns the saved bytes (restart-proof voice)', rd.ok && rd.bytes.length === 4 && rd.bytes[3] === 4);
  check('cannot read a file outside the library', (await vf.readFile(outside)).ok === false);
  check('delete removes the file', (await vf.deleteFile(r.path)).ok && !fs.existsSync(r.path));
  check('exists() is false afterwards', vf.exists(r.path) === false);
  check('readFile of a deleted file says so', (await vf.readFile(r.path)).ok === false);
  check('reveal of a deleted file says so', vf.reveal(r.path).ok === false);
  check('deleting an already-missing file is fine', (await vf.deleteFile(r.path)).ok === true);
  check('open-folder works', (await vf.openFolder()).ok === true);
  console.log(ok ? '\nALL VOICE FILE CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
})();
