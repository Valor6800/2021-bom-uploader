/**
 * Activity log — who did what to an Assembly, and when: Builds made, saved,
 * cut and archived, spares made, files asked for, Assemblies added. Each
 * entry is a comment on the Assembly's ticket, so it lasts, shows in the
 * tracker too, and needs no store of its own. The service account writes
 * them; the person is named in the text (from their sign-in).
 *
 * Recording never fails or slows the action it records: it runs after the
 * answer, and a failure is only logged.
 */

import { BuildField } from '../utils/buildConstants.js';

/** The first line of every entry: how the log tells its comments from people's. */
export const MARK = 'ValorBOM activity';
const ENTRY_RE = /^ValorBOM activity · ([a-z-]+)\r?\n([\s\S]*?) · ([\s\S]*)$/;

/** Words that would be read as tracker markup, made plain. */
const plain = (text) => String(text ?? '').replace(/[{}[\]|*_^~+#]/g, ' ').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 500);

/** The person's name from their sign-in, as the log shows it. */
export function actorName(user) {
  return plain(user?.name || user?.username || user?.email || 'Someone') || 'Someone';
}

export class ActivityLog {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   */
  constructor({ jiraClient }) {
    this.jiraClient = jiraClient;
  }

  /**
   * Record an entry, in the background.
   *
   * @param {object} entry
   * @param {string} [entry.assemblyKey]  The Assembly it's about (else found from `buildKey`)
   * @param {string} [entry.buildKey]     The Build it's about
   * @param {object} [entry.user]         Who (the request's signed-in user)
   * @param {string} entry.action         A short slug: 'save', 'cut', 'archive', …
   * @param {string} entry.text           What was done, in words; `{build}` becomes "Build 2 (HAR-5)"
   * @returns {Promise<void>}  Resolves when written (or given up); never rejects
   */
  record({ assemblyKey, buildKey, user, action, text }) {
    return (async () => {
      const build = buildKey && (!assemblyKey || String(text).includes('{build}')) ? await this._build(buildKey) : null;
      const key = assemblyKey ?? build?.assemblyKey ?? null;
      if (!key) return;
      const label = build?.number != null ? `Build ${build.number} (${buildKey})` : (buildKey ?? 'the Build');
      const words = String(text ?? '').split('{build}').map(plain).join(` ${label} `);
      await this.jiraClient.addComment(key, `${MARK} · ${action}\n${actorName(user)} · ${plain(words)}`);
    })().catch((err) => {
      console.warn('[activity] could not record', action, 'on', assemblyKey ?? buildKey, ':', err?.status, err?.message);
    });
  }

  /**
   * An Assembly's entries, newest first.
   * @param {string} assemblyKey
   * @param {{ limit?: number }} [options]
   * @returns {Promise<{ at: string, action: string, who: string, text: string }[]>}
   */
  async list(assemblyKey, { limit = 200 } = {}) {
    const comments = await this.jiraClient.getComments(assemblyKey);
    const out = [];
    for (const c of comments) {
      const m = ENTRY_RE.exec(String(c?.body ?? ''));
      if (m) out.push({ at: c.created ?? null, action: m[1], who: m[2].trim(), text: m[3].trim() });
    }
    out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return out.slice(0, limit);
  }

  /** A Build's Assembly and number. @private */
  async _build(buildKey) {
    const build = await this.jiraClient.getIssue(buildKey, { fields: [BuildField.ASSEMBLY_LINK, BuildField.BUILD_NUMBER] });
    return { assemblyKey: build?.fields?.[BuildField.ASSEMBLY_LINK] ?? null, number: build?.fields?.[BuildField.BUILD_NUMBER] ?? null };
  }
}
