/**
 * Keeps the Parts Order page's row choices saved on the server and in step with
 * what other mentors are doing.
 *
 * A change shows at once and is saved behind it. Saves run one at a time, so a
 * quick tick-then-untick can't land in the wrong order. The server's copy is
 * fetched on a timer, which is how another mentor's change arrives, and is
 * skipped whenever it could overwrite something newer here:
 *   - while a save is under way, or one started during the fetch;
 *   - during a submission, because the order must not change between the preview
 *     the mentor confirmed and what gets written to the sheet.
 *
 * If a save fails, the next fetch puts the row back to what the server holds, so
 * the page never goes on showing a change nobody else can see.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/index.js';
import { fetchOrderDraft, saveOrderDraft } from '../../api/client.js';

const POLL_MS = 10_000;

const submitting = () => useAppStore.getState().submitPhase !== 'idle';

/**
 * @param {object} params
 * @param {boolean} params.enabled  Whether the queue has loaded
 * @param {(err: Error) => void} params.onAuthRequired  The session has run out
 * @returns {{ saveDraft: (rows: object[]) => void, saveError: string|null }}
 */
export function useOrderDraft({ enabled, onAuthRequired }) {
  const applyDraft = useAppStore((s) => s.applyDraft);
  const [saveError, setSaveError] = useState(null);

  const lastSave = useRef(Promise.resolve());
  const saves = useRef({ running: 0, started: 0 });

  const saveDraft = useCallback((rows) => {
    if (rows.length === 0) return;

    saves.current.running += 1;
    saves.current.started += 1;

    lastSave.current = lastSave.current
      .then(() => saveOrderDraft(rows))
      .then(() => setSaveError(null))
      .catch((err) => {
        if (err.authRequired) onAuthRequired(err);
        else setSaveError(err.message);
      })
      .finally(() => {
        saves.current.running -= 1;
      });
  }, [onAuthRequired]);

  useEffect(() => {
    if (!enabled) return undefined;

    const refresh = async () => {
      if (document.hidden || saves.current.running > 0 || submitting()) return;

      const startedBefore = saves.current.started;
      try {
        const { rows } = await fetchOrderDraft();
        if (saves.current.started === startedBefore && !submitting()) applyDraft(rows);
      } catch {
        // Missed one; the next tick tries again. An expired session shows up as
        // soon as the mentor next does something.
      }
    };

    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, applyDraft]);

  return { saveDraft, saveError };
}
