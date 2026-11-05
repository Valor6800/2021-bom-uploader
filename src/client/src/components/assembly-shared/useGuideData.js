import { useCallback, useEffect, useState } from 'react';
import { fetchGuide, fetchPurchasedParts, lookupVendorParts } from '../../api/client.js';

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

/**
 * The Build's off-the-shelf parts and hardware (from its OnShape BOM).
 * `parts` is empty until loaded; `error` says why they couldn't be read
 * (the request failed, or the server couldn't read the BOM).
 *
 * @param {string} assemblyKey
 * @param {string|null} buildKey
 * @returns {{ parts: object[], loading: boolean, error: string|null, retry: () => void }}
 */
export function usePurchasedParts(assemblyKey, buildKey) {
  const [state, setState] = useState({ parts: [], loading: false, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    if (!assemblyKey || !buildKey) { setState({ parts: [], loading: false, error: null }); return undefined; }
    setState({ parts: [], loading: true, error: null });
    fetchPurchasedParts(assemblyKey, buildKey)
      .then((res) => { if (live) setState({ parts: res.parts ?? [], loading: false, error: res.error ?? null }); })
      .catch((err) => { if (live) setState({ parts: [], loading: false, error: err?.message || 'the request failed' }); });
    return () => { live = false; };
  }, [assemblyKey, buildKey, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
