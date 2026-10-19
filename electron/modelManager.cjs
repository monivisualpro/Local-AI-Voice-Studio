'use strict';
/**
 * electron/modelManager.cjs
 * ---------------------------------------------------------------------------
 * REAL on-disk model manager for Local AI Voice Studio.
 *
 * This module intentionally does NOT require('electron') so that its logic can
 * be executed and verified with plain Node (see the --selftest entry point).
 *
 * Responsibilities:
 *   1. Resolve + persist the model storage directory (userData/models).
 *   2. Query the Hugging Face Hub for the real file list of a repository.
 *   3. Stream files to disk with byte-accurate progress, resume support
 *      (.part files) and post-download size verification.
 *   4. Report what is actually present on disk (no simulated state).
 *   5. Inspect a local model folder: config, weights, tokenizer and a REAL
 *      parameter count read from the safetensors headers.
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { once } = require('events');
const engine = require('./downloadEngine.cjs');

// HF_ENDPOINT (standard variable) lets users point at a mirror, e.g. when huggingface.co is slow/blocked.
const HF_BASE = (process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/+$/, '');
const CONFIG_NAME = 'models.config.json';
const MANIFEST_NAME = '.installed.json';

const WEIGHT_EXTENSIONS = ['.safetensors', '.bin', '.gguf', '.onnx', '.pt', '.pth', '.npz'];
const TOKENIZER_NAMES = [
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'merges.txt',
  'spiece.model',
  'tokenizer.model',
  'vocab.txt',
  'special_tokens_map.json',
];
// Files that are never needed to run inference.
const SKIP_PATTERNS = [/^\.gitattributes$/i, /^\.gitignore$/i, /^\.git\//i, /\.md$/i];

function shouldDownloadFile(relPath) {
  return !SKIP_PATTERNS.some((re) => re.test(relPath));
}

function isWeightFile(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  return WEIGHT_EXTENSIONS.includes(ext);
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ===========================================================================
 * Configuration (persisted next to the app user data directory)
 * ======================================================================== */

function defaultConfig(userDataDir) {
  return {
    storagePath: path.join(userDataDir, 'models'),
    runtimePath: path.join(userDataDir, 'runtime'),
    hfToken: '',
    revision: 'main',
  };
}

function readConfig(userDataDir) {
  const file = path.join(userDataDir, CONFIG_NAME);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...defaultConfig(userDataDir), ...parsed };
  } catch {
    return defaultConfig(userDataDir);
  }
}

