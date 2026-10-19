'use strict';
// Moving the app's big folders (models, Python environments) to another drive/folder - safely.
// Pure Node (no Electron) so it can be tested. Rules:
//   * the source is NEVER deleted until every file was copied and verified (size match);
//   * the same drive = instant rename; another drive = copy + verify + remove;
//   * if the destination already holds items with the same names, nothing is touched and the conflicts are listed.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const lower = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const norm = (p) => lower(path.resolve(String(p)));
const isInside = (child, parent) => {
  const c = norm(child), p = norm(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
};

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

async function listFiles(root) {
  const out = [];
  async function walk(dir) {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(root);
  return out;
}

/** Size of a folder in bytes; stops counting after `budgetMs` and says so (huge folders). */
async function folderSize(root, budgetMs = 4000) {
  const stop = Date.now() + budgetMs;
  let bytes = 0, partial = false;
  async function walk(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (Date.now() > stop) { partial = true; return; }
      const full = path.join(dir, e.name);
      try {
        if (e.isDirectory()) await walk(full);
        else bytes += (await fsp.stat(full)).size;
      } catch { /* vanished file */ }
    }
  }
  if (await exists(root)) await walk(root);
  return { bytes, partial };
}

/** Where the items will really go: the picked folder itself when it is empty/new, else a named sub-folder inside it. */
async function resolveDestination(picked, subfolderName) {
  const p = path.resolve(picked);
  if (!(await exists(p))) return p;
  const items = await fsp.readdir(p);
  if (items.length === 0) return p;
  if (path.basename(p).toLowerCase() === String(subfolderName).toLowerCase()) return p; // already "...\models"
  return path.join(p, subfolderName);
}

async function copyTree(src, dest, onBytes, isCancelled) {
  let files = 0;
  async function walk(from, to) {
    await fsp.mkdir(to, { recursive: true });
    for (const e of await fsp.readdir(from, { withFileTypes: true })) {
      if (isCancelled && isCancelled()) throw Object.assign(new Error('Cancelled'), { cancelled: true });
      const a = path.join(from, e.name), b = path.join(to, e.name);
      if (e.isDirectory()) { await walk(a, b); continue; }
      const size = (await fsp.stat(a)).size;
      let have = -1;
      try { have = (await fsp.stat(b)).size; } catch { /* not there yet */ }
      if (have !== size) await fsp.copyFile(a, b); // resumes: finished files are skipped
      files++;
      onBytes && onBytes(size);
    }
  }
  await walk(src, dest);
  return files;
}

async function verifyTree(src, dest) {
  for (const f of await listFiles(src)) {
    const rel = path.relative(src, f);
    let a, b;
    try { a = (await fsp.stat(f)).size; b = (await fsp.stat(path.join(dest, rel))).size; }
    catch { return { ok: false, problem: `missing after copy: ${rel}` }; }
    if (a !== b) return { ok: false, problem: `size differs after copy: ${rel}` };
  }
  return { ok: true };
}

/**
 * Moves everything inside `src` to `dest`. Returns { moved, method, bytes, files, dest }.
 * Throws Error with a plain-language message (err.code = 'CONFLICT' | 'INVALID' | 'VERIFY').
 */
async function moveFolder(src, dest, { onProgress, isCancelled } = {}) {
  const s = path.resolve(src), d = path.resolve(dest);
  const fail = (code, msg) => Object.assign(new Error(msg), { code });
  if (norm(s) === norm(d)) throw fail('INVALID', 'The new folder is the same as the current one.');
  if (isInside(d, s)) throw fail('INVALID', 'The new folder cannot be inside the current folder.');
  if (isInside(s, d)) throw fail('INVALID', 'The new folder cannot contain the current folder. Pick a separate, empty folder.');

  if (!(await exists(s))) { await fsp.mkdir(d, { recursive: true }); return { moved: false, method: 'none', bytes: 0, files: 0, dest: d }; }

  await fsp.mkdir(path.dirname(d), { recursive: true });
  const destItems = (await exists(d)) ? await fsp.readdir(d) : [];
  const srcItems = await fsp.readdir(s);
  const conflicts = srcItems.filter((n) => destItems.some((m) => lower(m) === lower(n)));
  if (conflicts.length) {
    throw fail('CONFLICT', `The new folder already contains: ${conflicts.slice(0, 6).join(', ')}${conflicts.length > 6 ? ', ...' : ''}. Nothing was changed. Pick an empty folder.`);
  }

  const total = (await folderSize(s, 15000)).bytes;
  let done = 0;
  const bump = (n) => { done += n; onProgress && onProgress({ done, total }); };

  // 1) same drive: rename (instant)
  if (destItems.length === 0) {
    try {
      if (await exists(d)) await fsp.rmdir(d); // rename onto an existing (empty) folder is refused on Windows
      await fsp.rename(s, d);
      onProgress && onProgress({ done: total, total });
      return { moved: true, method: 'rename', bytes: total, files: 0, dest: d };
    } catch (e) {
      if (!['EXDEV', 'EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(e.code)) throw e;
      await fsp.mkdir(d, { recursive: true });
    }
  }

  // 2) other drive (or merge into a folder with other content): copy every item, verify, then delete the source
  await fsp.mkdir(d, { recursive: true });
  let files = 0;
  for (const name of srcItems) {
    const a = path.join(s, name), b = path.join(d, name);
    const st = await fsp.stat(a);
    if (st.isDirectory()) files += await copyTree(a, b, bump, isCancelled);
    else {
      await fsp.copyFile(a, b); bump(st.size); files++;
    }
  }
  for (const name of srcItems) {
    const a = path.join(s, name), b = path.join(d, name);
    const st = await fsp.stat(a);
    if (st.isDirectory()) {
      const v = await verifyTree(a, b);
      if (!v.ok) throw fail('VERIFY', `The copy could not be verified (${v.problem}). Your original files were NOT deleted.`);
    } else if ((await fsp.stat(b)).size !== st.size) {
      throw fail('VERIFY', `The copy of ${name} could not be verified. Your original files were NOT deleted.`);
    }
  }
  for (const name of srcItems) await fsp.rm(path.join(s, name), { recursive: true, force: true });
  try { await fsp.rmdir(s); } catch { /* not empty / in use: harmless */ }
  return { moved: true, method: 'copy', bytes: total, files, dest: d };
}

/**
 * Python virtual environments remember the absolute path of the Python they were made with
 * (pyvenv.cfg, and "#!" lines on Linux/macOS). After moving the environments folder, rewrite those paths.
 * Returns how many files were fixed.
 */
async function repairVenvPaths(envsRoot, oldBase, newBase) {
  const oldN = path.resolve(oldBase), newN = path.resolve(newBase);
  const variants = (p) => [p, p.replace(/\\/g, '/'), p.replace(/\//g, '\\')];
  const swap = (text) => {
    let out = text;
    for (const [i, o] of variants(oldN).entries()) {
      const n = variants(newN)[i];
      out = process.platform === 'win32' ? out.replace(new RegExp(o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), () => n) : out.split(o).join(n);
    }
    return out;
  };
  let fixed = 0;
  if (!(await exists(envsRoot))) return 0;
  for (const env of await fsp.readdir(envsRoot, { withFileTypes: true })) {
    if (!env.isDirectory()) continue;
    const envDir = path.join(envsRoot, env.name);
    const cfg = path.join(envDir, 'pyvenv.cfg');
    if (await exists(cfg)) {
      const text = await fsp.readFile(cfg, 'utf8');
      const next = swap(text);
      if (next !== text) { await fsp.writeFile(cfg, next, 'utf8'); fixed++; }
    }
    const bin = path.join(envDir, 'bin');
    if (await exists(bin)) {
      for (const f of await fsp.readdir(bin, { withFileTypes: true })) {
        if (!f.isFile()) continue;
        const full = path.join(bin, f.name);
        const st = await fsp.stat(full);
        if (st.size > 1024 * 1024) continue; // real binaries
        const buf = await fsp.readFile(full);
        if (buf[0] !== 0x23 || buf[1] !== 0x21) continue; // not a "#!" script
        const text = buf.toString('utf8');
        const next = swap(text);
        if (next !== text) { await fsp.writeFile(full, next, 'utf8'); fixed++; }
      }
    }
  }
  return fixed;
}

module.exports = { moveFolder, resolveDestination, repairVenvPaths, folderSize, isInside };
