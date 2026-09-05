import { describe, expect, test } from 'bun:test';

import { changesBetween } from './Changes';
import { diffHunks, diffStats, lineDiff } from './diff';

describe('lineDiff', () => {
  test('identical inputs are all context', () => {
    const lines = lineDiff('a\nb\nc\n', 'a\nb\nc\n');
    expect(lines.every((l) => l.kind === 'ctx')).toBe(true);
    expect(diffStats(lines)).toEqual({ added: 0, removed: 0 });
    expect(diffHunks(lines)).toEqual([]);
  });

  test('an edit in the middle keeps both line numberings', () => {
    const lines = lineDiff('a\nb\nc\nd\n', 'a\nB\nc\nd\ne\n');
    expect(lines.map((l) => `${l.kind}:${l.text}`)).toEqual([
      'ctx:a', 'del:b', 'add:B', 'ctx:c', 'ctx:d', 'add:e',
    ]);
    const del = lines.find((l) => l.kind === 'del');
    const add = lines.find((l) => l.kind === 'add');
    expect(del?.oldNo).toBe(2);
    expect(add?.newNo).toBe(2);
    expect(lines[lines.length - 1].newNo).toBe(5);
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
  });

  test('empty sides are whole additions or deletions', () => {
    expect(lineDiff('', 'x\ny\n').map((l) => l.kind)).toEqual(['add', 'add']);
    expect(lineDiff('x\ny\n', '').map((l) => l.kind)).toEqual(['del', 'del']);
  });

  test('a trailing newline is not an extra line', () => {
    expect(lineDiff('a\n', 'a').map((l) => l.kind)).toEqual(['ctx']);
  });
});

describe('diffHunks', () => {
  test('far-apart changes become separate hunks with context', () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 2', 'LINE 2').replace('line 25', 'LINE 25');
    const hunks = diffHunks(lineDiff(before, after));
    expect(hunks.length).toBe(2);
    expect(hunks[0].oldStart).toBe(1); // 2 lines of context before line 3
    expect(hunks[0].lines.filter((l) => l.kind === 'ctx').length).toBeLessThanOrEqual(6);
    expect(hunks[1].lines.some((l) => l.text === 'LINE 25')).toBe(true);
  });

  test('close changes share one hunk', () => {
    const before = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n');
    const after = before.replace('l2', 'L2').replace('l5', 'L5');
    expect(diffHunks(lineDiff(before, after)).length).toBe(1);
  });
});

describe('changesBetween', () => {
  test('classifies added, removed and modified files and skips unchanged ones', () => {
    const changes = changesBetween(
      { '/a.tsx': '1', '/b.tsx': 'same', '/c.tsx': 'old' },
      { '/b.tsx': 'same', '/c.tsx': 'new', '/d.tsx': 'fresh' },
    );
    expect(changes.map((c) => `${c.status}:${c.path}`)).toEqual([
      'removed:/a.tsx', 'modified:/c.tsx', 'added:/d.tsx',
    ]);
  });
});
