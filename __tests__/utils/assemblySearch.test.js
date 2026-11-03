import {
  toAssembly,
  tokenize,
  matchAssembly,
  rankAssembly,
  groupBySeason,
  searchAssemblyList,
} from '../../src/server/utils/assemblySearch.js';

function issue(key, summary, extra = {}) {
  return {
    key,
    fields: {
      summary,
      status: { name: extra.status ?? 'New' },
      created: extra.created ?? '2026-01-01T00:00:00.000+0000',
      issuetype: { name: 'Epic' },
      ...(extra.fields ?? {}),
    },
  };
}

// The six live Assemblies from design section 1, newest first.
const LIVE = [
  issue('HAR-2030', 'VF27A-0000A Test Assembly', {
    created: '2026-10-29T20:15:40.000+0000',
    fields: {
      customfield_10300: '8c64dfdcb66184646a7a3f17',
      customfield_10301: '82f00d3cbea6901ac26040bd',
      customfield_10302: 'faea62821490977c33bc8d7c',
    },
  }),
  issue('HAR-1984', 'VF27-0200 Tooling', { created: '2026-09-02T00:00:00.000+0000' }),
  issue('HAR-1983', 'VF27-0100 Raw Materials', { created: '2026-09-01T00:00:00.000+0000' }),
  issue('HAR-1980', 'Prototyping end effector', { created: '2026-08-01T00:00:00.000+0000' }),
  issue('HAR-1979', 'VR26-1200A End Effector', { created: '2026-07-01T00:00:00.000+0000' }),
  issue('HAR-1972', 'Second end effector', { created: '2026-06-01T00:00:00.000+0000' }),
].map((i) => toAssembly(i, { onshapeBaseUrl: 'https://cad.onshape.com/' }));

const keys = (r) => r.results.map((a) => a.key);

describe('toAssembly', () => {
  it('maps a numbered Assembly', () => {
    expect(LIVE[0]).toEqual({
      key: 'HAR-2030',
      summary: 'VF27A-0000A Test Assembly',
      name: 'Test Assembly',
      numbered: true,
      fullPartNumber: 'VF27A-0000A',
      partNumber: '0000',
      revision: 'A',
      seasonType: 'F',
      year: '27',
      seasonCode: 'VF27',
      seasonLabel: 'Facility 2027',
      status: 'New',
      closed: false,
      created: '2026-10-29T20:15:40.000+0000',
      documentId: '8c64dfdcb66184646a7a3f17',
      workspaceId: '82f00d3cbea6901ac26040bd',
      elementId: 'faea62821490977c33bc8d7c',
      configuration: null,
      onshapeUrl: 'https://cad.onshape.com/documents/8c64dfdcb66184646a7a3f17/w/82f00d3cbea6901ac26040bd/e/faea62821490977c33bc8d7c',
    });
  });

  it('takes a loose season from "VF27-0200 Tooling" and keeps it unnumbered', () => {
    const a = LIVE[1];
    expect(a).toEqual(expect.objectContaining({
      numbered: false,
      name: 'VF27-0200 Tooling',
      fullPartNumber: null,
      partNumber: null,
      revision: null,
      seasonCode: 'VF27',
      seasonLabel: 'Facility 2027',
      onshapeUrl: null,
    }));
  });

  it('gives no season for a name with no prefix', () => {
    expect(LIVE[5]).toEqual(expect.objectContaining({ seasonCode: null, seasonLabel: null, year: null }));
  });

  it('prefers the Revision field over the summary letter', () => {
    const a = toAssembly(issue('HAR-1', 'VF27A-0000A X', { fields: { customfield_10500: 'B' } }));
    expect(a.revision).toBe('B');
  });

  it('marks Closed and Finished as closed', () => {
    expect(toAssembly(issue('HAR-1', 'x', { status: 'Closed' })).closed).toBe(true);
    expect(toAssembly(issue('HAR-1', 'x', { status: 'Finished' })).closed).toBe(true);
    expect(toAssembly(issue('HAR-1', 'x', { status: 'In Progress' })).closed).toBe(false);
  });
});

