import { useAppStore } from '../store/index.js';
import AssemblySelection from '../components/AssemblySelection.jsx';
import BuildSelection from '../components/BuildSelection.jsx';
import DesignerPartsTable from '../components/DesignerPartsTable.jsx';

const JIRA_BASE_URL = 'https://jira.valor6800.com';

/**
 * Designer page — the CAD-student flow for building up a Build's part list.
 * Assembly selection is the same concept (and component) as the Assembly BOM
 * page's; a Build is scoped underneath it.
 */
export default function DesignerPage() {
  const seasonType = useAppStore((s) => s.seasonType);
  const year = useAppStore((s) => s.year);
  const selectedEpic = useAppStore((s) => s.selectedEpic);

  return (
    <>
      <div className="print-assembly-info">
        <h3 className="font-bold mb-2">Assembly Information</h3>
        <div className="print-info-flex">
          <div><strong>Architecture:</strong> {seasonType === 'R' ? 'Robot' : 'Facility'}</div>
          <div><strong>Year:</strong> 20{year}</div>
          <div><strong>Assembly:</strong> {selectedEpic?.summary || 'Not Selected'}</div>
        </div>
      </div>

      <AssemblySelection />

      <BuildSelection />

      <DesignerPartsTable jiraBaseUrl={JIRA_BASE_URL} />
    </>
  );
}
