'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { moveFolder, resolveDestination, repairVenvPaths } = require('../electron/dataLocations.cjs');
let ok = true;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function makeTree(root) {
  fs.mkdirSync(path.join(root, 'kokoro', 'voices'), { recursive: true });
  fs.mkdirSync(path.join(root, 'indic-parler-tts', 'description_tokenizer'), { recursive: true });
  fs.writeFileSync(path.join(root, 'kokoro', 'model.pth'), crypto.randomBytes(300000));
  fs.writeFileSync(path.join(root, 'kokoro', 'voices', 'af.pt'), crypto.randomBytes(5000));
  fs.writeFileSync(path.join(root, 'indic-parler-tts', 'model.safetensors'), crypto.randomBytes(700000));
  fs.writeFileSync(path.join(root, 'indic-parler-tts', 'description_tokenizer', 'spiece.model'), crypto.randomBytes(900));
}
const snapshot = (root) => {
  const out = {};
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : (out[path.relative(root, f)] = hash(f)); } })(root);
  return out;
};

(async () => {
  // 1. same drive -> rename
  let base = tmp(), src = path.join(base, 'models'), dst = path.join(base, 'moved');
  makeTree(src); const before = snapshot(src);
  let r = await moveFolder(src, dst);
  check('same drive: instant rename', r.method === 'rename' && !fs.existsSync(src));
  check('every file arrived byte-identical', JSON.stringify(snapshot(dst)) === JSON.stringify(before));

  // 2. other drive (EXDEV) -> copy + verify + remove source
  base = tmp(); src = path.join(base, 'models'); dst = path.join(base, 'otherdrive', 'models'); makeTree(src);
  const before2 = snapshot(src);
  const realRename = fs.promises.rename;
  fs.promises.rename = async () => { throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }); };
  const progress = [];
  r = await moveFolder(src, dst, { onProgress: (p) => progress.push(p) });
  fs.promises.rename = realRename;
  check('other drive: copy method used', r.method === 'copy' && r.files === 4, `${r.files} files`);
  check('copy: byte-identical', JSON.stringify(snapshot(dst)) === JSON.stringify(before2));
  check('copy: source removed only after verification', !fs.existsSync(path.join(src, 'kokoro')));
  check('progress reported up to 100%', progress.length > 0 && progress[progress.length - 1].done === progress[progress.length - 1].total);

  // 3. conflicts leave everything untouched
  base = tmp(); src = path.join(base, 'models'); dst = path.join(base, 'dst'); makeTree(src);
  fs.mkdirSync(path.join(dst, 'kokoro'), { recursive: true }); fs.writeFileSync(path.join(dst, 'kokoro', 'other.txt'), 'x');
  const before3 = snapshot(src);
  let err = null; try { await moveFolder(src, dst); } catch (e) { err = e; }
  check('name conflict is refused with a clear message', err && err.code === 'CONFLICT' && /kokoro/.test(err.message), err && err.message);
  check('conflict: source untouched', JSON.stringify(snapshot(src)) === JSON.stringify(before3));

  // 4. merge into a non-empty folder without conflicts
  base = tmp(); src = path.join(base, 'models'); dst = path.join(base, 'dst'); makeTree(src);
  fs.mkdirSync(dst); fs.writeFileSync(path.join(dst, 'notes.txt'), 'mine');
  r = await moveFolder(src, dst);
  check('merge into non-empty folder keeps the existing file and adds ours', fs.existsSync(path.join(dst, 'notes.txt')) && fs.existsSync(path.join(dst, 'kokoro', 'model.pth')));

  // 5. dangerous targets
  base = tmp(); src = path.join(base, 'models'); makeTree(src);
  for (const [label, target] of [['same folder', src], ['inside itself', path.join(src, 'sub')], ['parent folder', base]]) {
    err = null; try { await moveFolder(src, target); } catch (e) { err = e; }
    check(`refuses: ${label}`, err && err.code === 'INVALID', err && err.message);
  }
  check('nothing lost after refusals', fs.existsSync(path.join(src, 'kokoro', 'model.pth')));

  // 6. cancelled copy keeps the source
  base = tmp(); src = path.join(base, 'models'); dst = path.join(base, 'dst2'); makeTree(src);
  fs.promises.rename = async () => { throw Object.assign(new Error('x'), { code: 'EXDEV' }); };
  let n = 0; err = null;
  try { await moveFolder(src, dst, { isCancelled: () => ++n > 2 }); } catch (e) { err = e; }
  fs.promises.rename = realRename;
  check('cancel stops the copy', err && err.cancelled === true);
  check('cancel: original files all still there', fs.existsSync(path.join(src, 'kokoro', 'model.pth')) && fs.existsSync(path.join(src, 'indic-parler-tts', 'model.safetensors')));

  // 7. missing source is fine (fresh install)
  base = tmp(); r = await moveFolder(path.join(base, 'nothing'), path.join(base, 'new'));
  check('nothing to move -> creates the new empty folder', r.moved === false && fs.existsSync(path.join(base, 'new')));

  // 8. destination naming
  base = tmp(); fs.mkdirSync(path.join(base, 'empty')); fs.mkdirSync(path.join(base, 'full')); fs.writeFileSync(path.join(base, 'full', 'a.txt'), '1');
  check('empty picked folder is used as is', (await resolveDestination(path.join(base, 'empty'), 'models')) === path.join(base, 'empty'));
  check('non-empty picked folder gets a "models" sub-folder', (await resolveDestination(path.join(base, 'full'), 'models')) === path.join(base, 'full', 'models'));
  check('new (not yet existing) folder is used as is', (await resolveDestination(path.join(base, 'brand-new'), 'models')) === path.join(base, 'brand-new'));

  // 9. venv repair
  base = tmp(); const oldRoot = path.join(base, 'old', 'runtime'), newRoot = path.join(base, 'new', 'runtime');
  const env = path.join(newRoot, 'envs', 'env-a'); fs.mkdirSync(path.join(env, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(env, 'pyvenv.cfg'), `home = ${path.join(oldRoot, 'python', 'bin')}\ninclude-system-site-packages = false\nversion = 3.11.9\nexecutable = ${path.join(oldRoot, 'python', 'bin', 'python3.11')}\ncommand = ${path.join(oldRoot, 'python', 'bin', 'python3')} -m venv ${path.join(oldRoot, 'envs', 'env-a')}\n`);
  fs.writeFileSync(path.join(env, 'bin', 'pip'), `#!${path.join(oldRoot, 'envs', 'env-a', 'bin', 'python')}\nimport sys\n`);
  fs.writeFileSync(path.join(env, 'bin', 'python'), crypto.randomBytes(2000)); // binary: must not be touched
  const bin = fs.readFileSync(path.join(env, 'bin', 'python'));
  const fixed = await repairVenvPaths(path.join(newRoot, 'envs'), oldRoot, newRoot);
  const cfg = fs.readFileSync(path.join(env, 'pyvenv.cfg'), 'utf8');
  check('pyvenv.cfg rewritten to the new location', fixed === 2 && !cfg.includes(oldRoot) && cfg.includes(path.join(newRoot, 'python', 'bin')), `${fixed} files`);
  check('script shebang rewritten', fs.readFileSync(path.join(env, 'bin', 'pip'), 'utf8').startsWith('#!' + path.join(newRoot, 'envs')));
  check('binary files are left alone', Buffer.compare(bin, fs.readFileSync(path.join(env, 'bin', 'python'))) === 0);
  check('repair with nothing to fix reports 0', (await repairVenvPaths(path.join(newRoot, 'envs'), oldRoot, newRoot)) === 0);

  console.log(ok ? '\nALL DATA LOCATION CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
})();
