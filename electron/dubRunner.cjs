'use strict';
// Runs one dubbing worker stage (backend/dub/worker.py) and turns its JSON-lines output into events.
// Pure Node (no Electron) so it can be tested with a fake worker.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * @returns Promise<{ ok: true, result } | { ok: false, error, cancelled? }>
 * Never rejects. `onEvent` receives {event:'progress', stage, pct, message}.
 */
function runWorker({ python, script, args = [], env = {}, cwd, onEvent, signal }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(python, [script, ...args], { cwd, env: { ...process.env, ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, error: `Could not start Python: ${e.message}` });
    }
    let buffer = '';
    let result = null;
    let errorEvent = null;
    let stderr = '';
    let cancelled = false;
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };

    const onAbort = () => { cancelled = true; try { child.kill(); } catch { /* gone */ } };
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }

    const handleLine = (line) => {
      const text = line.trim();
      if (!text) return;
      let evt;
      try { evt = JSON.parse(text); } catch { return; } // libraries print other things: ignore
      if (evt.event === 'result') result = evt;
      else if (evt.event === 'error') errorEvent = evt;
      else if (evt.event === 'progress' && onEvent) onEvent(evt);
    };
    child.stdout.on('data', (d) => {
      buffer += d.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) { handleLine(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
    });
    child.stderr.on('data', (d) => { stderr = (stderr + d.toString('utf8')).slice(-4000); });
    child.on('error', (e) => finish({ ok: false, error: `Could not start Python: ${e.message}` }));
    child.on('close', (code) => {
      if (buffer.trim()) handleLine(buffer);
      if (cancelled) return finish({ ok: false, cancelled: true, error: 'Cancelled.' });
      if (errorEvent) return finish({ ok: false, error: errorEvent.message || 'The dubbing step failed.', detail: errorEvent.detail });
      if (code === 0 && result) { const { event, ...rest } = result; return finish({ ok: true, result: rest }); }
      const hint = /No module named ['"]?([\w.]+)/.exec(stderr);
      const msg = hint
        ? `A Python package is missing in the Dubbing environment (${hint[1]}). Open Settings -> Environments and press Repair for Dubbing.`
        : `The dubbing step stopped unexpectedly (exit code ${code}). ${stderr.trim().split('\n').slice(-3).join(' ')}`.trim();
      return finish({ ok: false, error: msg, detail: stderr });
    });
  });
}

/** Files the renderer may read/write are limited to the job folders. */
function insideDir(root, p) {
  if (!p) return false;
  const r = path.resolve(root) + path.sep;
  return path.resolve(String(p)).startsWith(r);
}

function safeJobId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || `job${Date.now()}`;
}

module.exports = { runWorker, insideDir, safeJobId, fs };