function writeConfig(userDataDir, patch) {
  const next = { ...readConfig(userDataDir), ...patch };
  const file = path.join(userDataDir, CONFIG_NAME);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  fs.mkdirSync(next.storagePath, { recursive: true });
  return next;
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/* ===========================================================================
 * Hugging Face Hub helpers (real HTTP)
 * ======================================================================== */

async function fetchJson(url, token, attempt = 1) {
  const headers = { 'User-Agent': 'local-ai-voice-studio' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await engine.fetch(url, { headers, redirect: 'follow' });
    if (!res.ok) {
      const err = new Error(`Hugging Face request failed (HTTP ${res.status}) for ${url}`);
      err.status = res.status;
      throw err;
    }
    return { json: await res.json(), link: res.headers.get('link') || '' };
  } catch (err) {
    const retryable = !err.status || err.status >= 500 || err.status === 429;
    if (retryable && attempt < 4) {
      await new Promise((r) => setTimeout(r, 600 * attempt));
      return fetchJson(url, token, attempt + 1);
    }
    if (!err.status) throw new Error(`Cannot reach Hugging Face: ${engine.explainNetworkError(err)}`);
    throw err;
  }
}

function encodeRepoPath(relPath) {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

function hfResolveUrl(repo, relPath, revision = 'main') {
  return `${HF_BASE}/${repo}/resolve/${revision}/${encodeRepoPath(relPath)}?download=true`;
}

/** Returns the real file list of a HF repo: [{ path, size }] */
async function fetchRepoTree(repo, token, revision = 'main') {
  // The listing is paginated for large repositories: follow the "next" link until it ends.
  const all = [];
  let url = `${HF_BASE}/api/models/${repo}/tree/${revision}?recursive=true`;
  for (let page = 0; page < 100 && url; page++) {
    const { json, link } = await fetchJson(url, token);
    if (!Array.isArray(json)) break;
    all.push(...json);
    const next = /<([^>]+)>;\s*rel="next"/i.exec(link);
    url = next ? new URL(next[1], HF_BASE).toString() : '';
  }
  return all
    .filter((e) => e && e.type === 'file' && typeof e.path === 'string')
    .map((e) => ({
      path: e.path,
      size: Number(e.size) || 0,
      // Hugging Face stores the SHA-256 of large (LFS) files -> we can verify them
      sha256: e.lfs && typeof e.lfs.oid === 'string' ? e.lfs.oid : undefined,
    }));
}

/** true when relPath matches one of the include patterns ("Folder/*", "*.json", exact path). */
function matchesInclude(relPath, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return true;
  return patterns.some((p) => {
    const re = new RegExp(
      '^' + String(p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
    );
    return re.test(relPath);
  });
}

/**
 * Files each model needs to actually run. A model is only "installed" when all of these exist,
 * so a half-finished download (big weights done, small folders missing) is never reported as ready.
 * Patterns: "*" = anything inside one folder, "**" = anything including sub-folders.
 */
const REQUIRED_FILES = {
  'qwen3-tts-0.6b-base': ['config.json', '*.safetensors', 'speech_tokenizer/config.json', 'speech_tokenizer/*.safetensors'],
  'qwen3-tts-1.7b-voicedesign': ['config.json', '*.safetensors', 'speech_tokenizer/config.json', 'speech_tokenizer/*.safetensors'],
  'kokoro-82m': ['config.json', '*.pth', 'voices/*.pt'],
  'f5-tts-base': ['F5TTS_v1_Base/model_*'],
  'chatterbox-tts-fast': ['ve.safetensors', 't3_cfg.safetensors', 's3gen.safetensors', 'tokenizer.json'],
  'parler-tts-mini': ['config.json', '*.safetensors'],
  // Indic Parler-TTS needs BOTH tokenizers: the Indic prompt tokenizer (in the repo) and the Flan-T5
  // description tokenizer (downloaded from google/flan-t5-large into description_tokenizer/).
  'indic-parler-tts': ['config.json', '*.safetensors', 'tokenizer.json', 'tokenizer_config.json', 'description_tokenizer/tokenizer_config.json', 'description_tokenizer/spiece.model'],
  'xtts-v2': ['model.pth', 'config.json', 'vocab.json'],
  // Dubbing helpers
  'whisper-large-v3-turbo-ct2': ['config.json', 'model.bin', 'tokenizer.json'],
  'whisper-small-ct2': ['config.json', 'model.bin', 'tokenizer.json'],
  'nllb-200-distilled-600m': ['config.json', 'model.safetensors|pytorch_model.bin', 'sentencepiece.bpe.model'],
  // Svara: weights + tokenizer + the SNAC audio codec downloaded from hubertsiuzdak/snac_24khz into snac_24khz/.
  'svara-tts-v1': ['config.json', '*.safetensors', 'tokenizer.json', 'snac_24khz/config.json', 'snac_24khz/pytorch_model.bin'],
  // Sooktam-2 is a self-contained repo: weights + its own patched f5_tts source (src/).
  'sooktam-2': ['config.json', 'hf_auto.py', 'vocab.txt', 'model_*.pt', 'src/f5_tts/hf_auto.py'],
  // Urdu Tortoise: the fine-tuned autoregressive model + the stock Tortoise parts in base/.
  'urdu-tts-tortoise': ['models/urdu-multispeaker/ar-model.pth', 'base/diffusion_decoder.pth', 'base/clvp2.pth', 'base/vocoder.pth'],
};

function matchesRequired(relPath, pattern) {
  // "a|b" = either file is fine (e.g. "model.safetensors|pytorch_model.bin": repositories differ in the weight format)
  return String(pattern).split('|').some((alt) => {
    const re = new RegExp(
      '^' +
        alt
          .replace(/[.+^${}()[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '\u0000')
          .replace(/\*/g, '[^/]*')
          .replace(/\u0000/g, '.*') +
        '$'
    );
    return re.test(relPath);
  });
}

/**
 * Decides whether a model folder is complete.
 * missing = unfinished downloads (.part), files the manifest recorded that are gone or the wrong
 * size, and required patterns nothing on disk matches.
 */
function checkCompleteness({ scan, manifest, required }) {
  const missing = [];
  const done = scan.files.filter((f) => !/\.part(\.state)?$/.test(f.relPath));
  const have = new Map(done.map((f) => [f.relPath, f.size]));

  for (const f of scan.files) {
    if (/\.part$/.test(f.relPath)) missing.push(`${f.relPath.replace(/\.part$/, '')} (download not finished)`);
  }
  const recorded = Array.isArray(manifest && manifest.files) ? manifest.files : [];
  for (const record of recorded) {
    const rel = record && record.path ? String(record.path) : '';
    if (!rel) continue;
    if (!have.has(rel)) missing.push(rel);
    else if (record.size && have.get(rel) !== record.size) missing.push(`${rel} (wrong size)`);
  }
  for (const pattern of required || []) {
    if (!done.some((f) => matchesRequired(f.relPath, pattern))) missing.push(pattern);
  }
  return [...new Set(missing)];
}

/* ===========================================================================
 * Single file download - streamed, resumable (.part), size verified
 * ======================================================================== */

async function downloadFile({ url, dest, expectedSize, sha256, token, signal, onBytes, connections }) {
  const result = await engine.downloadFile(
    {
      url,
      dest,
      size: expectedSize || 0,
      sha256,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
    {
      signal,
      opts: connections ? { connectionsPerFile: connections } : undefined,
      onBytes: (bytes, meta) => {
        if (!onBytes) return;
        if (meta && meta.skipped) onBytes(meta.bytes || 0, true);
        else onBytes(bytes, false);
      },
    }
  );
  return { skipped: result.skipped, bytes: result.bytes };
}

/* ===========================================================================
 * Folder scanning / real installed-state reporting
 * ======================================================================== */

async function scanFolder(dir, options = {}) {
  const maxFiles = options.maxFiles || 20000;
  const files = [];
  let totalBytes = 0;

  const walk = async (current) => {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        let size = 0;
        try {
          size = (await fsp.stat(full)).size;
        } catch {
          size = 0;
        }
        totalBytes += size;
        files.push({ relPath: path.relative(dir, full).replace(/\\/g, '/'), size });
      }
    }
  };

  await walk(dir);
  return { bytes: totalBytes, fileCount: files.length, files };
}

async function pathExists(target) {
  try {
    await fsp.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Reads the manifest written by downloadModel() (if present). */
async function readManifest(modelDir) {
  try {
    const raw = await fsp.readFile(path.join(modelDir, MANIFEST_NAME), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Real, disk-derived inventory of what is installed (no simulated state). */
async function listInstalled(modelsRoot, requiredMap = REQUIRED_FILES) {
  const result = {};
  let entries = [];
  try {
    entries = await fsp.readdir(modelsRoot, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(modelsRoot, entry.name);
    const scan = await scanFolder(dir);
    const weightFiles = scan.files.filter((f) => isWeightFile(f.relPath));
    const tokenizerFiles = scan.files.filter((f) =>
      TOKENIZER_NAMES.includes(path.basename(f.relPath).toLowerCase())
    );
    const manifest = await readManifest(dir);
    const recorded = Array.isArray(manifest && manifest.files) ? manifest.files : [];
    const incompleteParts = checkCompleteness({ scan, manifest, required: (requiredMap || {})[entry.name] });

    result[entry.name] = {
      complete: weightFiles.length > 0 && incompleteParts.length === 0,
      missing: incompleteParts,
      modelId: entry.name,
      path: dir,
      bytes: scan.bytes,
      fileCount: scan.fileCount,
      hasConfig: await pathExists(path.join(dir, 'config.json')),
      hasWeights: weightFiles.length > 0,
      weightFileCount: weightFiles.length,
      hasTokenizer: tokenizerFiles.length > 0,
      installedAt: manifest && manifest.completedAt ? manifest.completedAt : null,
      manifestComplete: Boolean(manifest) && recorded.length > 0,
    };
  }
  return result;
}

/** Verifies a downloaded model: weights present and every manifest file intact. */
async function verifyModel(modelsRoot, modelId, requiredMap = REQUIRED_FILES) {
  const dir = path.join(modelsRoot, modelId);
  const scan = await scanFolder(dir);
  const weightFiles = scan.files.filter((f) => isWeightFile(f.relPath));
  const manifest = await readManifest(dir);
  const recorded = Array.isArray(manifest && manifest.files) ? manifest.files : [];

  const missing = [];
  const sizeMismatch = [];
  for (const record of recorded) {
    const rel = record && record.path ? String(record.path) : '';
    if (!rel) continue;
    const full = path.join(dir, rel.replace(/\//g, path.sep));
    try {
      const stat = await fsp.stat(full);
      if (record.size && stat.size !== record.size) {
        sizeMismatch.push({ path: rel, expected: record.size, actual: stat.size });
      }
    } catch {
      missing.push(rel);
    }
  }

  const incomplete = checkCompleteness({ scan, manifest, required: (requiredMap || {})[modelId] });
  for (const item of incomplete) if (!missing.includes(item)) missing.push(item);

  return {
    modelId,
    path: dir,
    ok: weightFiles.length > 0 && missing.length === 0 && sizeMismatch.length === 0,
    bytes: scan.bytes,
    fileCount: scan.fileCount,
    hasConfig: await pathExists(path.join(dir, 'config.json')),
    hasWeights: weightFiles.length > 0,
    weightFileCount: weightFiles.length,
    manifestPresent: Boolean(manifest),
    recordedFileCount: recorded.length,
    missing,
    sizeMismatch,
  };
}

/** Permanently removes a model folder from disk. */
async function deleteModel(modelsRoot, modelId) {
  const dir = path.join(modelsRoot, modelId);
  if (!modelsRoot || !modelId || path.resolve(dir) === path.resolve(modelsRoot)) {
    throw new Error('Refusing to delete an invalid model path');
  }
  await fsp.rm(dir, { recursive: true, force: true });
  return { modelId, path: dir, deleted: true };
}

/* ===========================================================================
 * Full model download (Hugging Face Hub -> disk)
 * ======================================================================== */

async function downloadModel(options) {
  const {
    modelsRoot,
    modelId,
    repo,
    revision = 'main',
    token,
    files,
    include,
    signal,
    onProgress,
    maxBytesPerSec = 0,
  } = options;

  if (!modelsRoot) throw new Error('Model storage directory is not configured');
  if (!modelId) throw new Error('modelId is required');
  if (!repo) throw new Error('Model repository is not configured');

  const modelDir = path.join(modelsRoot, modelId);
  await ensureDir(modelDir);

  const tree = files && files.length ? files : await fetchRepoTree(repo, token, revision);
  const wanted = tree
    .filter((f) => f && f.path && shouldDownloadFile(f.path) && matchesInclude(f.path, include))
    .map((f) => ({ ...f, repo, revision }));
  if (!wanted.length) {
    throw new Error(`No downloadable files found in repository "${repo}"`);
  }

  // Extra repositories whose files belong in a sub-folder of this model (e.g. the Flan-T5 tokenizer
  // that Indic Parler-TTS needs for voice descriptions). Each file keeps its own source repo.
  for (const extra of Array.isArray(options.extraRepos) ? options.extraRepos : []) {
    if (!extra || !extra.repo || !extra.subdir) continue;
    const extraTree = await fetchRepoTree(extra.repo, token, extra.revision || 'main');
    const picked = extraTree.filter((f) => f && f.path && matchesInclude(f.path, extra.include));
    if (!picked.length) throw new Error(`No files matching ${JSON.stringify(extra.include)} found in "${extra.repo}"`);
    for (const f of picked) {
      wanted.push({ ...f, repo: extra.repo, revision: extra.revision || 'main', remotePath: f.path, path: `${extra.subdir}/${f.path}` });
    }
  }

  // A repository that offers the weights both as .safetensors and as old pickled pytorch_model*.bin: take the safe,
  // faster-loading .safetensors only (never download the same model twice).
  if (wanted.some((f) => /^model(-\d+-of-\d+)?\.safetensors$/.test(f.path))) {
    for (let i = wanted.length - 1; i >= 0; i--) {
      if (/^pytorch_model(-\d+-of-\d+)?\.bin(\.index\.json)?$/.test(wanted[i].path)) wanted.splice(i, 1);
    }
  }

  // Check the repository layout BEFORE downloading gigabytes: every file this model needs must be offered.
  const needed = REQUIRED_FILES[modelId] || [];
  const notOffered = needed.filter((pattern) => !wanted.some((f) => matchesRequired(f.path, pattern)));
  if (notOffered.length) {
    throw new Error(
      `The repository "${repo}" does not contain: ${notOffered.join(', ')}. Nothing was downloaded. ` +
      'The model page may have changed - check the repository files, or tell the developer which file is missing.'
    );
  }

  const totalBytes = wanted.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
  let last = null;

  const emit = (status, extra) => {
    if (!onProgress) return;
    const p = last || {};
    const current = (p.files || []).find((f) => f.status === 'downloading' || f.status === 'verifying');
    const finished = (p.files || []).filter((f) => f.status === 'done').length;
    onProgress({
      modelId,
      status,
      currentFile: current ? current.name : '',
      fileIndex: Math.min(wanted.length, finished + (current ? 1 : 0)),
      fileCount: wanted.length,
      totalBytes: p.totalBytes || totalBytes,
      downloadedBytes: p.doneBytes || 0,
      percent: p.percent ? Math.min(100, Math.round(p.percent)) : 0,
      speedMBps: Number(((p.speed || 0) / (1024 * 1024)).toFixed(2)),
      speedBps: Math.round(p.speed || 0),
      etaSeconds: p.etaSeconds == null ? null : Math.round(p.etaSeconds),
      resumedBytes: p.resumedBytes || 0,
      verifying: Boolean(current && current.status === 'verifying'),
      ...(extra || {}),
    });
  };

  try {
    const jobs = wanted.map((f) => ({
      url: hfResolveUrl(f.repo || repo, f.remotePath || f.path, f.revision || revision),
      dest: path.join(modelDir, f.path.replace(/\//g, path.sep)),
      size: Number(f.size) || 0,
      sha256: f.sha256,
      name: f.path,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }));

    await engine.downloadAll(jobs, {
      signal,
      maxBytesPerSec,
      onProgress: (p) => {
        last = p;
        emit('downloading');
      },
    });

    const scan = await scanFolder(modelDir);
    const stillMissing = checkCompleteness({ scan, manifest: { files: wanted }, required: REQUIRED_FILES[modelId] });
    if (stillMissing.length) {
      throw new Error(`The download finished but these parts are missing: ${stillMissing.slice(0, 5).join(', ')}. Press Download again to retry.`);
    }
    const manifest = {
      modelId,
      repo,
      revision,
      completedAt: new Date().toISOString(),
      bytes: scan.bytes,
      fileCount: wanted.length,
      files: wanted.map((f) => ({ path: f.path, size: Number(f.size) || 0 })),
      extraRepos: (Array.isArray(options.extraRepos) ? options.extraRepos : []).map((e) => e.repo),
    };
    await fsp.writeFile(
      path.join(modelDir, MANIFEST_NAME),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    emit('complete', {
      bytes: scan.bytes,
      downloadedBytes: totalBytes || scan.bytes,
      totalBytes: totalBytes || scan.bytes,
      percent: 100,
      currentFile: '',
      etaSeconds: 0,
    });
    return manifest;
  } catch (err) {
    const paused = err && err.aborted;
    let message = err && err.message ? err.message : String(err);
    if (!paused && /\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(message)) {
      message = token
        ? `Hugging Face refused access to "${repo}" (${message}). This model is gated: open https://huggingface.co/${repo}, log in, accept the conditions, and make sure the token in Settings can read it.`
        : `"${repo}" is a gated model on Hugging Face. 1) Open https://huggingface.co/${repo} and accept the conditions. 2) Create a read token at huggingface.co/settings/tokens. 3) Paste it in Settings -> Hugging Face access token (the first card on that page), then press Download again.`;
      if (err) err.message = message;
    }
    emit(paused ? 'paused' : 'error', { error: message });
    throw err;
  }
}

/* ===========================================================================
 * Local folder inspection - real file analysis (no guessing)
 * ======================================================================== */

const ADAPTER_HINTS = [
  { adapter: 'qwen3', re: /qwen3/i },
  { adapter: 'kokoro', re: /kokoro/i },
  { adapter: 'chatterbox', re: /chatterbox/i },
  { adapter: 'f5tts', re: /f5[_-]?tts/i },
  { adapter: 'parler', re: /parler/i }, // also matches indic-parler-tts
  { adapter: 'xtts', re: /xtts|coqui/i },
  { adapter: 'dub', re: /whisper|nllb/i },
  { adapter: 'sooktam', re: /sooktam/i },
  { adapter: 'svara', re: /svara/i },
  { adapter: 'urdu-tortoise', re: /urdu[-_]?tts|tortoise/i },
];

const RUNTIME_BY_EXT = {
  '.safetensors': 'safetensors',
  '.bin': 'PyTorch (pickle)',
  '.pt': 'PyTorch checkpoint',
  '.pth': 'PyTorch checkpoint',
  '.onnx': 'ONNX Runtime',
  '.gguf': 'GGUF (llama.cpp)',
  '.npz': 'NumPy archive',
};

/** Reads a safetensors header and returns the true element count of all tensors. */
async function readSafetensorsParamCount(file) {
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const lenBuf = Buffer.alloc(8);
    await handle.read(lenBuf, 0, 8, 0);
    const headerLength = Number(lenBuf.readBigUInt64LE(0));
    if (!headerLength || headerLength > 200 * 1024 * 1024) return null;
    const jsonBuf = Buffer.alloc(headerLength);
    await handle.read(jsonBuf, 0, headerLength, 8);
    const header = JSON.parse(jsonBuf.toString('utf8'));
    let params = 0;
    for (const key of Object.keys(header)) {
      if (key === '__metadata') continue;
      const meta = header[key];
      if (!meta || !Array.isArray(meta.shape)) continue;
      params += meta.shape.reduce((acc, dim) => acc * (Number(dim) || 0), 1);
    }
    return params || null;
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

function parameterLabel(params) {
  if (!params) return null;
  if (params >= 1e9) return `${(params / 1e9).toFixed(2)}B`;
  if (params >= 1e6) return `${Math.round(params / 1e6)}M`;
  if (params >= 1e3) return `${Math.round(params / 1e3)}K`;
  return String(params);
}

function detectAdapter(haystack) {
  for (const hint of ADAPTER_HINTS) {
    if (hint.re.test(haystack)) return hint.adapter;
  }
  return 'generic';
}

async function inspectFolder(dir) {
  const warnings = [];
  let stat;
  try {
    stat = await fsp.stat(dir);
  } catch {
    throw new Error(`Folder not found: ${dir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${dir}`);
  }

  const scan = await scanFolder(dir);
  const weightFiles = scan.files.filter((f) => isWeightFile(f.relPath));
  const tokenizerFiles = scan.files.filter((f) =>
    TOKENIZER_NAMES.includes(path.basename(f.relPath).toLowerCase())
  );
  const hasConfig = await pathExists(path.join(dir, 'config.json'));

  let configSummary = null;
  if (hasConfig) {
    try {
      const cfg = JSON.parse(await fsp.readFile(path.join(dir, 'config.json'), 'utf8'));
      configSummary = {
        modelType: cfg.model_type || cfg.architectures?.[0] || null,
        architectures: Array.isArray(cfg.architectures) ? cfg.architectures : [],
        hiddenSize: cfg.hidden_size ?? cfg.d_model ?? null,
        layers: cfg.num_hidden_layers ?? cfg.n_layer ?? null,
        sampleRate: cfg.sampling_rate ?? cfg.sample_rate ?? null,
        vocabSize: cfg.vocab_size ?? null,
      };
    } catch (err) {
      warnings.push(`config.json could not be parsed (${err.message})`);
    }
  } else {
    warnings.push('No config.json found - the runtime needs an architecture config.');
  }

  if (!weightFiles.length) {
    warnings.push('No weight files detected (.safetensors / .bin / .onnx / .gguf / .pt).');
  }
  if (!tokenizerFiles.length) {
    warnings.push('No tokenizer files detected (tokenizer.json, vocab.json, ...).');
  }

  // Real parameter count straight from the safetensors headers.
  const safetensorsFiles = weightFiles.filter((f) => f.relPath.toLowerCase().endsWith('.safetensors'));
  let parameterCount = null;
  if (safetensorsFiles.length) {
    let total = 0;
    let counted = 0;
    for (const f of safetensorsFiles) {
      const n = await readSafetensorsParamCount(path.join(dir, f.relPath.replace(/\//g, path.sep)));
      if (n) {
        total += n;
        counted += 1;
      }
    }
    if (counted) parameterCount = total;
    if (counted && counted < safetensorsFiles.length) {
      warnings.push(`Only ${counted} of ${safetensorsFiles.length} safetensors shards could be read.`);
    }
  }

  const extensions = [...new Set(weightFiles.map((f) => path.extname(f.relPath).toLowerCase()))];
  const runtimes = extensions.map((ext) => RUNTIME_BY_EXT[ext] || ext).filter(Boolean);
  const haystack = [
    path.basename(dir),
    ...weightFiles.map((f) => f.relPath),
    configSummary?.modelType || '',
    ...(configSummary?.architectures || []),
  ].join(' ');
  const adapter = detectAdapter(haystack);
  if (adapter === 'generic') {
    warnings.push('Architecture could not be matched to a known adapter - import as "generic".');
  }

  return {
    valid: weightFiles.length > 0,
    path: dir,
    adapter,
    runtime: runtimes.length ? runtimes.join(' + ') : 'unknown',
    fileCount: scan.fileCount,
    totalBytes: scan.bytes,
    totalSizeLabel: formatBytes(scan.bytes),
    hasConfig,
    hasWeights: weightFiles.length > 0,
    hasTokenizer: tokenizerFiles.length > 0,
    configSummary,
    weightFileCount: weightFiles.length,
    weights: weightFiles.slice(0, 25).map((f) => ({ relPath: f.relPath, size: f.size })),
    tokenizerFiles: tokenizerFiles.map((f) => f.relPath).slice(0, 12),
    parameterCount,
    parameterSizeLabel: parameterLabel(parameterCount),
    warnings,
  };
}

/* ===========================================================================
 * Exports
 * ======================================================================== */

module.exports = {
  CONFIG_NAME,
  MANIFEST_NAME,
  WEIGHT_EXTENSIONS,
  TOKENIZER_NAMES,
  formatBytes,
  shouldDownloadFile,
  matchesInclude,
  checkCompleteness,
  REQUIRED_FILES,
  isWeightFile,
  defaultConfig,
  readConfig,
  writeConfig,
  ensureDir,
  pathExists,
  fetchJson,
  fetchRepoTree,
  hfResolveUrl,
  downloadFile,
  downloadModel,
  scanFolder,
  listInstalled,
  verifyModel,
  deleteModel,
  inspectFolder,
  readSafetensorsParamCount,
  parameterLabel,
};

/** Test helper - writes a minimal but valid safetensors file. */
function writeSyntheticSafetensors(file, tensors) {
  const header = {};
  let offset = 0;
  for (const tensor of tensors) {
    const count = tensor.shape.reduce((a, b) => a * b, 1);
    header[tensor.name] = {
      dtype: 'F32',
      shape: tensor.shape,
      data_offsets: [offset, offset + count * 4],
    };
    offset += count * 4;
  }
  const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64LE(BigInt(headerJson.length), 0);
  fs.writeFileSync(file, Buffer.concat([lenBuf, headerJson, Buffer.alloc(offset)]));
  return offset;
}

module.exports.writeSyntheticSafetensors = writeSyntheticSafetensors;

/* ===========================================================================
 * Self test
 *   node electron/modelManager.cjs --selftest
 * Exercises the real network + disk paths so the manager can be verified
 * without launching Electron.
 * ======================================================================== */

async function runSelfTest() {
  const os = require('os');
  let failures = 0;
  const check = (label, condition, detail) => {
    if (!condition) failures += 1;
    console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
  };

  const root = path.join(os.tmpdir(), 'tts-model-manager-selftest');
  await fsp.rm(root, { recursive: true, force: true });
  await ensureDir(root);

  console.log('1. Hugging Face repo listing');
  const tree = await fetchRepoTree('hexgrad/Kokoro-82M');
  check('repo tree returned files', tree.length > 0, `${tree.length} files`);

  console.log('2. Real download to disk');
  const configFile = tree.find((f) => f.path === 'config.json');
  const smallWeights = tree
    .filter((f) => isWeightFile(f.path) && f.size > 0 && f.size < 6 * 1024 * 1024)
    .sort((a, b) => a.size - b.size);
  const small = [configFile, smallWeights[0], smallWeights[1]].filter(Boolean);
  check('found small test files', small.length >= 2, small.map((f) => `${f.path} (${formatBytes(f.size)})`).join(', '));
  check('test set contains a weight file', small.some((f) => isWeightFile(f.path)));
  const events = [];
  const manifest = await downloadModel({
    modelsRoot: root,
    modelId: 'selftest-kokoro',
    repo: 'hexgrad/Kokoro-82M',
    files: small,
    onProgress: (p) => events.push(p),
  });
  check('manifest written', manifest.files.length === small.length);
  check('progress events emitted', events.length > 0, `${events.length} events, last=${events[events.length - 1].status}`);
  const firstFile = path.join(root, 'selftest-kokoro', small[0].path.replace(/\//g, path.sep));
  const onDisk = (await fsp.stat(firstFile)).size;
  check('downloaded bytes match hub size', onDisk === small[0].size, `${onDisk} bytes`);

  console.log('3. Verify + installed inventory');
  const verified = await verifyModel(root, 'selftest-kokoro');
  check(
    'integrity verified (nothing missing or resized)',
    verified.missing.length === 0 && verified.sizeMismatch.length === 0,
    `bytes=${verified.bytes} files=${verified.fileCount}`
  );
  check('verifyModel ok with weights on disk', verified.ok, `weightFiles=${verified.weightFileCount}`);
  const installed = await listInstalled(root);
  check('listInstalled sees the folder', Boolean(installed['selftest-kokoro']));

  const noWeightsDir = path.join(root, 'selftest-noweights');
  await ensureDir(noWeightsDir);
  await fsp.writeFile(path.join(noWeightsDir, 'config.json'), '{"model_type":"qwen3_tts"}', 'utf8');
  const noWeights = await verifyModel(root, 'selftest-noweights');
  check('verifyModel rejects a folder without weights', noWeights.ok === false, `ok=${noWeights.ok}`);

  console.log('4. Re-running must not re-download');
  const before = (await scanFolder(path.join(root, 'selftest-kokoro'))).bytes;
  await downloadModel({
    modelsRoot: root,
    modelId: 'selftest-kokoro',
    repo: 'hexgrad/Kokoro-82M',
    files: small,
    onProgress: () => undefined,
  });
  const after = (await scanFolder(path.join(root, 'selftest-kokoro'))).bytes;
  check('no duplicate bytes written', before === after, `${before} -> ${after}`);

  console.log('5. Local folder inspection (synthetic safetensors)');
  const synthetic = path.join(root, 'selftest-synthetic');
  await ensureDir(synthetic);
  await fsp.writeFile(
    path.join(synthetic, 'config.json'),
    JSON.stringify({
      model_type: 'qwen3_tts',
      architectures: ['Qwen3TTSForCausalLM'],
      hidden_size: 1024,
      num_hidden_layers: 24,
    }),
    'utf8'
  );
  writeSyntheticSafetensors(path.join(synthetic, 'model.safetensors'), [
    { name: 'a', shape: [1000, 2] },
    { name: 'b', shape: [500] },
  ]);
  const inspected = await inspectFolder(synthetic);
  check('inspection valid', inspected.valid === true);
  check('adapter detected from config.json', inspected.adapter === 'qwen3', inspected.adapter);
  check('parameter count read from headers', inspected.parameterCount === 2500, String(inspected.parameterCount));
  check('config summary parsed', inspected.configSummary && inspected.configSummary.hiddenSize === 1024);
  check('missing tokenizer reported', inspected.warnings.some((w) => /tokenizer/i.test(w)));

  console.log('6. Delete from disk');
  await deleteModel(root, 'selftest-kokoro');
  check('folder removed', !(await pathExists(path.join(root, 'selftest-kokoro'))));

  await fsp.rm(root, { recursive: true, force: true });
  console.log(failures === 0 ? '\nSELFTEST RESULT: ALL PASSED' : `\nSELFTEST RESULT: ${failures} FAILED`);
  return failures;
}

if (require.main === module && process.argv.includes('--selftest')) {
  runSelfTest()
    .then((failures) => process.exit(failures === 0 ? 0 : 1))
    .catch((err) => {
      console.error('SELFTEST ERROR:', err && err.stack ? err.stack : err);
      process.exit(2);
    });
}
