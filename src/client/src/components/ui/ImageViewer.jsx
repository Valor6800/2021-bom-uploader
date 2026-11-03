import {
  createContext, useCallback, useContext, useMemo, useState,
} from 'react';
import Dialog from './Dialog.jsx';

const ViewerContext = createContext(null);

/**
 * One picture viewer for the whole app: any picture can open itself large in
 * a modal (Esc, the × button or a click outside closes it).
 */
export function ImageViewerProvider({ children }) {
  const [shown, setShown] = useState(null); // { src, title }
  const [loaded, setLoaded] = useState(false);
  const open = useCallback((picture) => { setLoaded(false); setShown(picture); }, []);
  const close = useCallback(() => setShown(null), []);
  const value = useMemo(() => ({ open }), [open]);

  return (
    <ViewerContext.Provider value={value}>
      {children}
      <Dialog open={!!shown} onClose={close} title={shown?.title ?? 'Picture'} className="dialog-image">
        {shown && (
          <figure className={`image-viewer${loaded ? '' : ' image-viewer-loading'}`}>
            {!loaded && <span className="image-viewer-wait" role="status">Loading the picture…</span>}
            <img src={shown.src} alt={shown.title ?? ''} onLoad={() => setLoaded(true)} />
          </figure>
        )}
      </Dialog>
    </ViewerContext.Provider>
  );
}

/**
 * A picture that opens large when clicked. Renders a plain image when there is
 * no viewer above it (e.g. in a test).
 *
 * @param {object} props
 * @param {string} props.title      What the picture shows; the modal's title and the button's name
 * @param {string} [props.largeSrc] A bigger version to show in the modal (defaults to the picture itself)
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children  The <img>
 */
export function Zoomable({ title, largeSrc, src, className = '', children }) {
  const viewer = useContext(ViewerContext);
  if (!viewer) return children;
  return (
    <button
      type="button"
      className={`zoomable ${className}`}
      onClick={() => viewer.open({ src: largeSrc ?? src, title })}
      aria-label={`Enlarge: ${title}`}
      title="Click to enlarge"
    >
      {children}
    </button>
  );
}
