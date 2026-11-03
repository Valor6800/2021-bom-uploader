import { useEffect, useState } from 'react';
import { fetchPurchasedParts } from '../../api/client.js';
import { COLUMN_COUNT } from './AssemblyPartRow.jsx';
import PartThumb from '../assembly-shared/PartThumb.jsx';

/**
 * The Build's off-the-shelf parts (vendor parts from other OnShape documents)
 * as a group at the end of the Parts table. They are read from the Build's
 * OnShape BOM; there is no Part for them in the tracker. Shows nothing when
 * there are none, or when the BOM can't be read.
 *
 * @param {object} props
 * @param {string} props.assemblyKey
 * @param {string} props.buildKey
 */
export default function PurchasedParts({ assemblyKey, buildKey }) {
  const [parts, setParts] = useState([]);

  useEffect(() => {
    let live = true;
    setParts([]);
    fetchPurchasedParts(assemblyKey, buildKey)
      .then((res) => { if (live) setParts(res.parts ?? []); })
      .catch(() => {});
    return () => { live = false; };
  }, [assemblyKey, buildKey]);

  if (parts.length === 0) return null;

  return (
    <tbody className="parts-group parts-group-bought">
      <tr className="group-row">
        <th scope="colgroup" colSpan={COLUMN_COUNT}>
          <span className="group-title">Off-the-shelf</span>
          <span className="group-count">{parts.length}</span>
        </th>
      </tr>
      {parts.map((part, i) => (
        <tr className="part-row" key={`${part.name}-${i}`}>
          <th scope="row" className="cell-part">
            <span className="part-cell">
              <PartThumb partKey={null} />
              <span>
                <span className="part-name">{part.name}</span>
                {part.partNumber && part.partNumber !== 'N/A' && !part.name.includes(part.partNumber) && (
                  <span className="mono-key part-number">{part.partNumber}</span>
                )}
              </span>
            </span>
          </th>
          <td className="cell-text">{part.quantity}</td>
          <td colSpan={COLUMN_COUNT - 2} />
        </tr>
      ))}
    </tbody>
  );
}
