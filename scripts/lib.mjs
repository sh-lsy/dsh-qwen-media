// dsh-qwen-media shared helpers. Zero npm dependencies; Node >= 18.
// The API key is resolved at runtime and never printed, logged, or passed via argv.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import tls from 'node:tls';

export const VERSION = '1.1.0';
export const IMAGE_MODELS = ['qwen-image-3.0-pro', 'wan2.7-image-pro', 'wan2.7-image'];
export const VIDEO_MODELS = ['wan3.0-video', 'happyhorse-1.1-t2v', 'happyhorse-1.1-i2v', 'happyhorse-1.1-r2v'];
const KEY_NAMES = ['QWEN_TOKEN_PLAN_CN_API_KEY', 'QWEN_TOKEN_PLAN_API_KEY', 'TOKEN_PLAN_API_KEY'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', gif: 'image/gif' };

export function dshHome() { return process.env.DSH_HOME || path.join(os.homedir(), '.dsh'); }
export function host(region) { return region === 'intl' ? 'https://token-plan.ap-southeast-1.maas.aliyuncs.com' : 'https://token-plan.cn-beijing.maas.aliyuncs.com'; }
export function outDir(args) { return args.out ? path.resolve(args.out) : path.join(process.cwd(), 'qwen-media-output'); }
export function stamp() { return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14); }

export class SkillError extends Error {
  constructor(code, message, exitCode = 4) { super(message); this.code = code; this.exitCode = exitCode; }
}

function unquote(v) {
  const s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}
function parseEnvFile(p) {
  const out = {};
  try {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 1) continue;
      out[t.slice(0, i).trim()] = unquote(t.slice(i + 1));
    }
  } catch { /* missing file = empty layer */ }
  return out;
}
// Mirrors dsh-credentials-local precedence: storage file > launch env > project .env > home .env.
function parseCredentialsRefs(p) {
  const out = {};
  try {
    let inRefs = false;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      if (/^refs:\s*$/.test(line)) { inRefs = true; continue; }
      if (/^\S/.test(line)) { inRefs = false; continue; }
      if (!inRefs) continue;
      const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (m && unquote(m[2])) out[m[1]] = unquote(m[2]);
    }
  } catch { /* missing file = empty layer */ }
  return out;
}

export function resolveKey() {
  const layers = [
    ['credentials.yaml refs', parseCredentialsRefs(path.join(dshHome(), '.credentials.yaml'))],
    ['process environment', process.env],
    ['project .env', parseEnvFile(path.join(process.cwd(), '.env'))],
    ['home .env', parseEnvFile(path.join(dshHome(), '.env'))],
  ];
  for (const [source, map] of layers) {
    for (const name of KEY_NAMES) {
      const v = map[name];
      if (v && String(v).trim()) {
        const key = String(v).trim();
        if (!key.startsWith('sk-sp-')) {
          throw new SkillError('WRONG_KEY_TYPE', `${name} resolved from ${source} does not start with sk-sp-; it looks like a pay-as-you-go key, which would bill separately from the Token Plan subscription. Configure the qwen-token-plan-cn subscription key instead.`, 3);
        }
        return { key, source: `${source} (${name})` };
      }
    }
  }
  throw new SkillError('KEY_MISSING', 'No Token Plan API key found. Configure it in DSH Settings -> Models -> qwen-token-plan-cn (enter the sk-sp- key), or add a line QWEN_TOKEN_PLAN_CN_API_KEY=sk-sp-... to ~/.dsh/.env (Windows: %USERPROFILE%\\.dsh\\.env). Never paste the key into chat.', 2);
}

export function redact(text, key) { let s = String(text); if (key) s = s.split(key).join('[redacted]'); return s; }
export function fail(err, key) {
  const code = err instanceof SkillError ? err.code : 'UNEXPECTED';
  const exitCode = err instanceof SkillError ? err.exitCode : 4;
  process.stdout.write(JSON.stringify({ ok: false, code, message: redact(err.message || String(err), key) }, null, 2) + '\n');
  process.exit(exitCode);
}

