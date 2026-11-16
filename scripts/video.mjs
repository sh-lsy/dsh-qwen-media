// dsh-qwen-media video generation (Token Plan, async task submit + poll + download).
// Usage: node video.mjs --model <id> --prompt <text> [options] | --task <id> to resume polling/download.
import path from 'node:path';
import { VIDEO_MODELS, SkillError, resolveKey, host, outDir, stamp, fail, apiJson, download, toImageInput, ledgerAppend, parseArgs, commonEntry, redact } from './lib.mjs';

const BOOLS = ['watermark', 'no-extend', 'extend', 'dry-run', 'check', 'doctor', 'stats', 'version'];
const ARRAYS = ['ref', 'ref-video'];
const RESOLUTIONS = ['480P', '720P', '1080P'];
const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9'];

async function pollAndDownload(base, key, taskId, args, model) {
  const dir = outDir(args);
  const deadline = Date.now() + (parseInt(args.timeout || '20', 10) * 60000);
  for (;;) {
    const q = await apiJson(base, key, `/api/v1/tasks/${taskId}`, { timeoutMs: 60000 });
    const out = q.json.output || {};
    const st = out.task_status;
    if (st === 'SUCCEEDED') {
      if (!out.video_url) throw new SkillError('API_ERROR', 'Task SUCCEEDED but no video_url: ' + JSON.stringify(out).slice(0, 300), 4);
      const dest = path.join(dir, `${model || 'resume'}_${stamp()}.mp4`);
      await download(out.video_url, dest, key);
      const usage = q.json.usage || null;
      ledgerAppend(dir, { kind: 'video', model: model || 'resume', usage, seconds: (usage && usage.duration) || args.duration || null, resolution: (usage && usage.SR) || args.resolution || null, files: [dest], task_id: taskId });
      process.stdout.write(JSON.stringify({ ok: true, model: model || 'resume', file: dest, task_id: taskId, usage }, null, 2) + '\n');
      return;
    }
    if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(st)) throw new SkillError('API_ERROR', `Video task ${st}: ${redact(JSON.stringify(out).slice(0, 400), key)} (failed tasks are not billed)`, 4);
    if (Date.now() > deadline) throw new SkillError('TIMEOUT', `Video task ${taskId} still ${st}; resume with: node video.mjs --task ${taskId} (task_id valid 24h).`, 4);
    process.stderr.write(`[dsh-qwen-media] task ${taskId} status=${st}\n`);
    await new Promise((r) => setTimeout(r, 10000));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { booleans: BOOLS, arrays: ARRAYS });
  await commonEntry(args, args.region);
  const { key } = resolveKey();
  const base = host(args.region);
  if (args.task) { await pollAndDownload(base, key, args.task, args, args.model); return; }
  const model = args.model;
  if (!VIDEO_MODELS.includes(model)) throw new SkillError('PARAMS', `Unknown video model "${model}". Personal Token Plan supports: ${VIDEO_MODELS.join(', ')}. See references/models.md.`, 6);
  if (!args.prompt || !args.prompt.trim()) throw new SkillError('PARAMS', '--prompt is required.', 6);
  const notes = [];
  const isWan = model === 'wan3.0-video';
  const isI2V = model === 'happyhorse-1.1-i2v';
  const isR2V = model === 'happyhorse-1.1-r2v';
  const input = { prompt: args.prompt };
  const media = [];
  const firstFrame = args['first-frame'];
  const refs = args.ref || [];
  const refVideos = args['ref-video'] || [];
  if (isI2V) {
    if (!firstFrame || refs.length || refVideos.length) throw new SkillError('PARAMS', 'happyhorse-1.1-i2v requires exactly one --first-frame and no refs.', 6);
    media.push({ type: 'first_frame', url: toImageInput(firstFrame, 20 * 1048576) });
  } else if (isR2V) {
    if (firstFrame) throw new SkillError('PARAMS', 'happyhorse-1.1-r2v takes --ref images (1-9), not --first-frame.', 6);
    if (refs.length < 1 || refs.length > 9) throw new SkillError('PARAMS', 'happyhorse-1.1-r2v requires 1-9 --ref images.', 6);
    for (const r of refs) media.push({ type: 'reference_image', url: toImageInput(r, 20 * 1048576) });
    if (!/\[Image\s*\d+\]/i.test(args.prompt)) notes.push('Prompt has no [Image n] reference; add e.g. "[Image 1] 中的角色…" so the model binds references (see references/prompt-guide.md).');
  } else if (isWan) {
    if (firstFrame) media.push({ type: 'first_frame', url: toImageInput(firstFrame, 20 * 1048576) });
    for (const r of refs) media.push({ type: 'reference_image', url: toImageInput(r, 20 * 1048576) });
    for (const r of refVideos) media.push({ type: 'reference_video', url: r });
    if (refs.length + refVideos.length > 5) throw new SkillError('PARAMS', 'wan reference images + videos must be <= 5.', 6);
    if (args['media-file'] && args['media-link']) throw new SkillError('PARAMS', 'wan3.0 --media-file and --media-link are mutually exclusive.', 6);
    if (args['media-file']) media.push({ type: 'file', url: args['media-file'] });
    if (args['media-link']) media.push({ type: 'link', url: args['media-link'] });
    if (args['audio-url']) input.audio_url = args['audio-url'];
    if ((refs.length || refVideos.length) && !/(图\s*\d+|视频\s*\d+|Image\s*\d+|Video\s*\d+)/i.test(args.prompt)) notes.push('Prompt has no 图 n / 视频 n (Image n / Video n) reference; add it so the model binds references.');
  } else {
    if (firstFrame || refs.length || refVideos.length || args['audio-url'] || args['media-file'] || args['media-link']) throw new SkillError('PARAMS', 'happyhorse-1.1-t2v is text-only; use i2v/r2v or wan3.0-video for media inputs.', 6);
  }
  if (media.length) input.media = media;
  const resolution = (args.resolution || '720P').toUpperCase();
  if (!RESOLUTIONS.includes(resolution)) throw new SkillError('PARAMS', 'resolution must be 480P, 720P or 1080P.', 6);
  const duration = parseInt(args.duration || '5', 10);
  const [dMin, dMax] = isWan ? [2, 30] : [3, 15];
  if (!Number.isInteger(duration) || duration < dMin || duration > dMax) throw new SkillError('PARAMS', `duration for ${model} must be an integer ${dMin}-${dMax} seconds.`, 6);
  const hasRefs = media.length > 0;
  const extend = args.extend ? true : (args['no-extend'] ? false : !hasRefs);
  if (hasRefs && !extend && !args['no-extend']) notes.push('reference task: prompt_extend auto-disabled to preserve reference fidelity (--extend to force on).');
  const parameters = { resolution, duration, watermark: !!args.watermark, prompt_extend: extend };
  if (isI2V) {
    if (args.ratio) notes.push('i2v output aspect follows the first frame; ratio ignored.');
  } else if (isWan && firstFrame) {
    if (args.ratio) notes.push('wan with first frame ignores ratio; output follows the first frame aspect.');
  } else {
    const ratio = args.ratio || '16:9';
    if (!RATIOS.includes(ratio)) throw new SkillError('PARAMS', `ratio must be one of ${RATIOS.join(', ')}.`, 6);
    parameters.ratio = ratio;
  }
  if (args.seed) parameters.seed = parseInt(args.seed, 10);
  if (isWan && args.negative) parameters.negative_prompt = args.negative;
  if (!isWan && args.negative) notes.push('negative_prompt is only supported by wan3.0-video; ignored.');
  if (args['dry-run']) { process.stdout.write(JSON.stringify({ dryRun: true, model, endpoint: base + '/api/v1/services/aigc/video-generation/video-synthesis', body: { model, input, parameters }, notes }, null, 2) + '\n'); process.exit(0); }
  const sub = await apiJson(base, key, '/api/v1/services/aigc/video-generation/video-synthesis', { method: 'POST', body: { model, input, parameters }, headers: { 'x-dashscope-async': 'enable' }, timeoutMs: 120000 });
  const taskId = sub.json.output && sub.json.output.task_id;
  if (!taskId) throw new SkillError('API_ERROR', 'Submit returned no task_id: ' + redact(JSON.stringify(sub.json).slice(0, 300), key), 4);
  process.stderr.write(`[dsh-qwen-media] submitted task ${taskId}\n`);
  if (notes.length) process.stderr.write('[dsh-qwen-media] notes: ' + notes.join(' | ') + '\n');
  await pollAndDownload(base, key, taskId, { ...args, resolution, duration }, model);
}

main().catch((e) => { let key = null; try { key = resolveKey().key; } catch { /* ignore */ } fail(e, key); });
