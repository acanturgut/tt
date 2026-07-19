// Data shapes returned by the Rust git_* commands (serde camelCase).
export interface FileEntry {
  path: string;
  origPath?: string;
  x: string;
  y: string;
  staged: boolean;
  unstaged: boolean;
}
export interface GitStatus {
  repo: boolean;
  toplevel: string;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: FileEntry[];
}
export interface GitRef {
  name: string;
  kind: 'head' | 'branch' | 'remote' | 'tag';
}
export interface Commit {
  hash: string;
  parents: string[];
  refs: GitRef[];
  author: string;
  relDate: string;
  subject: string;
}
export interface Worktree {
  path: string;
  branch: string;
  head: string;
  detached: boolean;
  bare: boolean;
  dirty: number;
  ahead: number;
  behind: number;
}
export interface RunningAgent {
  id: string;
  name: string;
  dir: string;
  status: string;
}

export interface Edge {
  from: number;
  to: number;
  color: number;
}
export interface GraphRow {
  commit: Commit;
  lane: number;
  color: number;
  cols: number;
  edges: Edge[];
}

export const LANE_COLORS = 8; // git.ts maps a color index → a CSS palette entry

// Assign each commit a lane (column) and the edges connecting it to its neighbours.
// Commits must be in the order git returns them (newest first, children before parents).
// Standard "swimlane" algorithm: a lane holds the hash it is currently heading toward.
export function layoutGraph(commits: Commit[]): GraphRow[] {
  const rows: GraphRow[] = [];
  const lanes: (string | null)[] = []; // lane -> hash it expects next
  const colors: number[] = [];
  let nextColor = 0;
  const newColor = () => nextColor++ % LANE_COLORS;

  const firstFree = (): number => {
    const i = lanes.indexOf(null);
    if (i !== -1) return i;
    lanes.push(null);
    colors.push(0);
    return lanes.length - 1;
  };

  for (const c of commits) {
    let lane = lanes.indexOf(c.hash);
    if (lane === -1) {
      lane = firstFree();
      colors[lane] = newColor(); // a branch tip not yet referenced → fresh colour
    }
    const color = colors[lane];

    const incoming = lanes.slice();
    const incomingColors = colors.slice();

    // Other lanes also waiting for this commit converge here.
    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && lanes[i] === c.hash) lanes[i] = null;
    }

    // Route parents, remembering which lane each took, so the node→parent edges
    // use THIS commit's assigned lanes — not the first lane that happens to share
    // the hash (that double-drew a zigzag when a merge parent already had a lane).
    const parentLanes: number[] = [];
    if (c.parents.length === 0) {
      lanes[lane] = null; // root commit: this lane ends
    } else {
      lanes[lane] = c.parents[0];
      parentLanes[0] = lane; // first parent continues this commit's own lane
      for (let k = 1; k < c.parents.length; k++) {
        const ph = c.parents[k];
        let pl = lanes.indexOf(ph);
        if (pl === -1) {
          pl = firstFree();
          colors[pl] = newColor();
          lanes[pl] = ph;
        }
        parentLanes[k] = pl;
      }
    }

    // Edges: incoming lanes (top of the band) → their position after this row (bottom).
    const edges: Edge[] = [];
    for (let i = 0; i < incoming.length; i++) {
      const h = incoming[i];
      if (h === null) continue;
      if (h === c.hash) {
        edges.push({ from: i, to: lane, color: incomingColors[i] }); // converges into this commit's node
      } else {
        // An unrelated lane heading to some other commit: it runs straight down its OWN column
        // (it converges only later, at the row of the commit it points to). Using indexOf(h) here
        // was the bug — for two lanes sharing a parent it returned the leftmost, so the right lane
        // drew a diagonal toward it every row (the stray hooks).
        edges.push({ from: i, to: i, color: incomingColors[i] });
      }
    }
    // Node → each parent's assigned lane (downward).
    parentLanes.forEach((to, k) => {
      edges.push({ from: lane, to, color: k === 0 ? color : colors[to] });
    });

    const cols = Math.max(incoming.length, lanes.length);
    rows.push({ commit: c, lane, color, cols, edges });

    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop();
      colors.pop();
    }
  }
  return rows;
}

// The running agent (if any) whose working dir sits inside this worktree.
export function agentForWorktree(agents: RunningAgent[], wtPath: string): RunningAgent | undefined {
  const base = wtPath.replace(/\/$/, '');
  return agents.find((a) => a.dir === base || a.dir.startsWith(base + '/'));
}
