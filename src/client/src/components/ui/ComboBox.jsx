/**
 * Filterable single-select — a text input that narrows a long option list as
 * you type, rather than a native select you have to scroll.
 *
 * Built for the Wish-List picker, where there are too many options (and they
 * are too wordy) to hunt through a dropdown. Keeps the option's value rather
 * than its label, so callers still get an id back.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

const NONE_LABEL = '— none —';

export default function ComboBox({
  value,
  options,
  onChange,
  placeholder = 'Type to search…',
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef(null);

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  // Keep the highlight inside the filtered list as it shrinks.
  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  // Close when focus or a click lands outside.
  useEffect(() => {
    if (!open) return undefined;

    const onDocumentPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener('mousedown', onDocumentPointerDown);
    return () => document.removeEventListener('mousedown', onDocumentPointerDown);
  }, [open]);

  function commit(nextValue) {
    onChange(nextValue);
    setQuery('');
    setOpen(false);
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      if (!open) return;
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) commit(option.value);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setQuery('');
      setOpen(false);
      return;
    }

    // Backspace on an untouched field clears the current choice.
    if (event.key === 'Backspace' && !query && selected) {
      commit(null);
    }
  }

  return (
    <div className={`combobox ${className}`} ref={containerRef}>
      <input
        type="text"
        className="combobox-input"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        disabled={disabled}
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : (selected?.label ?? '')}
        title={selected?.label ?? ''}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />

      {open && (
        <ul className="combobox-list" role="listbox">
          <li
            role="option"
            aria-selected={value === null || value === undefined}
            className={`combobox-option combobox-option-none${activeIndex === -1 ? ' combobox-option-active' : ''}`}
            // preventDefault keeps the input from blurring before the click lands.
            onMouseDown={(event) => {
              event.preventDefault();
              commit(null);
            }}
          >
            {NONE_LABEL}
          </li>

          {filtered.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`combobox-option${index === activeIndex ? ' combobox-option-active' : ''}${
                option.value === value ? ' combobox-option-selected' : ''
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                commit(option.value);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {option.label}
            </li>
          ))}

          {filtered.length === 0 && (
            <li className="combobox-empty">No match for “{query}”</li>
          )}
        </ul>
      )}
    </div>
  );
}
