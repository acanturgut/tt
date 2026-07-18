export interface Dims {
  cols: number;
  rows: number;
}

// Near-square auto-grid: cols = ceil(sqrt(n)), rows = ceil(n/cols).
export function gridDims(n: number): Dims {
  if (n <= 0) return { cols: 0, rows: 0 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}