// ---------- HTTP (direct, or zero-dependency CONNECT tunnel when HTTP(S)_PROXY is set) ----------
function proxyFor(u) {
  const p = u.protocol === 'https:'
    ? (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy)
    : (process.env.HTTP_PROXY || process.env.http_proxy);
  if (!p) return null;
  try { return new URL(p); } catch { return null; }
}
function connectSocket(u, proxy) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => reject(new SkillError('NETWORK', `Connect failed: ${e.message}`, 5));
    if (proxy && u.protocol === 'https:') {
      const s = net.connect({ host: proxy.hostname, port: Number(proxy.port || 80) });
      s.once('error', onErr);
      s.once('connect', () => s.write(`CONNECT ${u.hostname}:${u.port || 443} HTTP/1.1\r\nHost: ${u.hostname}\r\n\r\n`));
      let buf = Buffer.alloc(0);
      const onData = (c) => {
        buf = Buffer.concat([buf, c]);
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        s.removeListener('data', onData);
        const statusLine = buf.slice(0, i).toString('latin1').split('\r\n')[0];
        if (!/ 200 /.test(statusLine)) { s.destroy(); reject(new SkillError('NETWORK', `Proxy CONNECT failed: ${statusLine}`, 5)); return; }
        const leftover = buf.slice(i + 4);
        const t = tls.connect({ socket: s, servername: u.hostname });
        t.once('error', onErr);
        t.once('secureConnect', () => { if (leftover.length) t.unshift(leftover); resolve(t); });
      };
      s.on('data', onData);
    } else if (proxy) {
      const s = net.connect({ host: proxy.hostname, port: Number(proxy.port || 80) });
      s.once('error', onErr); s.once('connect', () => resolve(s));
    } else if (u.protocol === 'https:') {
      const t = tls.connect({ host: u.hostname, port: Number(u.port || 443), servername: u.hostname });
      t.once('error', onErr); t.once('secureConnect', () => resolve(t));
    } else {
      const s = net.connect({ host: u.hostname, port: Number(u.port || 80) });
      s.once('error', onErr); s.once('connect', () => resolve(s));
    }
  });
}
function parseResponse(buf) {
  const sep = buf.indexOf('\r\n\r\n');
  if (sep < 0) throw new SkillError('NETWORK', 'Malformed HTTP response', 5);
  const lines = buf.slice(0, sep).toString('latin1').split('\r\n');
  const status = parseInt(lines[0].split(' ')[1], 10);
  const headers = {};
  for (const l of lines.slice(1)) { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }
  let body = buf.slice(sep + 4);
  if ((headers['transfer-encoding'] || '').includes('chunked')) {
    const parts = []; let off = 0;
    while (off < body.length) {
      const nl = body.indexOf('\r\n', off); if (nl < 0) break;
      const size = parseInt(body.slice(off, nl).toString('latin1').trim(), 16);
      if (!Number.isFinite(size) || size === 0) break;
      parts.push(body.slice(nl + 2, nl + 2 + size)); off = nl + 2 + size + 2;
    }
    body = Buffer.concat(parts);
  }
  return { status, headers, body };
}
export async function httpRequest(target, { method = 'GET', headers = {}, body = null, timeoutMs = 120000 } = {}) {
  const u = new URL(target);
  const proxy = proxyFor(u);
  const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const hdrs = { host: u.host, connection: 'close', ...headers };
  if (payload) { hdrs['content-length'] = String(payload.length); if (!hdrs['content-type']) hdrs['content-type'] = 'application/json'; }
  const reqPath = proxy && u.protocol === 'http:' ? u.href : `${u.pathname}${u.search}`;
  const head = `${method} ${reqPath} HTTP/1.1\r\n` + Object.entries(hdrs).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n';
  const sock = await connectSocket(u, proxy);
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { sock.destroy(); reject(new SkillError('NETWORK', `Request timeout after ${timeoutMs}ms: ${method} ${u.host}${u.pathname}`, 5)); }, timeoutMs);
    const chunks = [];
    sock.on('data', (c) => chunks.push(c));
    sock.on('error', (e) => { clearTimeout(timer); reject(new SkillError('NETWORK', `Socket error: ${e.message}`, 5)); });
    sock.on('end', () => { clearTimeout(timer); try { resolve(parseResponse(Buffer.concat(chunks))); } catch (e) { reject(e); } });
    sock.write(head);
    if (payload) sock.write(payload);
  });
}
export async function apiJson(base, key, apiPath, { method = 'GET', body = null, headers = {}, timeoutMs = 120000 } = {}) {
  const res = await httpRequest(base + apiPath, { method, body, timeoutMs, headers: { authorization: `Bearer ${key}`, ...headers } });
  let json = null;
  try { json = JSON.parse(res.body.toString('utf8')); } catch { /* non-JSON error body */ }
  if (res.status >= 400) {
    const code = json && (json.code || json.error_code) || '';
    const msg = json && (json.message || json.error && json.error.message) || res.body.toString('utf8').slice(0, 400);
    throw new SkillError('API_ERROR', `HTTP ${res.status} ${code} ${msg}`.trim(), 4);
  }
  return { status: res.status, json };
}
export async function download(url, dest, key) {
  const res = await httpRequest(url, { timeoutMs: 300000 });
  if (res.status !== 200) throw new SkillError('DOWNLOAD', `Download failed HTTP ${res.status} for result URL (URLs expire after 24h).`, 4);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, res.body);
  return res.body.length;
}