describe('tokenize', () => {
  it('trims, lower-cases and collapses whitespace', () => {
    expect(tokenize('  Facility   2027 ')).toEqual(['facility', '2027']);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('searchAssemblyList', () => {
  it('"0000" matches VF27A-0000A through the bare number', () => {
    const r = searchAssemblyList(LIVE, '0000', 50);
    expect(keys(r)).toEqual(['HAR-2030']);
    expect(r.results[0].score).toBe(80);
    expect(r.groups).toBeNull();
  });

  it('"facility 2027" matches through the season label', () => {
    expect(keys(searchAssemblyList(LIVE, 'facility 2027', 50)))
      .toEqual(['HAR-2030', 'HAR-1984', 'HAR-1983']);
  });

  it('"VF27" matches through the summary and season code', () => {
    // The unnumbered two are named by their whole summary, so "vf27" is a
    // name prefix for them (60) and only a substring for HAR-2030 (40).
    expect(keys(searchAssemblyList(LIVE, 'VF27', 50)))
      .toEqual(['HAR-1984', 'HAR-1983', 'HAR-2030']);
  });

  it('"har-2030" matches through the key with score 100', () => {
    const r = searchAssemblyList(LIVE, 'har-2030', 50);
    expect(keys(r)).toEqual(['HAR-2030']);
    expect(r.results[0].score).toBe(100);
  });

  it('"2030" matches through the key', () => {
    expect(keys(searchAssemblyList(LIVE, '2030', 50))).toEqual(['HAR-2030']);
  });

  it('requires every token to match (AND)', () => {
    expect(keys(searchAssemblyList(LIVE, 'end effector', 50)))
      .toEqual(['HAR-1980', 'HAR-1979', 'HAR-1972']);
    expect(keys(searchAssemblyList(LIVE, 'end 2026', 50))).toEqual(['HAR-1979']);
    expect(keys(searchAssemblyList(LIVE, 'test bash', 50))).toEqual([]);
  });

  it('"test assem" matches through the summary', () => {
    expect(keys(searchAssemblyList(LIVE, 'test assem', 50))).toEqual(['HAR-2030']);
  });

  it('gives an exact full number 90', () => {
    expect(searchAssemblyList(LIVE, 'vf27a-0000a', 50).results[0].score).toBe(90);
  });

  it('ranks key 100 > full number 90 > bare number 80 > name prefix 60 > other 40', () => {
    const a = LIVE[0];
    expect(rankAssembly(a, tokenize('HAR-2030'))).toBe(100);
    expect(rankAssembly(a, tokenize('VF27A-0000A'))).toBe(90);
    expect(rankAssembly(a, tokenize('0000'))).toBe(80);
    expect(rankAssembly(a, tokenize('test'))).toBe(60);
    expect(rankAssembly(a, tokenize('assembly'))).toBe(40);
  });

  it('puts a name-prefix match before a newer substring match', () => {
    const list = [
      toAssembly(issue('HAR-2', 'Big intake', { created: '2026-02-01T00:00:00.000+0000' })),
      toAssembly(issue('HAR-1', 'Intake arm', { created: '2026-01-01T00:00:00.000+0000' })),
    ];
    expect(keys(searchAssemblyList(list, 'intake', 50))).toEqual(['HAR-1', 'HAR-2']);
  });

  it('breaks score ties with the newest created first', () => {
    const r = searchAssemblyList(LIVE, 'effector', 50);
    expect(r.results.map((a) => a.score)).toEqual([40, 40, 40]);
    expect(keys(r)).toEqual(['HAR-1980', 'HAR-1979', 'HAR-1972']);
  });

  it('groups the empty query by season with Other last', () => {
    const r = searchAssemblyList(LIVE, '', 50);
    expect(r.groups).toEqual([
      { label: 'Facility 2027', seasonCode: 'VF27', keys: ['HAR-2030', 'HAR-1984', 'HAR-1983'] },
      { label: 'Robot 2026', seasonCode: 'VR26', keys: ['HAR-1979'] },
      { label: 'Other', seasonCode: null, keys: ['HAR-1980', 'HAR-1972'] },
    ]);
    expect(keys(r)).toEqual(['HAR-2030', 'HAR-1984', 'HAR-1983', 'HAR-1979', 'HAR-1980', 'HAR-1972']);
    expect(r.total).toBe(6);
  });

  it('counts total before the cap and lists only kept keys in groups', () => {
    const many = Array.from({ length: 60 }, (_, i) => toAssembly(issue(
      `HAR-${3000 + i}`,
      i < 45 ? `VR27A-${String(i).padStart(4, '0')}A Part ${i}` : `Loose ${i}`,
      { created: `2026-01-01T00:00:${String(59 - i).padStart(2, '0')}.000+0000` },
    )));
    const r = searchAssemblyList(many, '', 50);
    expect(r.total).toBe(60);
    expect(r.results).toHaveLength(50);
    const groupKeys = r.groups.flatMap((g) => g.keys);
    expect(groupKeys).toEqual(keys(r));
    expect(r.groups.find((g) => g.label === 'Other').keys).toHaveLength(5);
  });

  it('omits a group whose members were all cut off', () => {
    const list = [
      toAssembly(issue('HAR-1', 'VR27A-0001A A', { created: '2026-02-01T00:00:00.000+0000' })),
      toAssembly(issue('HAR-2', 'No season', { created: '2026-01-01T00:00:00.000+0000' })),
    ];
    const r = searchAssemblyList(list, '', 1);
    expect(r.groups).toEqual([{ label: 'Robot 2027', seasonCode: 'VR27', keys: ['HAR-1'] }]);
    expect(r.total).toBe(2);
  });
});

describe('groupBySeason', () => {
  it('orders newest year first and Robot before Facility within a year', () => {
    const list = [
      toAssembly(issue('HAR-1', 'VF26A-0001A a')),
      toAssembly(issue('HAR-2', 'VR26A-0001A b')),
      toAssembly(issue('HAR-3', 'VF27A-0001A c')),
      toAssembly(issue('HAR-4', 'VR27A-0001A d')),
      toAssembly(issue('HAR-5', 'none')),
    ];
    expect(groupBySeason(list).map((g) => g.label))
      .toEqual(['Robot 2027', 'Facility 2027', 'Robot 2026', 'Facility 2026', 'Other']);
  });
});

describe('matchAssembly', () => {
  it('matches the 4-digit year', () => {
    expect(matchAssembly(LIVE[0], ['2027'])).toBe(true);
    expect(matchAssembly(LIVE[0], ['2026'])).toBe(false);
  });
});
