'use strict';
// Real files for the voice library. Pure Node (no Electron import) so it can be tested.
const fs = require('fs');
const path = require('path');

function createVoiceFiles(getDir, shell) {
  const dir = () => { const d = getDir(); fs.mkdirSync(d, { recursive: true }); return d; };
  const safeName = (id, ext) => {
    const base = String(id || 'voice').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'voice';
    const e = String(ext || 'wav').replace(/[^a-zA-Z0-9]/g, '').slice(0, 5) || 'wav';
    return `${base}.${e}`;
  };
  // Only files inside our own folder may be revealed/deleted, whatever path the renderer sends.
  const inside = (p) => {
    if (!p) return false;
    const root = path.resolve(dir()) + path.sep;
    return path.resolve(String(p)).startsWith(root);
  };
  return {
    async saveFile(payload) {
      try {
        const bytes = payload && payload.bytes;
        if (!bytes || !bytes.length) return { ok: false, error: 'No audio data to save.' };
        const file = path.join(dir(), safeName(payload.id, payload.ext));
        await fs.promises.writeFile(file, Buffer.from(bytes));
        return { ok: true, path: file };
      } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
    },
    reveal(target) {
      if (inside(target) && fs.existsSync(target)) { shell.showItemInFolder(target); return { ok: true }; }
      return { ok: false, error: 'The file is not on disk any more.' };
    },
    exists: (target) => inside(target) && fs.existsSync(target),
    /** The saved copy of a voice: the durable source of truth when the browser-side cache (IndexedDB) is gone. */
    async readFile(target) {
      if (!inside(target)) return { ok: false, error: 'Not a voice-library file.' };
      try { return { ok: true, bytes: new Uint8Array(await fs.promises.readFile(target)) }; }
      catch (e) { return { ok: false, error: e && e.code === 'ENOENT' ? 'The file is not on disk any more.' : (e && e.message ? e.message : String(e)) }; }
    },
    async deleteFile(target) {
      if (!inside(target)) return { ok: false, error: 'Not a voice-library file.' };
      try { await fs.promises.rm(target, { force: true }); return { ok: true }; }
      catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
    },
    async openFolder() {
      const err = await shell.openPath(dir());
      return { ok: !err, path: dir(), error: err || undefined };
    },
    safeName,
  };
}
module.exports = { createVoiceFiles };
