import { Stage, boardPlaceOf, readinessOf, stageOf } from '../../src/client/src/lib/partStage.js';

describe('stageOf', () => {
  it.each([
    ['Backlog', Stage.NOT_STARTED],
    ['Ready to Fabricate', Stage.MAKING],
    ['Manufacturing', Stage.MAKING],
    ['Post Processing', Stage.FINISHING],
    ['Needs Mentor Approval', Stage.FINISHING],
    ['Mentor Approved', Stage.READY],
    ['Powder Coat', Stage.FINISHING],
    ['Assembly', Stage.READY],
    ['Assembled', Stage.ASSEMBLED],
    ['Ignore', Stage.UNKNOWN],
    [null, Stage.UNKNOWN],
  ])('%s is %s', (status, stage) => {
    expect(stageOf(status).id).toBe(stage);
  });

  it('orders the workflow across both boards', () => {
    expect(stageOf('Backlog').order).toBeLessThan(stageOf('Needs Mentor Approval').order);
    expect(stageOf('Mentor Approved').order).toBeLessThan(stageOf('Powder Coat').order);
    expect(stageOf('Powder Coat').order).toBeLessThan(stageOf('Assembled').order);
  });
});

describe('boardPlaceOf', () => {
  it('names the board and column', () => {
    const columns = { 10200: { board: 'Assembly', column: 'Powder Coat' } };
    expect(boardPlaceOf('10200', columns)).toBe('Assembly board · Powder Coat');
    expect(boardPlaceOf('1', columns)).toBeNull();
    expect(boardPlaceOf(null, columns)).toBeNull();
  });
});

describe('readinessOf', () => {
  it('counts ready Parts and lists the blockers, furthest behind first', () => {
    const parts = [
      { key: 'A', status: 'Assembled' },
      { key: 'B', status: 'Powder Coat' },
      { key: 'C', status: 'Mentor Approved' },
      { key: 'D', status: 'Backlog' },
      { key: 'E', status: 'Ignore' },
    ];
    const r = readinessOf(parts);
    expect(r).toMatchObject({ total: 5, ready: 2 });
    expect(r.counts).toMatchObject({ [Stage.ASSEMBLED]: 1, [Stage.FINISHING]: 1, [Stage.READY]: 1, [Stage.NOT_STARTED]: 1, [Stage.UNKNOWN]: 1 });
    expect(r.blockers.map((b) => b.part.key)).toEqual(['D', 'B']);
  });
});
