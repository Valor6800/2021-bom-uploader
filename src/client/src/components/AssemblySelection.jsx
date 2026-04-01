import { useState, useEffect, useCallback } from 'react';
import { fetchEpics, fetchStoriesByEpic, createEpicFromURL } from '../api/client.js';
import Card from './ui/Card.jsx';
import Select from './ui/Select.jsx';
import Button from './ui/Button.jsx';

const SEASON_TYPES = [
  { value: 'R', label: 'Robot' },
  { value: 'F', label: 'Facility' },
];

const YEARS = [
  { value: '25', label: '2025' },
  { value: '26', label: '2026' },
  { value: '27', label: '2027' },
];

export default function AssemblySelection({
  seasonType,
  setSeasonType,
  year,
  setYear,
  onEpicSelected,
  onEpicCreated,
}) {
  const [epics, setEpics] = useState([]);
  const [loading, setLoading] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlMsg, setUrlMsg] = useState(null); // { type: 'success'|'error', text }

  const loadEpics = useCallback(async (st, yr) => {
    setLoading(true);
    try {
      const data = await fetchEpics(st, yr);
      const epicList = Array.isArray(data)
        ? data.filter((e) => e.isEpic)
        : Object.values(data).filter((e) => e.isEpic);
      setEpics(epicList);
    } catch {
      setEpics([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEpics(seasonType, year);
  }, [seasonType, year, loadEpics]);

  const handlePrereqChange = (setter) => (e) => {
    setter(e.target.value);
  };

  const handleEpicChange = async (e) => {
    const val = e.target.value;
    if (val === '0') {
      onEpicSelected(null, []);
      return;
    }
    try {
      const epic = JSON.parse(val);
      const stories = await fetchStoriesByEpic(epic.key);
      const storyList = Array.isArray(stories) ? stories : Object.values(stories);
      onEpicSelected(epic, storyList.map((s) => ({ ...s, _status: 'Exists' })));
    } catch {
      onEpicSelected(null, []);
    }
  };

  const handleCreateFromURL = useCallback(async () => {
    if (!urlValue.trim()) return;
    setUrlLoading(true);
    setUrlMsg(null);
    try {
      const result = await createEpicFromURL(urlValue.trim());
      setUrlMsg({ type: 'success', text: `Epic ${result.key} created — reloading list...` });
      setUrlValue('');
      // Give Jira a moment to index, then reload the dropdown
      setTimeout(() => {
        loadEpics(seasonType, year);
        setUrlMsg({ type: 'success', text: `Epic ${result.key} created` });
        setTimeout(() => setUrlMsg((prev) => prev?.type === 'success' ? null : prev), 3000);
      }, 1500);
      if (onEpicCreated) onEpicCreated();
    } catch (err) {
      setUrlMsg({ type: 'error', text: err.message || 'Failed to create epic from URL' });
    } finally {
      setUrlLoading(false);
    }
  }, [urlValue, onEpicCreated]);

  return (
    <Card title="Assembly Selection" icon="⚙" collapsible className="mb-8">
      <div className="card-body">
        <div className="grid-3 mb-4">
          <Select
            label="Architecture"
            id="seasonTypes"
            value={seasonType}
            onChange={handlePrereqChange(setSeasonType)}
          >
            {SEASON_TYPES.map((st) => (
              <option key={st.value} value={st.value}>{st.label}</option>
            ))}
          </Select>

          <Select
            label="Year"
            id="years"
            value={year}
            onChange={handlePrereqChange(setYear)}
          >
            {YEARS.map((y) => (
              <option key={y.value} value={y.value}>{y.label}</option>
            ))}
          </Select>

          <Select
            label="Assembly"
            id="epics"
            onChange={handleEpicChange}
            disabled={loading}
          >
            <option value="0">
              {loading ? 'Loading assemblies...' : 'Select assembly...'}
            </option>
            {epics.map((epic) => (
              <option key={epic.key || epic.fullPartNumber} value={JSON.stringify(epic)}>
                {epic.summary}
              </option>
            ))}
          </Select>
        </div>

        <div className="url-input-group">
          <input
            type="text"
            className="url-input"
            placeholder="Paste Onshape URL to create a new epic..."
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFromURL()}
            disabled={urlLoading}
          />
          <Button
            variant="primary"
            onClick={handleCreateFromURL}
            disabled={!urlValue.trim() || urlLoading}
          >
            {urlLoading ? 'Creating...' : 'Create Epic'}
          </Button>
        </div>
        {urlMsg && (
          <p className={urlMsg.type === 'success' ? 'success-msg' : 'error-msg'}>
            {urlMsg.text}
          </p>
        )}

      </div>
    </Card>
  );
}
