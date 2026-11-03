import { useEffect, useState } from 'react';

/**
 * A Part's picture, small, for the table. The picture is the PNG attached to
 * the Part's ticket; a Part that has none (or isn't made yet) leaves a blank
 * of the same size so the rows line up.
 *
 * @param {object} props
 * @param {string|null} props.partKey  The ticket whose picture to show
 * @param {number} [props.refresh]       Changes when pictures may have arrived: try again
 */
export default function PartThumb({ partKey, refresh }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [partKey, refresh]);

  if (!partKey || failed) return <span className="part-thumb part-thumb-empty" aria-hidden="true" />;
  return (
    <img
      className="part-thumb"
      src={`/api/pictures/part/${encodeURIComponent(partKey)}${refresh ? `?v=${refresh}` : ''}`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
