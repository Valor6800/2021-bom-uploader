/**
 * A name used but never imported or declared builds fine and only fails in the
 * browser ("addSessionLinks is not defined"), and no other test loads the
 * React pages. This reads every client and server file and fails on one.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const GLOBALS = new Set([
  'window', 'document', 'console', 'fetch', 'URL', 'URLSearchParams', 'Promise', 'Map', 'Set', 'WeakMap', 'Array', 'Object',
  'Number', 'String', 'Boolean', 'JSON', 'Date', 'Math', 'Error', 'Symbol', 'RegExp', 'undefined', 'NaN', 'Infinity',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'structuredClone', 'globalThis',
  'localStorage', 'sessionStorage', 'navigator', 'location', 'history', 'FormData', 'Blob', 'AbortController', 'Intl',
  'isNaN', 'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'requestAnimationFrame',
  'cancelAnimationFrame', 'Event', 'HTMLElement', 'Node', 'getComputedStyle', 'matchMedia', 'Image', 'atob', 'btoa',
  'process', 'Buffer', 'Response', 'Request', 'Headers',
]);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(jsx?|mjs)$/.test(name) ? [path] : [];
  });
}

function undefinedNames(source) {
  const found = [];
  traverse(parse(source, { sourceType: 'module', plugins: ['jsx'] }), {
    ReferencedIdentifier(path) {
      const { name } = path.node;
      if (path.node.type === 'JSXIdentifier' && /^[a-z]/.test(name)) return; // an HTML tag
      if (!path.scope.hasBinding(name) && !GLOBALS.has(name)) found.push(`${name} (line ${path.node.loc.start.line})`);
    },
  });
  return found;
}

describe('no file uses a name it never defines', () => {
  it('sees an unimported name', () => {
    expect(undefinedNames("import { a } from 'x';\nexport const f = () => a(b);")).toEqual(['b (line 2)']);
    expect(undefinedNames('export const C = () => <Missing />;')).toEqual(['Missing (line 1)']);
  });

  it.each([...files('src/client/src'), ...files('src/server')])('%s', (file) => {
    expect(undefinedNames(readFileSync(file, 'utf8'))).toEqual([]);
  });
});
