import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchEpicByKey, fetchRevisionChain, fetchChainParts, fetchBuildsForAssembly,
  fetchBuildParts, fetchPartsByKeys,
} from '../../api/client.js';
import { mergeBuilds, visibleBuilds } from '../../lib/buildNames.js';
import { linksFromBuildParts } from '../../lib/designerRows.js';

/** What each secondary load is called in "Couldn't load …" copy. */
const LOAD_LABELS = {
  chain: 'the Revisions',
  parts: 'the Parts',
  builds: 'the Builds',
  buildParts: 'the Parts in each Build',
};

/**
 * Loads one Assembly page (design 3.4 load steps 1 and 1b): the Assembly,
 * its Revision chain, the chain's Parts, the chain's Builds, each displayed
 * Build's linked Part keys, and any linked Part that isn't a chain Part.
 *
 * Shared by the Designer and Assembly pages; each page keeps its own copy
 * of this state (no Zustand), so the two never interfere.
 *
 * @param {string} key  The Assembly (Revision) ticket in the URL
 * @param {{ extraBuilds?: object[] }} [options]  Builds this session knows
 *   about that search may not list yet (onboarding's Build 1, a new Build)
 */
export function useAssemblyData(key, { extraBuilds = [] } = {}) {
  const [assembly, setAssembly] = useState(null);
  const [assemblyError, setAssemblyError] = useState(null);
  const [chain, setChain] = useState([key]);
  const [revisions, setRevisions] = useState([]);
  const [parts, setParts] = useState([]);
  const [fetchedBuilds, setFetchedBuilds] = useState([]);
  const [buildParts, setBuildParts] = useState(new Map());
  const [errors, setErrors] = useState({});
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const gen = useRef(0);
  const chainRef = useRef([key]);
  const chainPartsRef = useRef([]);
  const lastBuildsRef = useRef([]);
  const lastBuildPartsRef = useRef(new Map());
  const extraRef = useRef(extraBuilds);
  extraRef.current = extraBuilds;

  /**
   * Builds, their links, and linked Parts outside the chain. A failed read
   * keeps the last good list (empty on the first load), so a refresh that
   * fails doesn't wipe Builds the page is showing.
   */
  const loadBuildsAndLinks = useCallback(async (myGen, chainKeys, chainParts, errs) => {
    let builds = lastBuildsRef.current;
    try {
      builds = await fetchBuildsForAssembly(key, chainKeys);
      lastBuildsRef.current = builds;
    } catch (err) {
      errs.builds = err;
    }
    if (myGen !== gen.current) return;
    setFetchedBuilds(builds);

    const shown = visibleBuilds(mergeBuilds(builds, extraRef.current), key);
    let perBuild = new Map();
    try {
      const lists = await Promise.all(shown.map((b) => fetchBuildParts(b.key)));
      shown.forEach((b, i) => perBuild.set(b.key, lists[i] ?? []));
      lastBuildPartsRef.current = perBuild;
    } catch (err) {
      errs.buildParts = err;
      perBuild = lastBuildPartsRef.current;
    }
    if (myGen !== gen.current) return;

    const known = new Set(chainParts.map((p) => p.key));
    const missing = [...new Set([...perBuild.values()].flat())].filter((k) => !known.has(k));
    let extra = [];
    if (missing.length) {
      try {
        extra = await fetchPartsByKeys(missing);
      } catch (err) {
        errs.buildParts = errs.buildParts ?? err;
      }
    }
    if (myGen !== gen.current) return;
    setBuildParts(perBuild);
    setParts([...chainParts, ...extra.filter((p) => !known.has(p.key))]);
  }, [key]);

  const loadAll = useCallback(async () => {
    const myGen = ++gen.current;
    setLoading(true);
    setReady(false);
    setErrors({});
    const errs = {};

    const [, chainKeys, chainParts] = await Promise.all([
      fetchEpicByKey(key)
        .then((a) => { if (myGen === gen.current) { setAssembly(a); setAssemblyError(null); } })
        .catch((err) => { if (myGen === gen.current) setAssemblyError(err); }),
      fetchRevisionChain(key).catch((err) => { errs.chain = err; return null; }),
      fetchChainParts(key).catch((err) => { errs.parts = err; return null; }),
    ]);
    if (myGen !== gen.current) return;

    const keys = Array.isArray(chainKeys) && chainKeys.length ? chainKeys : [key];
    chainRef.current = keys;
    chainPartsRef.current = chainParts ?? [];
    setChain(keys);
    if (chainKeys) await loadBuildsAndLinks(myGen, keys, chainParts ?? [], errs);
    if (myGen !== gen.current) return;
    setErrors(errs);
    setReady(true);
    setLoading(false);
  }, [key, loadBuildsAndLinks]);

  /** Re-read chain Parts, Builds and links (after a save or a Build change). */
  const refresh = useCallback(async () => {
    const myGen = ++gen.current;
    const errs = {};
    let chainParts = chainPartsRef.current;
    try {
      chainParts = await fetchChainParts(key);
      chainPartsRef.current = chainParts;
    } catch (err) {
      errs.parts = err;
    }
    if (myGen !== gen.current) return;
    await loadBuildsAndLinks(myGen, chainRef.current, chainParts, errs);
    if (myGen !== gen.current) return;
    setErrors(errs);
  }, [key, loadBuildsAndLinks]);

  useEffect(() => {
    setAssembly(null);
    setAssemblyError(null);
    setChain([key]);
    setRevisions([]);
    setParts([]);
    setFetchedBuilds([]);
    setBuildParts(new Map());
    lastBuildsRef.current = [];
    lastBuildPartsRef.current = new Map();
    loadAll();
  }, [key, loadAll]);

  // Revision select labels, only when there is more than one ticket.
  useEffect(() => {
    if (chain.length <= 1) {
      setRevisions([]);
      return undefined;
    }
    let live = true;
    Promise.all(chain.map((k) => fetchEpicByKey(k).catch(() => ({ key: k, revision: null }))))
      .then((list) => { if (live) setRevisions(list); });
    return () => { live = false; };
  }, [chain]);

  const linkedByPart = useMemo(() => linksFromBuildParts(buildParts), [buildParts]);

  const secondaryError = useMemo(() => {
    const which = ['chain', 'parts', 'builds', 'buildParts'].find((k) => errors[k]);
    return which ? { what: LOAD_LABELS[which], err: errors[which] } : null;
  }, [errors]);

  return {
    assembly,
    assemblyError,
    chain,
    revisions,
    parts,
    fetchedBuilds,
    buildParts,
    linkedByPart,
    secondaryError,
    ready,
    loading,
    reloadAll: loadAll,
    refresh,
  };
}
