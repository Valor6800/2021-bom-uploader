import { useState, useCallback } from 'react';
import { fetchStoriesByEpic } from './api/client.js';
import AssemblySelection from './components/AssemblySelection.jsx';
import PartsListTable from './components/PartsListTable.jsx';

const JIRA_BASE_URL = 'https://jira.valor6800.com';

export default function App() {
  const [seasonType, setSeasonType] = useState('R');
  const [year, setYear] = useState('26');
  const [selectedEpic, setSelectedEpic] = useState(null);
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [epicReloadKey, setEpicReloadKey] = useState(0);

  const handleEpicSelected = useCallback((epic, loadedStories) => {
    setSelectedEpic(epic);
    setStories(loadedStories);
  }, []);

  const handleStoriesUpdated = useCallback((updatedStories) => {
    setStories(updatedStories);
  }, []);

  const handleEpicCreated = useCallback(() => {
    setEpicReloadKey((k) => k + 1);
  }, []);

  const handleSaveComplete = useCallback(async () => {
    // Reload fresh stories from Jira after save
    if (selectedEpic?.key) {
      try {
        const fresh = await fetchStoriesByEpic(selectedEpic.key);
        const list = Array.isArray(fresh) ? fresh : Object.values(fresh);
        setStories(list.map((s) => ({ ...s, _status: 'Exists' })));
      } catch {
        // Keep local state if reload fails
      }
    }
  }, [selectedEpic]);

  return (
    <div className="app-wrapper">
      <nav className="nav no-print">
        <div className="nav-inner">
          <div className="nav-brand">
            <span className="nav-icon">⚙</span>
            <h1 className="nav-title">BOM Uploader</h1>
          </div>
        </div>
      </nav>

      <div className="container container-py">
        <div className="print-assembly-info">
          <h3 className="font-bold mb-2">Assembly Information</h3>
          <div className="print-info-flex">
            <div><strong>Architecture:</strong> {seasonType === 'R' ? 'Robot' : 'Facility'}</div>
            <div><strong>Year:</strong> 20{year}</div>
            <div><strong>Assembly:</strong> {selectedEpic?.summary || 'Not Selected'}</div>
          </div>
        </div>

        <AssemblySelection
          key={epicReloadKey}
          seasonType={seasonType}
          setSeasonType={setSeasonType}
          year={year}
          setYear={setYear}
          onEpicSelected={handleEpicSelected}
          onEpicCreated={handleEpicCreated}
        />

        <PartsListTable
          stories={stories}
          selectedEpic={selectedEpic}
          jiraBaseUrl={JIRA_BASE_URL}
          onStoriesUpdated={handleStoriesUpdated}
          onSaveComplete={handleSaveComplete}
          loading={loading}
          setLoading={setLoading}
        />
      </div>
    </div>
  );
}
