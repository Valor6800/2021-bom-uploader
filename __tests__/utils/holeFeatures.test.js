import fs from 'node:fs';
import { holesByPart, plainValue, tappedByEntity } from '../../src/server/utils/holeFeatures.js';

const { body, holeScriptResponse } = JSON.parse(fs.readFileSync(new URL('../fixtures/tappedPart.json', import.meta.url)));

describe('holeFeatures', () => {
  it('reads OnShape\'s typed values as plain ones', () => {
    const typed = {
      typeName: 'BTFSValueArray',
      message: { value: [{ typeName: 'BTFSValueMap', message: { value: [{ message: { key: { typeName: 'BTFSValueString', message: { value: 'a' } }, value: { typeName: 'BTFSValueNumber', message: { value: 2 } } } }] } }] },
    };
    expect(plainValue(typed)).toEqual([{ a: 2 }]);
  });

  it('lists each part\'s hole faces from the real answer', () => {
    const holes = holesByPart(holeScriptResponse);
    expect([...holes.keys()]).toEqual([body.id]);
    expect(holes.get(body.id).map((h) => [h.faceId, h.tapped, h.tapSize, h.through])).toEqual([
      ['JJC', false, null, false],
      ['JLC', true, '1/4-20', true],
      ['JLG', true, '1/4-20', true],
    ]);
  });

  it('finds a tapped hole by its face or its edges', () => {
    const tapped = tappedByEntity(body, holesByPart(holeScriptResponse).get(body.id));
    expect(tapped.has('JLC')).toBe(true);
    expect(tapped.has('JJC')).toBe(false);
    const edges = body.faces.find((f) => f.id === 'JLC').loops.flatMap((l) => l.coedges.map((c) => c.edgeId));
    for (const id of edges) expect(tapped.get(id).tapSize).toBe('1/4-20');
  });

  it('answers nothing for an empty or missing answer', () => {
    expect(holesByPart({ result: { typeName: 'BTFSValueArray', message: { value: [] } } }).size).toBe(0);
    expect(holesByPart(null).size).toBe(0);
  });
});
