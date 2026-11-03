import { useEffect, useState } from 'react';
import { Zoomable } from '../ui/ImageViewer.jsx';

/**
 * The Build's Assembly in isometric view. A cut Build shows the picture
 * taken when it was cut; a Draft shows OnShape as it is now (`refresh` makes
 * it draw again). Shows nothing when there is no picture.
 *
 * @param {object} props
 * @param {string} props.buildKey
 * @param {string} props.label    "Build 1", for the image's description
 * @param {number} [props.refresh]  Changes when a Draft should be drawn again
 */
export default function BuildImage({ buildKey, label, refresh }) {
  const [state, setState] = useState('loading');
  useEffect(() => { setState('loading'); }, [buildKey, refresh]);

  if (state === 'failed') return null;
  const query = refresh ? `?fresh=1&v=${refresh}` : '';
  return (
    <figure className={`build-image build-image-${state}`}>
      <Zoomable title={label} src={`/api/pictures/build/${encodeURIComponent(buildKey)}${query}`}>
        <img
          src={`/api/pictures/build/${encodeURIComponent(buildKey)}${query}`}
          alt={`${label}, isometric view`}
          onLoad={() => setState('ready')}
          onError={() => setState('failed')}
        />
      </Zoomable>
    </figure>
  );
}
