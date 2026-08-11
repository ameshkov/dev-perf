/**
 * Tests for generated-file classification: the path heuristic
 * (`isGeneratedPath`) and the separate generated contribution counter
 * (`countGeneratedContribution`).
 */
import { describe, expect, it } from 'vitest';
import type { Commit } from './commits.js';
import { countGeneratedContribution, isGeneratedPath } from './generated.js';

/** A commit with defaults, for unit tests that override only what matters. */
function commit(overrides: Partial<Commit> = {}): Commit {
  return {
    sha: 'abc',
    parents: [],
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    authorDate: '2026-01-01T10:00:00Z',
    subject: 'work',
    files: [],
    isMerge: false,
    ...overrides,
  };
}

describe('isGeneratedPath', () => {
  it.each([
    // Lock files the package managers write, at any depth.
    ['pnpm-lock.yaml', true],
    ['packages/app/pnpm-lock.yaml', true],
    ['yarn.lock', true],
    ['package-lock.json', true],
    ['npm-shrinkwrap.json', true],
    ['bun.lockb', true],
    ['composer.lock', true],
    ['Cargo.lock', true],
    ['Gemfile.lock', true],
    ['Pipfile.lock', true],
    ['poetry.lock', true],
    ['uv.lock', true],
    ['deno.lock', true],
    ['flake.lock', true],
    ['go.sum', true],
    ['go.work.sum', true],
    ['Package.resolved', true],
    ['sub/module.bazel.lock', true],
    ['vendor/.terraform.lock.hcl', true],
    // Test snapshots written by snapshot runners.
    ['test/__snapshots__/app.test.js.snap', true],
    ['core/version.test.js.snap', true],
    // Minified and source-map artifacts.
    ['dist/app.min.js', true],
    ['public/main.min.css', true],
    ['dist/app.js.map', true],
    ['src/compiled/components.tsx.map', true],
    // Vendored dependency subtrees.
    ['node_modules/pkg/index.js', true],
    ['src/node_modules/pkg/index.js', true],
    ['node_modules/.pnpm/pkg/index.js', true],
    ['vendor/github.com/spkg/library.go', true],
    ['Godeps/_workspace/src/github.com/x/y.go', true],
    ['htmlcov/index.html', true],
    ['Pods/Test/Pod.h', true],
    // Compiler and designer codegen.
    ['src/View.Designer.cs', true],
    ['obj/App.g.cs', true],
    ['specs/Scenario.feature.cs', true],
    // Named build-tool outputs.
    ['lcov.info', true],
    ['.pnp.cjs', true],
    ['gradlew', true],
    ['mvnw.cmd', true],
    // Unity editor-generated `.meta` sidecars, one per imported asset.
    ['Assets/Sprites/hero.png.meta', true],
    ['Assets/GameData/Scenes/Main.unity.meta', true],
    ['Assets/Scripts/Player.cs.meta', true],
    // Handwritten code and config stay.
    ['src/app.ts', false],
    ['src/app.tsx', false],
    ['README.md', false],
    ['config.yaml', false],
    ['docker-compose.yml', false],
    ['src/styles.css', false],
    ['app.js', false],
    ['main.css', false],
    ['components/map.ts', false],
    ['data.bin', false],
    ['go.mod', false],
    ['go.work', false],
    ['Makefile', false],
    ['Dockerfile', false],
    // Unity assets themselves are authored, only their `.meta` is not.
    ['Assets/Sprites/hero.png', false],
    ['Assets/GameData/Scenes/Main.unity', false],
    ['Assets/Scripts/Player.cs', false],
  ])('classifies %s', (filePath, expected) => {
    expect(isGeneratedPath(filePath)).toBe(expected);
  });
});

describe('countGeneratedContribution', () => {
  it('sums lines and files of generated paths only', () => {
    const contribution = countGeneratedContribution([
      commit({
        files: [
          { path: 'src/app.ts', added: 5, deleted: 0 },
          { path: 'pnpm-lock.yaml', added: 12, deleted: 4 },
        ],
      }),
      commit({
        sha: '2',
        authorDate: '2026-01-02T11:00:00Z',
        files: [
          { path: 'package-lock.json', added: 3, deleted: 0 },
          { path: 'test/app.test.js.snap', added: undefined, deleted: undefined },
        ],
      }),
    ]);
    expect(contribution).toStrictEqual({
      linesAdded: 15,
      linesRemoved: 4,
      filesTouched: 3,
    });
  });

  it('returns undefined when no generated file was touched', () => {
    expect(
      countGeneratedContribution([
        commit({ files: [{ path: 'src/app.ts', added: 1, deleted: 0 }] }),
      ]),
    ).toBeUndefined();
  });

  it('counts binary generated files as touched with no lines', () => {
    expect(
      countGeneratedContribution([
        commit({ files: [{ path: 'assets/app.min.js', added: undefined, deleted: undefined }] }),
      ]),
    ).toStrictEqual({ linesAdded: 0, linesRemoved: 0, filesTouched: 1 });
  });
});
