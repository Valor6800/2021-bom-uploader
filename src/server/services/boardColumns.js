/**
 * Board columns — which tracker board column each Part status sits in.
 *
 * Parts move across two kanban boards of the Parts project (Manufacturing,
 * then Assembly). A status name alone ("Mentor Approved") doesn't say which
 * column the mentor sees it in ("Assembly · To Do"), so the boards' own
 * column configuration is read and kept for a while. Read-only.
 */

const TTL_MS = 10 * 60 * 1000;

export class BoardColumns {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   * @param {string} [deps.projectKey]  Defaults to PROJECT_KEY
   */
  constructor({ jiraClient, projectKey }) {
    this.jiraClient = jiraClient;
    this.projectKey = projectKey ?? process.env.PROJECT_KEY;
    this._cached = null;
  }

  /**
   * @returns {Promise<{ columns: Record<string, { board: string, column: string, boardIndex: number, columnIndex: number }> }>}
   *   Keyed by status id. A status on no board is left out.
   */
  async get() {
    if (this._cached && Date.now() - this._cached.at < TTL_MS) return this._cached.promise;
    const promise = this._read();
    this._cached = { at: Date.now(), promise };
    promise.catch(() => { this._cached = null; });
    return promise;
  }

  async _read() {
    const send = (url) => this.jiraClient.client.sendRequest({ url, method: 'GET' });
    const project = encodeURIComponent(this.projectKey ?? '');
    const boards = (await send(`/rest/agile/1.0/board?projectKeyOrId=${project}`))?.values ?? [];
    const configs = await Promise.all(boards.map((b) => send(`/rest/agile/1.0/board/${encodeURIComponent(b.id)}/configuration`)
      .then((cfg) => ({ board: b, cfg }))
      .catch(() => null)));

    // Display only: the client orders the stages by its own rules (lib/partStage.js).
    // A status on two boards keeps the first board's column.
    const columns = {};
    configs.filter(Boolean).forEach(({ board, cfg }, boardIndex) => {
      (cfg?.columnConfig?.columns ?? []).forEach((col, columnIndex) => {
        for (const s of col.statuses ?? []) {
          if (!columns[s.id]) columns[s.id] = { board: board.name, column: col.name, boardIndex, columnIndex };
        }
      });
    });
    return { columns };
  }
}
