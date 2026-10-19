'use strict';
// Test HTTP server: Range support, per-connection throttling, random connection drops, redirects.
const http = require('http');
const crypto = require('crypto');

function makeServer({ data, perConnBps = 0, failRate = 0, noRange = false, etag = '"v1"', redirect = false }) {
  const stats = { bytesServed: 0, requests: 0, connections: 0, maxParallel: 0, active: 0 };
  const server = http.createServer(async (req, res) => {
    if (redirect && req.url === '/file') {
      res.writeHead(302, { Location: '/real' });
      return res.end();
    }
    stats.requests += 1;
    stats.active += 1;
    stats.maxParallel = Math.max(stats.maxParallel, stats.active);
    res.on('close', () => { stats.active -= 1; });

    let start = 0;
    let end = data.length - 1;
    let status = 200;
    const range = req.headers.range;
    if (range && !noRange) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        start = Number(m[1]);
        end = m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
        status = 206;
      }
    }
    const headers = { 'Content-Length': end - start + 1, ETag: etag, 'Accept-Ranges': noRange ? 'none' : 'bytes' };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${data.length}`;
    res.writeHead(status, headers);

    const step = 64 * 1024;
    let pos = start;
    const dropAt = failRate && Math.random() < failRate ? start + Math.floor((end - start) * Math.random()) : -1;
    while (pos <= end) {
      if (dropAt >= 0 && pos >= dropAt) { res.destroy(); return; }
      const n = Math.min(step, end - pos + 1);
      if (!res.write(data.subarray(pos, pos + n))) await new Promise((r) => res.once('drain', r));
      stats.bytesServed += n;
      pos += n;
      if (perConnBps) await new Promise((r) => setTimeout(r, (n / perConnBps) * 1000));
    }
    res.end();
  });
  return { server, stats };
}

function listen(opts) {
  const { server, stats } = makeServer(opts);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () =>
    resolve({ url: `http://127.0.0.1:${server.address().port}/${opts.redirect ? 'file' : 'real'}`, stats, close: () => server.close() })));
}

function makeData(bytes) {
  return crypto.randomBytes(bytes);
}

module.exports = { listen, makeData };
