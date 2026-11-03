import { TrackerKey } from './AssemblyHeader.jsx';

const money = (n) => (typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)}` : null);

/** Order status in words a mentor scans for: has it arrived? */
const ORDER_TONE = {
  Delivered: 'stage-assembled',
  Ordered: 'stage-finishing',
  'Sent to VFF': 'stage-finishing',
  Approved: 'stage-making',
  New: 'stage-not-started',
  'Request for Purchase': 'stage-not-started',
};

/**
 * What the team knows about an off-the-shelf part: its latest order ticket
 * (status, quantity) and the vendor's listing (title, price, stock, link).
 *
 * @param {object} props
 * @param {string|null} props.sku
 * @param {object|undefined} props.info   One result from GET /api/vendor/lookup
 * @param {string|null} [props.vendor]    The BOM's vendor, when there is no lookup
 * @param {number} [props.need]           How many this Build needs, to compare with what was ordered
 */
export default function VendorInfo({ sku, info, vendor, need }) {
  if (!sku) {
    return vendor ? <span className="status-text">{vendor}</span> : <span className="status-text">No vendor part number</span>;
  }
  if (!info) return <span className="status-text">{vendor ? `${vendor} · ` : ''}Looking up {sku}…</span>;

  const latest = info.orders?.[0] ?? null;
  const ordered = (info.orders ?? []).reduce((sum, o) => sum + (Number(o.quantity) || 0), 0);
  const catalog = info.catalog;

  return (
    <span className="vendor-info">
      <span className="vendor-line">
        {latest ? (
          <>
            <span className={`stage-chip ${ORDER_TONE[latest.status] ?? 'stage-unknown'}`}>{latest.status ?? 'Ordered'}</span>
            <TrackerKey issueKey={latest.key} />
            {info.orders.length > 1 && (
              <span className="status-text">{info.orders.length} orders, {ordered} total</span>
            )}
            {info.orders.length === 1 && latest.quantity != null && (
              <span className="status-text">qty {latest.quantity}</span>
            )}
          </>
        ) : (
          <span className="stage-chip stage-unknown">{info.orders ? 'Never ordered' : 'Orders unavailable'}</span>
        )}
        {need != null && latest && ordered > 0 && ordered < need && (
          <span className="status-detail">Build needs {need}; {ordered} ordered</span>
        )}
      </span>
      <span className="vendor-line">
        {info.productUrl ? (
          <a href={info.productUrl} target="_blank" rel="noopener noreferrer" className="link-plain">
            {info.vendor ?? vendor ?? 'Vendor'} {sku} <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span className="mono-key">{sku}</span>
        )}
        {catalog?.title && <span className="vendor-title">{catalog.title}</span>}
        {money(catalog?.price ?? latest?.price) && <span className="status-text">{money(catalog?.price ?? latest?.price)}</span>}
        {catalog?.available === false && <span className="status-detail">Out of stock at vendor</span>}
      </span>
    </span>
  );
}
