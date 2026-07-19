export interface Dims {
  cols: number;
  rows: number;
}

// Wide auto-grid: rows = floor(sqrt(n)), cols = ceil(n/rows) — prefers more
// columns than rows, so e.g. 8 agents lay out 4×2 rather than 3×3.
export function gridDims(n: number): Dims {
  if (n <= 0) return { cols: 0, rows: 0 };
  const rows = Math.max(1, Math.floor(Math.sqrt(n)));
  const cols = Math.ceil(n / rows);
  return { cols, rows };
}
