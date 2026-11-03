import { useEffect, useState } from 'react';
import { fetchPurchasedParts, vendorImageUrl } from '../../api/client.js';
import { COLUMN_COUNT } from './AssemblyPartRow.jsx';
import PartThumb from '../assembly-shared/PartThumb.jsx';
import VendorInfo from '../assembly-shared/VendorInfo.jsx';
import { useVendorInfo } from '../assembly-shared/useGuideData.js';

/**
 * The Build's off-the-shelf parts (vendor parts and standard hardware from
 * other OnShape documents) as groups at the end of the Parts table. They are
 * read from the Build's OnShape BOM; there is no Part for them in the
 * tracker. Vendor rows show their order ticket and the vendor's listing.
 * Shows nothing when there are none, or when the BOM can't be read.
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

  const info = useVendorInfo(parts.map((p) => p.sku));

  if (parts.length === 0) return null;
  const hardware = parts.filter((p) => p.standard);
  const vendor = parts.filter((p) => !p.standard);

  const group = (title, rows, className) => rows.length > 0 && (
    <tbody className={`parts-group ${className}`}>
      <tr className="group-row">
        <th scope="colgroup" colSpan={COLUMN_COUNT}>
          <span className="group-title">{title}</span>
          <span className="group-count">{rows.length}</span>
        </th>
      </tr>
      {rows.map((part, i) => {
        const found = part.sku ? info[part.sku] : null;
        return (
          <tr className="part-row" key={`${part.name}-${i}`}>
            <th scope="row" className="cell-part">
              <span className="part-cell">
                <PartThumb
                  partKey={null}
                  src={found?.catalog?.hasImage ? vendorImageUrl(part.sku) : null}
                  largeSrc={found?.catalog?.hasImage ? vendorImageUrl(part.sku, { large: true }) : null}
                  title={part.name}
                />
                <span>
                  <span className="part-name">{part.name}</span>
                  {part.partNumber && part.partNumber !== 'N/A' && !part.name.includes(part.partNumber) && (
                    <span className="mono-key part-number">{part.partNumber}</span>
                  )}
                </span>
              </span>
            </th>
            <td className="cell-text" data-label="Qty">{part.quantity}</td>
            <td colSpan={COLUMN_COUNT - 2} className="cell-vendor">
              {part.standard && !part.sku
                ? <span className="status-text">Standard hardware: count it into the kit</span>
                : <VendorInfo sku={part.sku} info={found ?? undefined} vendor={part.vendor} need={part.quantity} />}
            </td>
          </tr>
        );
      })}
    </tbody>
  );

  return (
    <>
      {group('Off-the-shelf', vendor, 'parts-group-bought')}
      {group('Hardware', hardware, 'parts-group-bought parts-group-hardware')}
    </>
  );
}
