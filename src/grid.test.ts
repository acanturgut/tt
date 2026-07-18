import { describe, it, expect } from 'vitest';
import { gridDims } from './grid';

describe('gridDims', () => {
  it('lays n agents into a near-square grid', () => {
    expect(gridDims(1)).toEqual({ cols: 1, rows: 1 });
    expect(gridDims(2)).toEqual({ cols: 2, rows: 1 });
    expect(gridDims(3)).toEqual({ cols: 2, rows: 2 });
    expect(gridDims(4)).toEqual({ cols: 2, rows: 2 });
    expect(gridDims(5)).toEqual({ cols: 3, rows: 2 });
    expect(gridDims(6)).toEqual({ cols: 3, rows: 2 });
  });

  it('returns 0x0 for no agents', () => {
    expect(gridDims(0)).toEqual({ cols: 0, rows: 0 });
  });
});
