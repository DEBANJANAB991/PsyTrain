/**
 * Compressed avatars and room lighting for the Vite dev server (and `vite preview`).
 *
 * Vite serves public/ files as they are, and the Cloudflare tunnel does not compress model/gltf-binary either, so the
 * avatars (12-14 MB) crossed the tunnel at full size. Their vertex and morph-target data compresses well: .glb and
 * .hdr files are sent brotli- or gzip-encoded instead (avatars about 40 % smaller, byte-identical once decoded).
 * Each file is compressed once per version and kept in memory; ETags keep reloads at a 304.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const TYPES = { '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance' };
const ENCODERS = {
  br: promisify(zlib.brotliCompress),
  gzip: promisify(zlib.gzip)
};
const OPTIONS = { br: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }, gzip: { level: 6 } };

function middleware(root) {
  const cache = new Map();   // `${encoding}:${file}` -> { version, data: Promise<Buffer> }

  return async (req, res, next) => {
    const type = TYPES[path.extname((req.url || '').split('?')[0]).toLowerCase()];
    if (!type || (req.method !== 'GET' && req.method !== 'HEAD') || req.headers.range) return next();
    const accept = String(req.headers['accept-encoding'] || '');
    const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
    if (!encoding) return next();
    let file, stat;
    try {
      file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
      if (!file.startsWith(root + path.sep)) return next();
      stat = fs.statSync(file);
      if (!stat.isFile()) return next();
    } catch { return next(); }

    const version = `${stat.size}-${stat.mtimeMs}`;
    const etag = `W/"${encoding}-${version}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }

    const key = `${encoding}:${file}`;
    let entry = cache.get(key);
    if (entry?.version !== version) {
      entry = { version, data: fs.promises.readFile(file).then((raw) => ENCODERS[encoding](raw, OPTIONS[encoding])) };
      cache.set(key, entry);
    }
    let body;
    try { body = await entry.data; } catch { cache.delete(key); return next(); }
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Encoding', encoding);
    res.setHeader('Content-Length', body.length);
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}

export function compressAssets() {
  let publicDir = '', outDir = '';
  return {
    name: 'psytrain-compress-assets',
    configResolved(config) { publicDir = config.publicDir; outDir = path.resolve(config.root, config.build.outDir); },
    configureServer(server) { server.middlewares.use(middleware(publicDir)); },
    configurePreviewServer(server) { server.middlewares.use(middleware(outDir)); }
  };
}
