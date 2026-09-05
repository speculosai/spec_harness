/**
 * A line diff, for the file viewer and the version timeline.
 *
 * Small on purpose: generated apps are a handful of files of a few hundred lines,
 * so a plain LCS over lines is exact and fast enough, and it has no dependency. Very
 * large inputs fall back to "everything changed" rather than freezing the tab - the
 * viewer still shows both sides, it just cannot line them up.
 */

/** One line of a diff: unchanged context, an addition, or a deletion. */
export interface DiffLine {
  kind: 'ctx' | 'add' | 'del';
  text: string;
  /** 1-based line number on the old side, for context and deletions. */
  oldNo?: number;
  /** 1-based line number on the new side, for context and additions. */
  newNo?: number;
}

/** A run of diff lines with the unchanged context around it, like a unified hunk. */
export interface DiffHunk {
  lines: DiffLine[];
  oldStart: number;
  newStart: number;
}

/** Beyond this many cell comparisons the LCS is skipped (see module note). */
const MAX_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  // A trailing newline is not an extra empty line.
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** The full line diff of `before` -> `after`. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const out: DiffLine[] = [];

  // Trim the common prefix and suffix first: most edits touch a few lines in the
  // middle of a file, and this keeps the LCS table small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  for (let i = 0; i < start; i += 1) out.push({ kind: 'ctx', text: a[i], oldNo: i + 1, newNo: i + 1 });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  if (n > 0 && m > 0 && n * m <= MAX_CELLS) {
    // Classic LCS table, then walk it back to emit an aligned sequence.
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        table[i * width + j] =
          midA[i] === midB[j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        out.push({ kind: 'ctx', text: midA[i], oldNo: start + i + 1, newNo: start + j + 1 });
        i += 1;
        j += 1;
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        out.push({ kind: 'del', text: midA[i], oldNo: start + i + 1 });
        i += 1;
      } else {
        out.push({ kind: 'add', text: midB[j], newNo: start + j + 1 });
        j += 1;
      }
    }
    for (; i < n; i += 1) out.push({ kind: 'del', text: midA[i], oldNo: start + i + 1 });
    for (; j < m; j += 1) out.push({ kind: 'add', text: midB[j], newNo: start + j + 1 });
  } else {
    for (let i = 0; i < n; i += 1) out.push({ kind: 'del', text: midA[i], oldNo: start + i + 1 });
    for (let j = 0; j < m; j += 1) out.push({ kind: 'add', text: midB[j], newNo: start + j + 1 });
  }

  const tail = a.length - endA;
  for (let k = 0; k < tail; k += 1) {
    out.push({ kind: 'ctx', text: a[endA + k], oldNo: endA + k + 1, newNo: endB + k + 1 });
  }
  return out;
}

/** Group a diff into hunks, keeping `context` unchanged lines around each change. */
export function diffHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffLine[] | null = null;
  let trailing = 0;

  const flush = (): void => {
    if (!current || !current.length) return;
    const first = current[0];
    hunks.push({ lines: current, oldStart: first.oldNo ?? first.newNo ?? 1, newStart: first.newNo ?? first.oldNo ?? 1 });
    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.kind === 'ctx') {
      if (current) {
        if (trailing < context) {
          current.push(line);
          trailing += 1;
        } else {
          // Look ahead: if another change is within reach, keep the context joined.
          let next = -1;
          for (let k = i + 1; k <= i + context && k < lines.length; k += 1) {
            if (lines[k].kind !== 'ctx') {
              next = k;
              break;
            }
          }
          if (next !== -1) {
            current.push(line);
          } else {
            flush();
          }
        }
      }
      continue;
    }
    if (!current) {
      current = [];
      for (let k = Math.max(0, i - context); k < i; k += 1) current.push(lines[k]);
    }
    current.push(line);
    trailing = 0;
  }
  flush();
  return hunks;
}

/** How many lines were added and removed. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === 'add') added += 1;
    else if (line.kind === 'del') removed += 1;
  }
  return { added, removed };
}
