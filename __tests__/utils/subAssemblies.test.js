import { describeSubAssembly, countCreated, subLabel } from '../../src/client/src/lib/subAssemblies.js';

const assembly = (key, summary) => ({ key, summary });

describe('describeSubAssembly', () => {
  it('says a new one will be created in a preview', () => {
    const sub = { name: 'Shooter', status: 'new', proposed: { summary: 'VF27A-1200A Shooter' } };
    expect(describeSubAssembly(sub, { preview: true })).toBe('VF27A-1200A Shooter: will be created');
  });

  it('says one that exists will not be created again, with its key', () => {
    const sub = { name: 'Intake', status: 'exists', assembly: assembly('HAR-2000', 'VF27A-1100A Intake') };
    expect(describeSubAssembly(sub, { preview: true }))
      .toBe('VF27A-1100A Intake: already exists (HAR-2000), so it will not be created again');
    expect(describeSubAssembly(sub)).toBe('VF27A-1100A Intake: already exists (HAR-2000), not created again');
  });

  it('reports what was created', () => {
    const sub = { name: 'Climber', status: 'created', assembly: assembly('HAR-2062', 'VF27A-1300A Climber') };
    expect(describeSubAssembly(sub)).toBe('VF27A-1300A Climber: created (HAR-2062)');
  });

  it('names the Assembly that already owns a clashing number', () => {
    const sub = { name: 'Shooter', status: 'conflict', proposed: { summary: 'VF27A-1200A Shooter' }, assembly: assembly('HAR-1500', 'x') };
    expect(describeSubAssembly(sub)).toBe('x: skipped, its number already belongs to HAR-1500');
  });

  it('names the OnShape properties to fill in', () => {
    const sub = { name: 'Shooter', status: 'problems', problems: [{ property: 'Part number' }, { property: 'Revision' }] };
    expect(describeSubAssembly(sub)).toBe('Shooter: skipped, fill in Part number, Revision in OnShape');
  });

  it('falls back to the message for a problem with no property list', () => {
    const sub = { name: 'Shooter', status: 'problems', problems: [], message: 'OnShape could not open it.' };
    expect(describeSubAssembly(sub)).toBe('Shooter: skipped, OnShape could not open it.');
  });

  it('reports a failure with its reason', () => {
    const sub = { name: 'Shooter', status: 'error', message: "the team tracker didn't respond (503)" };
    expect(describeSubAssembly(sub)).toBe("Shooter: wasn't created: the team tracker didn't respond (503)");
    expect(describeSubAssembly(sub, { preview: true })).toBe("Shooter: couldn't be checked: the team tracker didn't respond (503)");
  });
});

describe('countCreated and subLabel', () => {
  const subs = [{ status: 'new' }, { status: 'new' }, { status: 'exists' }, { status: 'created' }];
  it('counts new ones in a preview and created ones in a result', () => {
    expect(countCreated(subs, { preview: true })).toBe(2);
    expect(countCreated(subs)).toBe(1);
    expect(countCreated(undefined)).toBe(0);
  });
  it('labels by summary, then proposal, then name', () => {
    expect(subLabel({ assembly: { summary: 'A' }, proposed: { summary: 'B' }, name: 'C' })).toBe('A');
    expect(subLabel({ proposed: { summary: 'B' }, name: 'C' })).toBe('B');
    expect(subLabel({ name: 'C' })).toBe('C');
  });
});
