import { hardwarePictureUrl, vendorImageUrl } from '../../api/client.js';
import { COLUMN_COUNT } from './AssemblyPartRow.jsx';
import PartThumb from '../assembly-shared/PartThumb.jsx';
import Button from '../ui/Button.jsx';
import VendorInfo from '../assembly-shared/VendorInfo.jsx';
import { usePurchasedParts, useVendorInfo } from '../assembly-shared/useGuideData.js';

/**
 * The Build's off-the-shelf parts (vendor parts and standard hardware from
 * other OnShape documents) as groups at the end of the Parts table. They are
 * read from the Build's OnShape BOM; there is no Part for them in the
 * tracker. Vendor rows show their order ticket and the vendor's listing.
 * While the BOM is read it says so; when it can't be read it says why, with
 * a Retry. Shows nothing when there are none.
 *
 * @param {object} props
 * @param {string} props.assemblyKey
 * @param {string} props.buildKey
 */
export default function PurchasedParts({ assemblyKey, buildKey }) {
  const { parts, loading, error, retry } = usePurchasedParts(assemblyKey, buildKey);

  const info = useVendorInfo(parts.map((p) => p.sku));

  // Reading the Build's BOM from OnShape can take a few seconds the first time: say so.
  if (loading || (error && parts.length === 0)) {
    return (
      <tbody className="parts-group parts-group-bought">
        <tr className="group-row">
          <th scope="colgroup" colSpan={COLUMN_COUNT}><span className="group-title">Off-the-shelf</span></th>
        </tr>
        <tr>
          <td colSpan={COLUMN_COUNT} className="table-empty" role="status">
            {loading ? 'Reading the off-the-shelf parts and hardware from OnShape…' : (
              <>
                Couldn&apos;t read the off-the-shelf parts from OnShape ({error}).{' '}
                <Button variant="secondary" onClick={retry}>Retry</Button>
              </>
            )}
          </td>
        </tr>
      </tbody>
    );
  }
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
        // The vendor's picture when it has one; else the tool's drawing of a screw, spacer or bearing.
        const vendorPicture = found?.catalog?.hasImage;
        // The row's own name first, else an order that describes the hardware (McMaster).
        const drawing = part.hardware ?? found?.drawing ?? null;
        return (
          <tr className="part-row" key={`${part.name}-${i}`}>
            <th scope="row" className="cell-part">
              <span className="part-cell">
                <PartThumb
                  partKey={null}
                  src={vendorPicture ? vendorImageUrl(part.sku) : hardwarePictureUrl(drawing)}
                  largeSrc={vendorPicture ? vendorImageUrl(part.sku, { large: true }) : hardwarePictureUrl(drawing, { large: true })}
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
