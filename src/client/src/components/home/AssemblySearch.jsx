/**
 * The Home search box and its "Include closed" toggle (design 3.1).
 * The parent owns the debounce, the request and the URL mirror.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(text: string) => void} props.onChange
 * @param {() => void} props.onClear       Esc or the × button
 * @param {boolean} props.includeClosed
 * @param {(on: boolean) => void} props.onIncludeClosedChange
 * @param {string} props.countText         Announced politely after each search
 */
export default function AssemblySearch({
  value, onChange, onClear, includeClosed, onIncludeClosedChange, countText,
}) {
  return (
    <section className="home-search" aria-labelledby="find-heading">
      <h1 id="find-heading" className="home-heading">
        <label htmlFor="assembly-search">Find an Assembly</label>
      </h1>
      <div className="search-row">
        <span className="search-icon" aria-hidden="true">🔍</span>
        <input
          id="assembly-search"
          type="search"
          className="text-input search-input"
          placeholder="Search Assemblies"
          // Home is a search page: the box is the first thing a student uses.
          autoFocus
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClear();
            }
          }}
        />
        {value && (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={onClear}>×</button>
        )}
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={includeClosed}
          onChange={(e) => onIncludeClosedChange(e.target.checked)}
        />
        Include closed
      </label>
      <p className="visually-hidden" role="status" aria-live="polite" data-testid="search-count">{countText}</p>
    </section>
  );
}
