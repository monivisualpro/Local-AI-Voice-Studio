'use strict';
// Starts a static server for dist/, then runs the headless Electron tests (Linux: needs xvfb-run).
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
const server = spawn('python3', ['-m', 'http.server', '3000', '--bind', '127.0.0.1', '-d', 'dist'], { cwd: root, stdio: 'ignore' });
setTimeout(() => {
  let code = 0;
  for (const t of ['electron-smoke.main.cjs', 'electron-migration.main.cjs']) {
    const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron');
    const args = ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', path.join(__dirname, t)];
    const r = process.platform === 'linux' ? spawnSync('xvfb-run', ['-a', electron, ...args], { stdio: 'inherit' }) : spawnSync(electron, args.slice(3), { stdio: 'inherit' });
    code = code || r.status;
  }
  server.kill();
  process.exit(code);
}, 1000);
