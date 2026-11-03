import { useEffect, useState } from 'react';
import { fetchBoardColumns, fetchGuide, lookupVendorParts } from '../../api/client.js';

/** Board columns are the same for every page: read once per load. */
let columnsPromise = null;

/** `{ [statusId]: { board, column } }`, or {} until (or unless) it loads. */
export function useBoardColumns() {
  const [columns, setColumns] = useState({});
  useEffect(() => {
    let live = true;
    columnsPromise ??= fetchBoardColumns().catch(() => { columnsPromise = null; return { columns: {} }; });
    columnsPromise.then((res) => { if (live) setColumns(res.columns ?? {}); });
    return () => { live = false; };
  }, []);
  return columns;
}

/**
 * Order tickets and vendor listings for these SKUs, by SKU. Empty until
 * loaded; a failed lookup leaves it empty (the rows still show).
 *
 * @param {string[]} skus
 * @returns {Record<string, object>}
 */
export function useVendorInfo(skus) {
  const [info, setInfo] = useState({});
  const wanted = [...new Set(skus.filter(Boolean))].sort().join(',');
  useEffect(() => {
    let live = true;
    if (!wanted) { setInfo({}); return undefined; }
    lookupVendorParts(wanted.split(','))
      .then((res) => { if (live) setInfo(res.results ?? {}); })
      // Failed: each SKU is shown as known-unknown rather than "looking up" for ever.
      .catch(() => {
        if (live) setInfo(Object.fromEntries(wanted.split(',').map((sku) => [sku, { sku, orders: null, catalog: null, productUrl: null }])));
      });
    return () => { live = false; };
  }, [wanted]);
  return info;
}

/**
 * The Build's guide (steps and kits).
 * @param {string|null} buildKey
 * @returns {{ guide: object|null, error: Error|null, loading: boolean, retry: () => void }}
 */
export function useGuide(buildKey) {
  const [state, setState] = useState({ guide: null, error: null, loading: !!buildKey });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    if (!buildKey) { setState({ guide: null, error: null, loading: false }); return undefined; }
    setState({ guide: null, error: null, loading: true });
    fetchGuide(buildKey)
      .then((guide) => { if (live) setState({ guide, error: null, loading: false }); })
      .catch((error) => { if (live) setState({ guide: null, error, loading: false }); });
    return () => { live = false; };
  }, [buildKey, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
