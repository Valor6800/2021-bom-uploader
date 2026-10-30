import { jest } from '@jest/globals';
import { EpicService } from '../../src/server/services/epicService.js';

function makeJiraClient(overrides = {}) {
  return {
    getIssue: jest.fn(),
    ...overrides,
  };
}

describe('EpicService.getEpicByKey', () => {
  it('returns the parsed epic for a matching Assembly issue', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({
        key: 'VAL-1',
        fields: {
          summary: 'VR26A-0001 End Effector',
          customfield_10300: 'doc1',
          customfield_10301: 'ws1',
          customfield_10302: 'el1',
        },
      }),
    });
    const service = new EpicService({ jiraClient });

    const result = await service.getEpicByKey('VAL-1');

    expect(result).toEqual(expect.objectContaining({
      key: 'VAL-1',
      fullPartNumber: 'VR26A-0001',
      documentId: 'doc1',
      workspaceId: 'ws1',
      elementId: 'el1',
    }));
  });

  it('parses a v3 name with a revision letter into number, revision and clean name', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({
        key: 'HAR-2027',
        fields: { summary: 'VF27A-0000A Test Assembly' },
      }),
    });
    const service = new EpicService({ jiraClient });

    const result = await service.getEpicByKey('HAR-2027');

    expect(result).toEqual(expect.objectContaining({
      fullPartNumber: 'VF27A-0000A',
      seasonType: 'F',
      year: '27',
      partNumber: '0000',
      version: 'A',
      name: 'Test Assembly',
      isEpic: true,
    }));
  });

  it('returns null when the issue summary does not match the Assembly/Part number format', async () => {
    const jiraClient = makeJiraClient({
      getIssue: jest.fn().mockResolvedValue({ key: 'VAL-99', fields: { summary: 'Not an assembly' } }),
    });
    const service = new EpicService({ jiraClient });

    const result = await service.getEpicByKey('VAL-99');

    expect(result).toBeNull();
  });
});

describe('EpicService.generateEpicFromURL', () => {
  const URL = 'https://cad.onshape.com/documents/8c64dfdcb66184646a7a3f17/w/82f00d3cbea6901ac26040bd/e/faea62821490977c33bc8d7c';

  // Mirrors the live response shape of GET /api/metadata/d/{d}/w/{w}/e/{e}.
  function metadata(overrides = {}) {
    const values = {
      Name: 'Test Assembly',
      'Part number': '0000',
      Revision: 'A',
      Project: 'VF27',
      ...overrides,
    };
    const ids = {
      Name: '57f3fb8efa3416c06701d60d',
      'Part number': '57f3fb8efa3416c06701d60f',
      Revision: '57f3fb8efa3416c06701d610',
      Project: '57f3fb8efa3416c06701d613',
    };
    return {
      elementType: 1,
      mimeType: 'onshape/assembly',
      properties: [
        ...Object.entries(ids).map(([name, propertyId]) => ({
          name, propertyId, value: values[name], valueType: 'STRING',
        })),
        { name: 'Description', propertyId: '57f3fb8efa3416c06701d60e', value: null, valueType: 'STRING' },
      ],
    };
  }

  function setup(meta) {
    const jiraClient = makeJiraClient({ createIssue: jest.fn().mockResolvedValue({ key: 'HAR-1' }) });
    const onshapeClient = { getElementMetadata: jest.fn().mockResolvedValue(meta) };
    return { jiraClient, onshapeClient, service: new EpicService({ jiraClient, onshapeClient }) };
  }

  it('builds the summary and Epic Name from Project, Part number, Revision and Name', async () => {
    const { service, jiraClient, onshapeClient } = setup(metadata());

    const result = await service.generateEpicFromURL(URL);

    expect(onshapeClient.getElementMetadata).toHaveBeenCalledWith(
      '8c64dfdcb66184646a7a3f17', '82f00d3cbea6901ac26040bd', 'faea62821490977c33bc8d7c',
    );
    expect(result).toEqual({ key: 'HAR-1', summary: 'VF27A-0000A Test Assembly' });
    const fields = jiraClient.createIssue.mock.calls[0][0];
    expect(fields).toEqual(expect.objectContaining({
      summary: 'VF27A-0000A Test Assembly',
      customfield_10104: 'VF27A-0000A Test Assembly',
      customfield_10500: 'A',
      customfield_10300: '8c64dfdcb66184646a7a3f17',
      customfield_10301: '82f00d3cbea6901ac26040bd',
      customfield_10302: 'faea62821490977c33bc8d7c',
    }));
  });

  it('falls back to the property name when the property id differs', async () => {
    const meta = metadata();
    meta.properties = meta.properties.map((p) => ({ ...p, propertyId: `other-${p.propertyId}` }));
    const { service, jiraClient } = setup(meta);

    await service.generateEpicFromURL(URL);

    expect(jiraClient.createIssue.mock.calls[0][0].summary).toBe('VF27A-0000A Test Assembly');
  });

  it('trims whitespace around property values', async () => {
    const { service, jiraClient } = setup(metadata({ Project: ' VF27 ', Name: ' Test Assembly ' }));

    await service.generateEpicFromURL(URL);

    expect(jiraClient.createIssue.mock.calls[0][0].summary).toBe('VF27A-0000A Test Assembly');
  });

  it.each([
    ['Project', { Project: null }],
    ['Part number', { 'Part number': '' }],
    ['Revision', { Revision: '   ' }],
    ['Name', { Name: null }],
  ])('rejects with 400 and creates nothing when %s is empty', async (prop, overrides) => {
    const { service, jiraClient } = setup(metadata(overrides));

    await expect(service.generateEpicFromURL(URL)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(`missing ${prop}`),
    });
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });

  it('lists every missing property in one message', async () => {
    const { service } = setup(metadata({ Project: null, Revision: null }));

    await expect(service.generateEpicFromURL(URL)).rejects.toThrow('missing Project, Revision');
  });

  it.each([
    ['Project', { Project: 'Robot 2027' }],
    ['Project', { Project: 'VX27' }],
    ['Part number', { 'Part number': '12' }],
    ['Part number', { 'Part number': 'VF27A-0000' }],
    ['Revision', { Revision: 'AB' }],
    ['Revision', { Revision: 'a' }],
  ])('rejects a malformed %s', async (prop, overrides) => {
    const { service, jiraClient } = setup(metadata(overrides));

    await expect(service.generateEpicFromURL(URL)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(`invalid ${prop}`),
    });
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });

  it('rejects a URL that points at a non-assembly tab', async () => {
    const { service, jiraClient } = setup({ ...metadata(), elementType: 0, mimeType: 'onshape/partstudio' });

    await expect(service.generateEpicFromURL(URL)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('not an assembly'),
    });
    expect(jiraClient.createIssue).not.toHaveBeenCalled();
  });

  it('rejects a malformed URL with 400 without calling OnShape', async () => {
    const { service, onshapeClient } = setup(metadata());

    await expect(service.generateEpicFromURL('https://cad.onshape.com/nope')).rejects.toMatchObject({ status: 400 });
    expect(onshapeClient.getElementMetadata).not.toHaveBeenCalled();
  });
});
