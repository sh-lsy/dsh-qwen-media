// dsh-qwen-media image generation (Token Plan, DashScope protocol, sync or async).
// Usage: node image.mjs --model <id> --prompt <text> [options]   (--check/--doctor/--stats/--version supported)
import path from 'node:path';
import { IMAGE_MODELS, SkillError, resolveKey, outDir, stamp, fail, apiJson, download, toImageInput, solveSize, ledgerAppend, parseArgs, commonEntry, redact, checkPromptLength } from './lib.mjs';

const BOOLS = ['sequential', 'no-extend', 'extend', 'thinking', 'watermark', 'async', 'dry-run', 'check', 'doctor', 'stats', 'version'];
const ARRAYS = ['image'];

function extractImages(json) {
  const out = [];
  for (const c of (json.output && json.output.choices) || []) {
    for (const part of (c.message && c.message.content) || []) if (part.image) out.push(part.image);
  }
  for (const r of (json.output && json.output.results) || []) if (r.url) out.push(r.url);
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { booleans: BOOLS, arrays: ARRAYS });
  const { key, base } = await commonEntry(args);
  const model = args.model;
  if (!IMAGE_MODELS.includes(model)) throw new SkillError('PARAMS', `Unknown image model "${model}". Personal Token Plan supports: ${IMAGE_MODELS.join(', ')}. See references/models.md.`, 6);
  if (!args.prompt || !args.prompt.trim()) throw new SkillError('PARAMS', '--prompt is required.', 6);
  const isQwen = model.startsWith('qwen');
  const images = (args.image || []).map((v) => toImageInput(v, 10 * 1048576));
  if (isQwen && images.length > 3) throw new SkillError('PARAMS', 'qwen-image-3.0-pro accepts at most 3 reference images.', 6);
  const notes = [];
  checkPromptLength(model, args.prompt, notes);
  const solved = solveSize(model, args, images.length > 0, !!args.sequential);
  if (solved.note) notes.push(solved.note);
  const hasRefs = images.length > 0;
  const extend = args.extend ? true : (args['no-extend'] ? false : !hasRefs);
  if (hasRefs && !extend && !args['no-extend']) notes.push('reference task: prompt_extend auto-disabled to preserve reference fidelity (--extend to force on).');
  const parameters = { watermark: !!args.watermark, prompt_extend: extend };
  if (solved.size) parameters.size = solved.size;
  if (args.n) {
    const n = parseInt(args.n, 10);
    if (!Number.isInteger(n) || n < 1 || (isQwen && n > 6)) throw new SkillError('PARAMS', 'n must be an integer 1-6 (qwen) / >=1 (wan).', 6);
    parameters.n = n;
  }
  if (args.seed) parameters.seed = parseInt(args.seed, 10);
  if (isQwen) {
    if (args.negative) parameters.negative_prompt = args.negative;
  } else {
    if (args.negative) notes.push('negative_prompt is not supported by wan2.7 models; ignored.');
    if (args.thinking) parameters.thinking_mode = true;
    if (args.sequential) parameters.enable_sequential = true;
    if (args.bbox) { try { parameters.bbox_list = JSON.parse(args.bbox); } catch { throw new SkillError('PARAMS', '--bbox must be valid JSON (array of per-image box arrays).', 6); } }
  }
  const body = { model, input: { messages: [{ role: 'user', content: [{ text: args.prompt }, ...images.map((image) => ({ image }))] }] }, parameters };
  const dir = outDir(args);
  if (args['dry-run']) { process.stdout.write(JSON.stringify({ dryRun: true, model, endpoint: base + '/api/v1/services/aigc/multimodal-generation/generation', body, notes }, null, 2) + '\n'); process.exit(0); }
  let json; let taskId = null;
  if (args.async) {
    const sub = await apiJson(base, key, '/api/v1/services/aigc/multimodal-generation/generation', { method: 'POST', body, headers: { 'x-dashscope-async': 'enable' }, timeoutMs: 120000 });
    taskId = sub.json.output && sub.json.output.task_id;
    if (!taskId) throw new SkillError('API_ERROR', 'Async submit returned no task_id: ' + JSON.stringify(sub.json).slice(0, 300), 4);
    const deadline = Date.now() + (parseInt(args.timeout || '20', 10) * 60000);
    for (;;) {
      if (Date.now() > deadline) throw new SkillError('TIMEOUT', `Image task ${taskId} still running; resume later with video.mjs-style polling or re-run. task_id valid 24h.`, 4);
      await new Promise((r) => setTimeout(r, 5000));
      const q = await apiJson(base, key, `/api/v1/tasks/${taskId}`, { timeoutMs: 60000 });
      const st = q.json.output && q.json.output.task_status;
      if (st === 'SUCCEEDED') { json = q.json; break; }
      if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(st)) throw new SkillError('API_ERROR', `Image task ${st}: ${JSON.stringify(q.json.output).slice(0, 400)}`, 4);
    }
  } else {
    const res = await apiJson(base, key, '/api/v1/services/aigc/multimodal-generation/generation', { method: 'POST', body, timeoutMs: 300000 });
    json = res.json;
  }
  const urls = extractImages(json);
  if (!urls.length) throw new SkillError('API_ERROR', 'No image in response: ' + redact(JSON.stringify(json).slice(0, 400), key), 4);
  const files = [];
  for (let i = 0; i < urls.length; i++) {
    const dest = path.join(dir, `${model}_${stamp()}_${i + 1}.png`);
    await download(urls[i], dest, key);
    files.push(dest);
  }
  ledgerAppend(dir, { kind: 'image', model, usage: json.usage || null, files, task_id: taskId });
  process.stdout.write(JSON.stringify({ ok: true, model, files, usage: json.usage || null, task_id: taskId, notes }, null, 2) + '\n');
}

main().catch((e) => { let key = null; try { key = resolveKey().key; } catch { /* ignore */ } fail(e, key); });
