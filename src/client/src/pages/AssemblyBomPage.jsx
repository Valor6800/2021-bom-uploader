import { useAppStore } from '../store/index.js';
import AssemblySelection from '../components/AssemblySelection.jsx';
import PartsListTable from '../components/PartsListTable.jsx';

const JIRA_BASE_URL = 'https://jira.valor6800.com';

/**
 * Assembly BOM page — the OnShape ↔ Jira BOM sync flow.
 * State lives in the client store; this page only composes the sections and
 * renders the print header from store selectors.
 */
export default function AssemblyBomPage() {
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

      <PartsListTable jiraBaseUrl={JIRA_BASE_URL} />
    </>
  );
}