// ---------- inputs ----------
// DSH attachment object paths are content-addressed and extensionless; sniff magic bytes.
function sniffMime(b) {
  const tag = (n) => b.slice(0, n).toString('latin1');
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && tag(4) === '\x89PNG') return 'image/png';
  if (b.length > 12 && tag(4) === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length > 6 && tag(6).startsWith('GIF8')) return 'image/gif';
  if (b.length > 2 && tag(2) === 'BM') return 'image/bmp';
  if (b.length > 4 && (tag(4) === 'II*\x00' || tag(4) === 'MM\x00*')) return 'image/tiff';
  return null;
}
export function toImageInput(v, maxBytes) {
  if (/^https?:\/\//i.test(v) || v.startsWith('data:')) return v;
  const p = path.resolve(v);
  const st = fs.statSync(p); // throws if missing -> surfaced as UNEXPECTED
  if (st.size > maxBytes) throw new SkillError('PARAMS', `Input image ${p} is ${(st.size / 1048576).toFixed(1)}MB, over the ${maxBytes / 1048576}MB limit. Compress it or provide a public URL.`, 6);
  const buf = fs.readFileSync(p);
  const mime = MIME[path.extname(p).slice(1).toLowerCase()] || sniffMime(buf);
  if (!mime) throw new SkillError('PARAMS', `Unsupported image format for ${p}; use PNG/JPG/WEBP/BMP/TIFF/GIF.`, 6);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ---------- size solver ----------
const TIER_PIXELS = { '1K': 1024 * 1024, '2K': 2048 * 2048, '4K': 4096 * 4096 };
export function solveSize(model, args, hasImages, sequential) {
  const isWan = model.startsWith('wan');
  if (args.size) {
    if (isWan && TIER_PIXELS[args.size.toUpperCase()]) return { size: args.size.toUpperCase() };
    const m = String(args.size).match(/^(\d+)\*(\d+)$/);
    if (!m) throw new SkillError('PARAMS', `size must be W*H (e.g. 1024*1024)${isWan ? ' or a tier 1K/2K/4K' : ''}.`, 6);
    return { size: args.size };
  }
  const tier = args.tier ? args.tier.toUpperCase() : null;
  if (tier && !TIER_PIXELS[tier]) throw new SkillError('PARAMS', 'tier must be 1K, 2K or 4K.', 6);
  if (isWan && tier === '4K' && (model !== 'wan2.7-image-pro' || hasImages || sequential)) throw new SkillError('PARAMS', '4K is only for wan2.7-image-pro text-to-image without sequential mode; use 2K for editing/sets or wan2.7-image.', 6);
  if (!isWan && tier === '4K') throw new SkillError('PARAMS', 'qwen-image-3.0-pro max output is 2K (2048*2048 total pixels).', 6);
  if (args.aspect) {
    if (isWan && tier) throw new SkillError('PARAMS', 'wan tier output is square (or follows the last input image); drop --aspect or use pixel size.', 6);
    const m = String(args.aspect).match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!m) throw new SkillError('PARAMS', 'aspect must be W:H, e.g. 16:9.', 6);
    const r = Number(m[1]) / Number(m[2]);
    if (r < 1 / 8 || r > 8) throw new SkillError('PARAMS', 'aspect ratio must be within 1:8 to 8:1.', 6);
    const cap = isWan ? (model === 'wan2.7-image-pro' && !hasImages && !sequential ? TIER_PIXELS['4K'] : TIER_PIXELS['2K']) : TIER_PIXELS['2K'];
    const target = Math.min(TIER_PIXELS[tier || '2K'], cap);
    let H = Math.round(Math.sqrt(target / r)); let W = Math.round(H * r);
    W = Math.max(512, W - (W % 2)); H = Math.max(512, H - (H % 2));
    return { size: `${W}*${H}`, note: `computed from aspect ${args.aspect} at ~${(W * H / 1048576).toFixed(1)}MP` };
  }
  if (tier) {
    if (isWan) return { size: tier };
    const side = Math.round(Math.sqrt(TIER_PIXELS[tier]));
    return { size: `${side}*${side}` };
  }
  return {}; // let the model auto-recommend
}

// ---------- ledger ----------
export function ledgerAppend(dir, entry) {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'ledger.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}
export function ledgerStats(dir) {
  const file = path.join(dir, 'ledger.jsonl');
  const rows = [];
  try { for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { if (l.trim()) rows.push(JSON.parse(l)); } } catch { /* empty */ }
  const byModel = {}; let images = 0; let videoSeconds = 0; const videoByRes = {};
  for (const r of rows) {
    byModel[r.model] = (byModel[r.model] || 0) + 1;
    if (r.kind === 'image') images += (r.usage && r.usage.image_count) || (r.files || []).length || 0;
    if (r.kind === 'video') { const s = Number(r.seconds || (r.usage && r.usage.duration) || 0); videoSeconds += s; const k = r.resolution || (r.usage && r.usage.SR) || '?'; videoByRes[k] = (videoByRes[k] || 0) + s; }
  }
  return { calls: rows.length, byModel, images, videoSeconds, videoByRes, ledger: file, note: 'Local estimate only; the Bailian console usage page is the billing source of truth.' };
}

// ---------- doctor / check ----------
export async function doctor(region) {
  const report = { version: VERSION, node: process.version, nodeOk: parseInt(process.version.slice(1), 10) >= 18, region: region || 'cn', host: host(region) };
  let key = null;
  try { const r = resolveKey(); key = r.key; report.keySource = r.source; report.keyPrefixOk = true; }
  catch (e) { report.keySource = null; report.keyProblem = e.code; return report; }
  try {
    const res = await httpRequest(report.host + '/api/v1/tasks/00000000-0000-0000-0000-000000000000', { headers: { authorization: `Bearer ${key}` }, timeoutMs: 30000 });
    report.authProbe = res.status === 401 ? 'KEY_INVALID (401)' : `KEY_OK (probe HTTP ${res.status}, zero Credits)`;
  } catch (e) { report.authProbe = `NETWORK: ${redact(e.message, key)}`; }
  return report;
}

// ---------- args ----------
export function parseArgs(argv, { booleans = [], arrays = [] } = {}) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new SkillError('PARAMS', `Unexpected positional argument: ${a}`, 6);
    const name = a.slice(2);
    if (booleans.includes(name)) { args[name] = true; continue; }
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) throw new SkillError('PARAMS', `Missing value for --${name}`, 6);
    if (arrays.includes(name)) (args[name] = args[name] || []).push(v);
    else args[name] = v;
  }
  return args;
}
export async function commonEntry(args, region) {
  if (args.version) { process.stdout.write(VERSION + '\n'); process.exit(0); }
  if (args.check) {
    try { const r = resolveKey(); process.stdout.write(JSON.stringify({ ok: true, keySource: r.source }, null, 2) + '\n'); process.exit(0); }
    catch (e) { fail(e, null); }
  }
  if (args.doctor) { process.stdout.write(JSON.stringify(await doctor(region), null, 2) + '\n'); process.exit(0); }
  if (args.stats) { process.stdout.write(JSON.stringify(ledgerStats(outDir(args)), null, 2) + '\n'); process.exit(0); }
  return args;
}
