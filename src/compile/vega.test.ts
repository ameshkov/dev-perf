import { describe, expect, it } from 'vitest';
import { compile as vegaLiteCompile } from 'vega-lite';
import type { ChartRow } from './vega.js';
import {
  barLineSpec,
  barSpec,
  groupedBarSpec,
  horizontalBarSpec,
  lineSeriesSpec,
  pieSpec,
  renderSvg,
  stackedBarSpec,
} from './vega.js';

/** Two periods of sample rows for the spec tests. */
const ROWS: ChartRow[] = [
  { x: 'Jan', key: 'a', value: 1 },
  { x: 'Jan', key: 'b', value: 2 },
  { x: 'Feb', key: 'a', value: 3 },
  { x: 'Feb', key: 'b', value: 0 },
];

describe('spec builders', () => {
  it('compile to valid vega-lite specs', () => {
    expect(() =>
      vegaLiteCompile(stackedBarSpec('Stacked', ['Jan', 'Feb'], ['a', 'b'], ROWS, 'V', 'K')),
    ).not.toThrow();
    expect(() =>
      vegaLiteCompile(groupedBarSpec('Grouped', ['Jan', 'Feb'], ['a', 'b'], ROWS, 'V', 'K')),
    ).not.toThrow();
    expect(() => vegaLiteCompile(barLineSpec('BarLine', ['Jan', 'Feb'], ROWS, 'V'))).not.toThrow();
    expect(() =>
      vegaLiteCompile(lineSeriesSpec('Lines', ['Jan', 'Feb'], ['a', 'b'], ROWS, 'V', 'K')),
    ).not.toThrow();
    expect(() =>
      vegaLiteCompile(horizontalBarSpec('Horizontal', ['b', 'a'], ROWS, 'V')),
    ).not.toThrow();
    expect(() => vegaLiteCompile(pieSpec('Pie', ROWS, 'K'))).not.toThrow();
    expect(() => vegaLiteCompile(barSpec('Bars', ['Jan', 'Feb'], ROWS, 'V'))).not.toThrow();
  });

  it('keeps the explicit category order of the stacked spec', () => {
    const spec = stackedBarSpec('Stacked', ['Feb', 'Jan'], ['a', 'b'], ROWS, 'V', 'K') as {
      encoding?: { x?: { sort?: string[] } };
    };
    expect(spec.encoding?.x?.sort).toEqual(['Feb', 'Jan']);
  });

  it('keeps the explicit category and group order of the grouped spec', () => {
    const spec = groupedBarSpec('Grouped', ['Feb', 'Jan'], ['b', 'a'], ROWS, 'V', 'K') as {
      encoding?: {
        x?: { sort?: string[] };
        xOffset?: { sort?: string[] };
        color?: { scale?: { domain?: string[] } };
      };
    };
    expect(spec.encoding?.x?.sort).toEqual(['Feb', 'Jan']);
    expect(spec.encoding?.xOffset?.sort).toEqual(['b', 'a']);
    expect(spec.encoding?.color?.scale?.domain).toEqual(['b', 'a']);
  });
});

describe('renderSvg', () => {
  it('renders a spec to an SVG with the title and legend entries', async () => {
    const svg = await renderSvg(
      lineSeriesSpec(
        'Rendered lines',
        ['Jan', 'Feb'],
        ['added', 'removed'],
        ROWS,
        'Lines',
        'Series',
      ),
    );

    expect(svg).toContain('<svg');
    expect(svg).toContain('Rendered lines');
    expect(svg).toContain('added');
    expect(svg).toContain('removed');
  });

  it('renders every chart at the shared 1024px width and 3:2 ratio', async () => {
    const svg = await renderSvg(groupedBarSpec('Wide', ['Jan', 'Feb'], ['a', 'b'], ROWS, 'V', 'K'));
    expect(svg).toContain('width="1024"');
    expect(svg).toContain('height="683"');
    expect(svg).not.toContain('width="420"');
  });
});
