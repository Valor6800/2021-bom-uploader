import { useState } from 'react';
import { Link } from 'react-router-dom';
import { guideImageUrl, vendorImageUrl } from '../../api/client.js';
import { friendlyClause } from '../../lib/friendlyError.js';
import { Stage, stageOf } from '../../lib/partStage.js';
import Alert from '../ui/Alert.jsx';
import { Zoomable } from '../ui/ImageViewer.jsx';
import Button from '../ui/Button.jsx';
import BuildImage from '../assembly-shared/BuildImage.jsx';
import PartThumb from '../assembly-shared/PartThumb.jsx';
import StageChip from '../assembly-shared/StageChip.jsx';
import VendorInfo from '../assembly-shared/VendorInfo.jsx';
import { TrackerKey } from '../assembly-shared/AssemblyHeader.jsx';
import { useVendorInfo } from '../assembly-shared/useGuideData.js';
import BuildReadiness from './BuildReadiness.jsx';

/** Lines in the order a student gathers them: what was built before, then Parts, then bought parts and hardware. */
const KIND_ORDER = { step: 0, assembly: 1, made: 2, vendor: 3, hardware: 4 };
const byKind = (a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || a.name.localeCompare(b.name);

/** A step's own picture: the sub-assembly from OnShape; the last step is the whole Build. */
function StepImage({ buildKey, step, buildName }) {
  const [failed, setFailed] = useState(false);
  if (step.id === 'root') return <BuildImage buildKey={buildKey} label={buildName} />;
  if (!step.hasImage || failed) return null;
  return (
    <figure className="build-image guide-step-image">
      <Zoomable title={step.name} largeSrc={guideImageUrl(buildKey, step.id, { large: true })}>
        <img src={guideImageUrl(buildKey, step.id)} alt={`${step.name}, isometric view`} loading="lazy" onError={() => setFailed(true)} />
      </Zoomable>
    </figure>
  );
}

function LineThumb({ buildKey, line, part, vendor }) {
  const title = [part?.fullPartNumber, line.name].filter(Boolean).join(' ');
  if (line.kind === 'made') return <PartThumb partKey={part?.imageKey ?? part?.key ?? null} title={title} />;
  if (vendor?.catalog?.hasImage) {
    return <PartThumb partKey={null} src={vendorImageUrl(line.sku)} largeSrc={vendorImageUrl(line.sku, { large: true })} title={title} />;
  }
  return (
    <PartThumb
      partKey={null}
      src={line.imageId ? guideImageUrl(buildKey, line.imageId) : null}
      largeSrc={line.imageId ? guideImageUrl(buildKey, line.imageId, { large: true }) : null}
      title={title}
    />
  );
}

function LineWhat({ line, part, stepsById }) {
  switch (line.kind) {
    case 'step': {
      const from = stepsById.get(line.stepId);
      return (
        <>
          <span className="part-name">{line.name}</span>
          {from && <a className="link-plain guide-from" href={`#guide-step-${from.number}`}>Built in step {from.number}</a>}
        </>
      );
    }
    case 'assembly':
      return (
        <>
          <span className="part-name">{line.name}</span>
          <span className="status-text">Assembly {line.number} is built on its own page (see Sub-assemblies above)</span>
        </>
      );
    case 'made':
      return (
        <>
          {part && <span className="part-key"><TrackerKey issueKey={part.key} /></span>}
          <span className="mono-key part-number">{part?.fullPartNumber ?? line.number ?? ''}</span>
          <span className="part-name">{line.name}</span>
        </>
      );
    default:
      return (
        <>
          <span className="part-name">{line.name}</span>
          {line.kind === 'hardware' && line.material && <span className="status-text">{line.material}</span>}
        </>
      );
  }
}

function LineStatus({ line, part, vendor, columns }) {
  if (line.kind === 'made') {
    if (!part) return <span className="status-detail">No Part ticket for {line.number ? `number ${line.number}` : 'this part'} yet</span>;
    return <StageChip status={part.status} statusId={part.statusId} columns={columns} />;
  }
  if (line.kind === 'vendor') return <VendorInfo sku={line.sku} info={vendor} vendor={line.vendor} need={line.total} />;
  if (line.kind === 'hardware') {
    return line.sku
      ? <VendorInfo sku={line.sku} info={vendor} vendor={line.vendor} need={line.total} />
      : <span className="status-text">Standard hardware: in the kit</span>;
  }
  return null;
}

/**
 * Build guide (`?view=guide`): the Build's steps, deepest sub-assembly first,
 * each with its picture, how many to build, and everything one needs: Parts
 * (with where they are in manufacturing), what earlier steps built, vendor
 * parts and hardware. Made from the Build's OnShape BOM; nothing to author.
 *
 * @param {object} props
 * @param {object} props.build
 * @param {string} props.buildName
 * @param {{ guide: object|null, error: Error|null, loading: boolean, retry: Function }} props.guideState
 * @param {Map<string, object>} props.partsByNumber  4-digit number -> the Build's Part
 * @param {object[]} props.buildParts  The Build's Parts, for the readiness summary
 * @param {object} props.columns
 * @param {string} props.backTo
 * @param {string} props.kitTo
 */
export default function BuildGuide({
  build, buildName, guideState, partsByNumber, buildParts, columns, backTo, kitTo,
}) {
  const { guide, error, loading, retry } = guideState;
  const lines = guide?.steps.flatMap((s) => s.lines) ?? [];
  const vendorInfo = useVendorInfo(lines.filter((l) => l.sku).map((l) => l.sku));

  const actions = (
    <div className="print-view-actions no-print">
      <Link to={backTo} className="btn btn-secondary"><span aria-hidden="true">← </span>Back to BOM</Link>
      <Link to={kitTo} className="btn btn-primary"><span aria-hidden="true">🧰 </span>Kit sheet</Link>
    </div>
  );

  if (loading) return <>{actions}<p className="page-loading" role="status">Reading {buildName} from OnShape…</p></>;
  if (error) {
    return (
      <>
        {actions}
        <Alert variant="warning" role="alert" actions={<Button variant="secondary" onClick={retry}>Retry</Button>}>
          Couldn&apos;t make the guide: {friendlyClause(error)}
        </Alert>
      </>
    );
  }
  if (!guide) return actions;

  const stepsById = new Map(guide.steps.map((s) => [s.id, s]));

  return (
    <section className="guide" aria-labelledby="guide-title">
      {actions}
      <h2 id="guide-title" className="build-panel-title">Build guide: {buildName}</h2>

      <BuildReadiness parts={buildParts} buildName={buildName} />

      <ol className="guide-steps">
        {guide.steps.map((step) => {
          const sorted = [...step.lines].sort(byKind);
          const made = sorted.filter((l) => l.kind === 'made').map((l) => partsByNumber.get(l.number)).filter(Boolean);
          const waiting = made.filter((p) => stageOf(p.status).blocking).length;
          return (
            <li key={step.id} className="guide-step" id={`guide-step-${step.number}`}>
              <header className="guide-step-head">
                <span className="guide-step-number">Step {step.number}</span>
                <h3 className="guide-step-title">{step.id === 'root' ? `Put together ${step.name}` : step.name}</h3>
                {step.count > 1 && <span className="guide-step-count">Make {step.count}</span>}
                {made.length > 0 && (
                  <span className={`stage-chip ${waiting ? `stage-${Stage.MAKING}` : `stage-${Stage.READY}`}`}>
                    {waiting ? `Waiting on ${waiting} Part${waiting === 1 ? '' : 's'}` : 'Parts ready'}
                  </span>
                )}
              </header>
              <div className="guide-step-body">
                <StepImage buildKey={build.key} step={step} buildName={buildName} />
                <table className="table guide-table">
                  <caption className="visually-hidden">What step {step.number} needs</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="cell-part">Item</th>
                      <th scope="col" className="cell-num">Each</th>
                      <th scope="col" className="cell-num">{step.count > 1 ? `For ${step.count}` : 'Total'}</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.length === 0 && <tr><td colSpan={4} className="table-empty">OnShape lists nothing in this step.</td></tr>}
                    {sorted.map((line, i) => {
                      const part = line.kind === 'made' && line.number ? partsByNumber.get(line.number) : null;
                      const vendor = line.sku ? vendorInfo[line.sku] : undefined;
                      return (
                        <tr key={`${line.kind}-${line.name}-${i}`} className={`guide-line guide-line-${line.kind}`}>
                          <th scope="row" className="cell-part">
                            <span className="part-cell">
                              <LineThumb buildKey={build.key} line={line} part={part} vendor={vendor} />
                              <span><LineWhat line={line} part={part} stepsById={stepsById} /></span>
                            </span>
                          </th>
                          <td className="cell-num" data-label="Each">{line.perUnit}</td>
                          <td className="cell-num" data-label={step.count > 1 ? `For ${step.count}` : 'Total'}>{line.total}</td>
                          <td className="cell-line-status"><LineStatus line={line} part={part} vendor={vendor} columns={columns} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
