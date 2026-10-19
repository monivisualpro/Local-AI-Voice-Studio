'use strict';
// Builds the installers, each platform into its OWN folder:
//   release/windows/  Local-AI-Voice-Studio-Setup-<version>.exe        (asks install folder + data drive)
//   release/macos/    .dmg (drag to any folder/disk) and .pkg (asks the install disk)   x64 + Apple Silicon
//   release/linux/    .AppImage (run from any disk), .deb, .tar.gz  (+ install-linux.sh asks the folder)
// Usage: node tools/build-installers.cjs win|mac|linux|all
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const arg = (process.argv[2] || 'all').toLowerCase();
const PLAN = {
  win:   { flag: '--win',   out: 'release/windows', label: 'Windows' },
  mac:   { flag: '--mac',   out: 'release/macos',   label: 'macOS' },
  linux: { flag: '--linux', out: 'release/linux',   label: 'Linux' },
};
const wanted = arg === 'all' ? Object.keys(PLAN) : [arg];
if (wanted.some((w) => !PLAN[w])) { console.error('Use: win | mac | linux | all'); process.exit(2); }

const run = (cmd, args) => {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0;
};
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

if (!run(npx, ['vite', 'build'])) process.exit(1);

const results = [];
for (const key of wanted) {
  const p = PLAN[key];
  if (key === 'mac' && process.platform !== 'darwin') {
    console.log('\nSkipping macOS: a .dmg/.pkg can only be built on a Mac (or with the GitHub Actions workflow in .github/workflows/build.yml).');
    results.push([p.label, 'skipped (needs a Mac)']);
    continue;
  }
  fs.rmSync(path.join(root, p.out), { recursive: true, force: true });
  const ok = run(npx, ['electron-builder', p.flag, '--config', 'electron-builder.json', `-c.directories.output=${p.out}`, '--publish', 'never']);
  if (ok && key === 'linux') {
    fs.copyFileSync(path.join(root, 'installers/linux/install-linux.sh'), path.join(root, p.out, 'install-linux.sh'));
  }
  results.push([p.label, ok ? p.out : 'FAILED']);
}
console.log('\nResult:');
for (const [label, where] of results) console.log(`  ${label.padEnd(8)} ${where}`);
process.exit(results.some((r) => r[1] === 'FAILED') ? 1 : 0);
