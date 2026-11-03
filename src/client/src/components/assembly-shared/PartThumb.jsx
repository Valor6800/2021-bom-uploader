import { useEffect, useState } from 'react';
import { Zoomable } from '../ui/ImageViewer.jsx';

/**
 * A Part's picture, small, for the table. The picture is the PNG attached to
 * the Part's ticket; a Part that has none (or isn't made yet) leaves a blank
 * of the same size so the rows line up.
 *
 * @param {object} props
 * @param {string|null} props.partKey  The ticket whose picture to show
 * @param {number} [props.refresh]       Changes when pictures may have arrived: try again
 * @param {string|null} [props.src]       Another picture to show instead (a vendor's, OnShape's)
 * @param {string} [props.title]          What it shows, for the enlarged view
 * @param {string|null} [props.largeSrc]  A bigger version for the enlarged view
 */
export default function PartThumb({ partKey, refresh, src, title, largeSrc }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [partKey, refresh, src]);

  if ((!partKey && !src) || failed) return <span className="part-thumb part-thumb-empty" aria-hidden="true" />;
  const url = src ?? `/api/pictures/part/${encodeURIComponent(partKey)}${refresh ? `?v=${refresh}` : ''}`;
  return (
    <Zoomable title={title ?? 'Part picture'} src={url} largeSrc={largeSrc ?? undefined} className="zoomable-thumb">
      <img
        className="part-thumb"
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </Zoomable>
  );
}
