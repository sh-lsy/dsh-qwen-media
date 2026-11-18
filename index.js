/**
 * dsh-qwen-media bundle entry: registers the SKILL.md at this package root as a
 * DSH skill, so `dsh plugin add` installs the capability without cloning into a
 * skills directory. No runtime dependencies and no imports from the harness
 * packages, so the bundle loads on any host that mounts the skill registry.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package root, which is also the skill directory: SKILL.md and scripts/ live here. */
const SKILL_DIR = dirname(fileURLToPath(import.meta.url))
/** Public skill name; matches the directory name used by the clone-based install. */
const SKILL_NAME = 'dsh-qwen-media'
/** Run after the profile's own skill roots, so a local checkout still wins. */
const BUNDLED_SKILL_RANK = 600

/**
 * Split YAML frontmatter from the instruction body.
 * @param raw - SKILL.md contents.
 * @returns The single-line description and the body the model receives.
 */
function parseSkill(raw) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (frontmatter === null) return { description: undefined, body: raw.trim() }
  const description = /^description:[ \t]*(.+)$/mu.exec(frontmatter[1])?.[1]?.trim()
  return { description, body: raw.slice(frontmatter[0].length).trim() }
}

/** Cordis plugin identity. */
export const name = 'qwen-media'
/** Registry this provider registers into. */
export const inject = ['skills']

/**
 * Register the bundled skill provider.
 * @param ctx - Context carrying the skill registry.
 */
export function apply(ctx) {
  ctx.skills.registerProvider(control => ({
    name: 'qwen-media',
    async list(options) {
      const path = join(SKILL_DIR, 'SKILL.md')
      let raw
      try {
        raw = await readFile(path, { encoding: 'utf8', signal: options?.signal })
      } catch (error) {
        if (error !== null && typeof error === 'object' && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
          control.invalidate()
          return { candidates: [], complete: true }
        }
        throw error
      }
      const { description } = parseSkill(raw)
      return {
        candidates: [{
          name: SKILL_NAME,
          description: description ?? 'Token Plan image and video generation',
          invocation: { modelInvocable: true, userInvocable: true },
          provider: 'qwen-media',
          source: 'bundled',
          rank: BUNDLED_SKILL_RANK,
          resourceBase: { kind: 'directory', path: SKILL_DIR.split('\\').join('/') },
          locator: path,
        }],
        complete: true,
      }
    },
    async get(candidate, options) {
      const raw = await readFile(candidate.locator ?? join(SKILL_DIR, 'SKILL.md'), { encoding: 'utf8', signal: options?.signal })
      const { rank: _rank, locator: _locator, ...summary } = candidate
      return { ...summary, content: parseSkill(raw).body }
    },
  }))
}