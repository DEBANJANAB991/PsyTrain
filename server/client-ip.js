/**
 * The visitor's IP for per-user rate limits.
 *
 * Behind the Cloudflare tunnel every request reaches the dev server from cloudflared on this machine, so the
 * socket address is 127.0.0.1 for everyone. Cloudflare puts the real visitor's address in CF-Connecting-IP.
 * That header is only trusted when the request comes from this machine (cloudflared); a visitor on the local
 * network cannot fake it to dodge the limit.
 */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function clientIp(req) {
  const socket = req.socket?.remoteAddress || '?';
  if (!LOOPBACK.has(socket)) return socket;
  const cf = String(req.headers['cf-connecting-ip'] || '').trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(cf) ? cf : socket;
}
