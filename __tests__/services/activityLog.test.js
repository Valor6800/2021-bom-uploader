import { jest } from '@jest/globals';
import { ActivityLog, MARK, actorName } from '../../src/server/services/activityLog.js';
import { saveSummary } from '../../src/server/routes/buildRoutes.js';
import { whenText } from '../../src/client/src/lib/activity.js';

function jira({ comments = [] } = {}) {
  return {
    addComment: jest.fn().mockResolvedValue(undefined),
    getComments: jest.fn().mockResolvedValue(comments),
    getIssue: jest.fn().mockResolvedValue({ fields: { customfield_10110: 'HAR-1', customfield_10501: 2 } }),
  };
}
const user = { name: 'Sam Rivera', username: 'srivera' };

describe('ActivityLog.record', () => {
  it('writes an entry on the Assembly, naming the person and the Build', async () => {
    const jiraClient = jira();
    await new ActivityLog({ jiraClient }).record({ buildKey: 'HAR-5', user, action: 'cut', text: 'cut {build} from OnShape' });
    expect(jiraClient.getIssue).toHaveBeenCalledWith('HAR-5', { fields: ['customfield_10110', 'customfield_10501'] });
    expect(jiraClient.addComment).toHaveBeenCalledWith('HAR-1', `${MARK} · cut\nSam Rivera · cut Build 2 (HAR-5) from OnShape`);
  });

  it('writes straight to a named Assembly without reading anything', async () => {
    const jiraClient = jira();
    await new ActivityLog({ jiraClient }).record({ assemblyKey: 'HAR-9', user, action: 'spare', text: 'made a spare' });
    expect(jiraClient.getIssue).not.toHaveBeenCalled();
    expect(jiraClient.addComment).toHaveBeenCalledWith('HAR-9', `${MARK} · spare\nSam Rivera · made a spare`);
  });

  it('keeps tracker markup and line breaks out of an entry', async () => {
    const jiraClient = jira();
    await new ActivityLog({ jiraClient }).record({
      assemblyKey: 'HAR-9', user: { name: '*Bold* [link|x]' }, action: 'save', text: 'saved {color:red}x{color}\nnext',
    });
    const body = jiraClient.addComment.mock.calls[0][1];
    expect(body.split('\n')).toHaveLength(2);
    expect(body).not.toMatch(/[*[\]{}|]/);
  });

  it('never fails the action it records', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const jiraClient = jira();
    jiraClient.addComment.mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
    await expect(new ActivityLog({ jiraClient }).record({ assemblyKey: 'HAR-9', user, action: 'save', text: 'x' })).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe('ActivityLog.list', () => {
  it('reads only its own entries, newest first', async () => {
    const jiraClient = jira({
      comments: [
        { body: `${MARK} · build\nSam Rivera · made Build 2 (HAR-5)`, created: '2026-11-01T10:00:00.000-0700' },
        { body: 'A person\'s comment', created: '2026-11-02T10:00:00.000-0700' },
        { body: `${MARK} · cut\nAlex · cut Build 2 (HAR-5) from OnShape`, created: '2026-11-03T10:00:00.000-0700' },
      ],
    });
    expect(await new ActivityLog({ jiraClient }).list('HAR-1')).toEqual([
      { at: '2026-11-03T10:00:00.000-0700', action: 'cut', who: 'Alex', text: 'cut Build 2 (HAR-5) from OnShape' },
      { at: '2026-11-01T10:00:00.000-0700', action: 'build', who: 'Sam Rivera', text: 'made Build 2 (HAR-5)' },
    ]);
  });
});

describe('actorName', () => {
  it('uses the name, else the username, else "Someone"', () => {
    expect(actorName({ name: 'Sam', username: 's' })).toBe('Sam');
    expect(actorName({ username: 's' })).toBe('s');
    expect(actorName(null)).toBe('Someone');
  });
});

describe('saveSummary', () => {
  it('counts what a save did', () => {
    expect(saveSummary([
      { op: 'create', ok: true }, { op: 'create', ok: true }, { op: 'update', ok: true }, { op: 'link', ok: false },
    ])).toBe('2 Parts made, 1 Part changed (1 failed)');
    expect(saveSummary([{ op: 'copy', ok: true }])).toBe('1 copy made');
    expect(saveSummary([{ op: 'update', ok: false }])).toBe('');
  });
});

describe('whenText', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  it.each([
    ['2026-11-05T11:59:40Z', 'just now'], ['2026-11-05T11:55:00Z', '5 min ago'], ['2026-11-05T09:00:00Z', '3 h ago'],
    ['2026-11-04T06:00:00Z', 'yesterday'], [null, '—'],
  ])('%s → %s', (at, want) => { expect(whenText(at, now)).toBe(want); });
});
