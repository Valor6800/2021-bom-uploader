import { describeSubAssembly } from '../../lib/subAssemblies.js';

/**
 * What happens to each sub-assembly found in the pasted assembly, one line
 * each. Used in the confirm and "already here" dialogs (preview) and in the
 * result message (after creating).
 *
 * @param {object} props
 * @param {object[]} props.subAssemblies
 * @param {string|null} [props.error]  Set when the sub-assemblies could not be read at all
 * @param {boolean} [props.preview]
 */
export default function SubAssemblyList({ subAssemblies, error = null, preview = false }) {
  if (error) {
    return (
      <p className="text-muted" role="status">
        Sub-assemblies couldn&apos;t be read ({error}). Only this assembly will be added.
      </p>
    );
  }
  if (!subAssemblies?.length) return null;
  return (
    <div className="onboard-subs">
      <p className="onboard-subs-title">
        {subAssemblies.length === 1 ? '1 sub-assembly' : `${subAssemblies.length} sub-assemblies`} in this assembly
      </p>
      <ul className="onboard-problems">
        {subAssemblies.map((sub, i) => (
          <li key={`${sub.name}-${i}`} data-sub-status={sub.status}>
            {describeSubAssembly(sub, { preview })}
          </li>
        ))}
      </ul>
    </div>
  );
}
