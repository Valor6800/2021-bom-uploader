/**
 * One mentor-approved line in the submit queue.
 *
 * Classification is per-row because nothing in Jira carries it and it drives
 * every budget roll-up in the spreadsheet. Wish ID is optional and attaches
 * the line to a Wish-List budget bucket.
 */

import { useMemo } from 'react';
import FlagChips from './FlagChips.jsx';
import ComboBox from '../ui/ComboBox.jsx';
import { lineTotal, usd } from '../../lib/purchasingMath.js';

export default function QueueRow({
  line,
  selection,
  classifications,
  wishList,
  jiraBaseUrl,
  onChange,
}) {
  const total = lineTotal(line);
  const selected = Boolean(selection?.selected);

  const wishOptions = useMemo(
    () => wishList.map((bucket) => ({ value: bucket.wishId, label: bucket.item })),
    [wishList],
  );

  return (
    <tr className={line.blocked ? 'queue-row queue-row-blocked' : 'queue-row'}>
      <td className="cell-check">
        <input
          type="checkbox"
          checked={selected}
          disabled={line.blocked}
          title={line.blocked ? 'Fix the blocking problem in Jira first' : undefined}
          onChange={(e) => onChange(line.key, { selected: e.target.checked })}
        />
      </td>

      <td className="cell-key">
        {jiraBaseUrl ? (
          <a
            href={`${jiraBaseUrl}/browse/${line.key}`}
            target="_blank"
            rel="noreferrer"
            className="link-gold"
          >
            {line.key}
          </a>
        ) : (
          line.key
        )}
      </td>

      <td className="cell-summary">
        {line.link ? (
          <a href={line.link} target="_blank" rel="noreferrer" title={line.summary}>
            {line.summary}
          </a>
        ) : (
          <span title={line.summary}>{line.summary}</span>
        )}
        <FlagChips flags={line.flags} />
      </td>

      <td className="cell-partnum" title={line.partNumber || ''}>
        {line.partNumber || '—'}
      </td>

      <td className="cell-num">{Number.isFinite(line.qty) ? line.qty : '—'}</td>
      <td className="cell-num">{usd(line.price)}</td>
      <td className="cell-num cell-total">{usd(total)}</td>

      <td className="cell-select">
        <select
          className="select-inline"
          value={selection?.classification ?? ''}
          disabled={line.blocked}
          onChange={(e) => onChange(line.key, { classification: e.target.value })}
        >
          {classifications.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </td>

      <td className="cell-select cell-combo">
        {/* Typable: 31 wordy buckets are faster to filter than to scroll.
            Names only; the budget panel's Wish-List tab carries the amounts. */}
        <ComboBox
          value={selection?.wishId ?? null}
          options={wishOptions}
          disabled={line.blocked}
          placeholder="Wish-List…"
          onChange={(wishId) => onChange(line.key, { wishId })}
        />
      </td>

      <td className="cell-requester" title={line.requestedBy?.name || ''}>
        {line.requestedBy?.displayName || '—'}
      </td>
    </tr>
  );
}
