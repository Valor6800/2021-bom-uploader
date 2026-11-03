import {
  cleanConfiguration, configurationFrom, configurationFromUrl, configurationLine,
} from '../../src/server/utils/onshapeConfiguration.js';

const CONFIG = 'List_7BgV2vxCHVntIE=_2x2_Lowered;List_SU9XIYjjB4kB3y=Default;List_c3HUM4N9FVts6n=X2CR';

describe('the configuration an Assembly follows', () => {
  it('reads it from the link pasted, decoded', () => {
    const url = `https://cad.onshape.com/documents/${'a'.repeat(24)}/w/${'b'.repeat(24)}/e/${'c'.repeat(24)}?configuration=${encodeURIComponent(CONFIG)}`;
    expect(configurationFromUrl(url)).toBe(CONFIG);
  });

  it('has none for a link without one, or one that is not a URL', () => {
    expect(configurationFromUrl('https://cad.onshape.com/documents/a/w/b/e/c')).toBeNull();
    expect(configurationFromUrl('https://cad.onshape.com/documents/a/w/b/e/c?configuration=')).toBeNull();
    expect(configurationFromUrl('not a url')).toBeNull();
    expect(configurationFromUrl(undefined)).toBeNull();
  });

  it('writes it as a line in the description and reads it back, wherever the line is', () => {
    const line = configurationLine(CONFIG);
    expect(line).toBe(`Onshape configuration: ${CONFIG}`);
    expect(configurationFrom(line)).toBe(CONFIG);
    expect(configurationFrom(`The chassis base.\r\n${line}\r\nMore notes.`)).toBe(CONFIG);
    expect(configurationFrom('onshape configuration:   List_a=X  ')).toBe('List_a=X');
  });

  it('has none for a description without the line, and writes no line for none', () => {
    expect(configurationFrom('Just a description.')).toBeNull();
    expect(configurationFrom(null)).toBeNull();
    expect(configurationLine(null)).toBe('');
    expect(configurationLine('')).toBe('');
  });

  it("treats OnShape's \"default\" as no configuration", () => {
    expect(cleanConfiguration('default')).toBeNull();
    expect(cleanConfiguration('Default')).toBeNull();
    expect(configurationLine('default')).toBe('');
    expect(configurationFromUrl('https://cad.onshape.com/documents/a/w/b/e/c?configuration=default')).toBeNull();
  });

  it('refuses characters that could break out of a query string', () => {
    expect(cleanConfiguration('List_a=X&other=1')).toBeNull();
    expect(cleanConfiguration('List_a=X#frag')).toBeNull();
    expect(cleanConfiguration('a'.repeat(2001))).toBeNull();
    expect(configurationFrom('Onshape configuration: List_a=X&evil=1')).toBeNull();
    expect(cleanConfiguration('List_a=2 in;List_b=X2C0')).toBe('List_a=2 in;List_b=X2C0');
  });
});
