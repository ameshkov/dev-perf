/**
 * Generated-file classification: a path-based
 * heuristic that flags files a dependency manager, test runner, or
 * build tool produced, following the pattern GitHub's Linguist uses
 * for its `generated` attribute. Generated files are excluded from the
 * per-language metrics (they are machine output, not authored code in
 * whatever language their extension suggests), but they still count
 * toward the aggregate line, file, and commit totals and are reported
 * separately as the per-user and per-repository `generated` stats so
 * the dependency-churn activity is not hidden.
 *
 * Detection is path-only (git numstat paths), like the language
 * mapping; Linguist additionally sniffs file *content* (minified JS is
 * flagged by average line length, `DO NOT EDIT` headers by probes).
 * Content probes are a deliberate future extension: the deterministic
 * layer currently sees only paths.
 */ import type { LanguageContribution } from '../report/index.js';
import type { Commit } from './commits.js';

/** Lock-file basenames a package manager writes, at any depth. */
const LOCK_FILE_BASENAMES = new Set([
  'pnpm-lock.yaml',
  'pnpm-lock.yml',
  'yarn.lock',
  'yarn.lockb',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'bun.lock',
  'bun.lockb',
  'bun.lock.text',
  'composer.lock',
  'cargo.lock',
  'cargo.toml.orig',
  'gemfile.lock',
  'podfile.lock',
  'pipfile.lock',
  'poetry.lock',
  'pdm.lock',
  'uv.lock',
  'pixi.lock',
  'esy.lock',
  'deno.lock',
  'deno.lock.json',
  'flake.lock',
  'module.bazel.lock',
  'go.sum',
  'go.work.sum',
  'gopkg.lock',
  'glide.lock',
  'package.resolved',
  '.terraform.lock.hcl',
]);

/** Named build-tool outputs and wrappers, at any depth. */
const GENERATED_BASENAMES = new Set([
  'lcov.info',
  '.pnp.cjs',
  '.pnp.js',
  '.pnp.loader.mjs',
  'gradlew',
  'gradlew.bat',
  'mvnw',
  'mvnw.cmd',
]);

/** Dependency/vendored directory names whose whole subtree is generated. */
const GENERATED_DIR_SEGMENTS = [
  'node_modules',
  '.pnpm',
  'jspm_packages',
  'godeps',
  'htmlcov',
  'pods',
];

/** Go vendor directories pinned by `go mod vendor` — the first segment
 * after `vendor/` is the module's import-path domain (`vendor/github.
 * com/...`). */
const VENDORED_DOMAIN_PATTERN = /(?:^|\/)vendor\/[^/]+\.[^/]+\//;

/** Minified JS/CSS named with the conventional `.min.` segment. */
const MINIFIED_PATTERN = /\.min\.(?:js|mjs|cjs|css)$/;

/** Unity editor-generated `.meta` sidecars, one per imported asset
 * (`Assets/Sprites/hero.png` gets `hero.png.meta` with its GUID and
 * importer settings); they churn on every asset add or move. */
const UNITY_META_SUFFIX = '.meta';

/** Source maps named after their source (`app.js.map`). */
const SOURCE_MAP_PATTERN = /\.(?:js|mjs|cjs|css|ts|tsx)\.map$/;

/** Compiler/designer codegen suffixes (`.designer.cs`, `.g.cs`, …). */
const CODEGEN_SUFFIXES = [
  '.designer.cs',
  '.designer.vb',
  '.g.cs',
  '.g.i.cs',
  '.generated.cs',
  '.feature.cs',
];

/**
 * Whether a file path is generated per the built-in path heuristic:
 * the basename is matched against the lock-file and named-generated
 * sets, snapshot, Unity `.meta` sidecar, and minified/source-map
 * suffixes, then the path is checked for generated
 * dependency/vendored directory segments and codegen suffixes.
 * Matching is case-insensitive.
 *
 * @param filePath - Path as reported by git numstat.
 * @returns True when the file is a lock file, test snapshot, Unity
 * `.meta` sidecar, minified or source-map artifact, vendored
 * dependency, or compiler output.
 */
export function isGeneratedPath(filePath: string): boolean {
  const lowered = filePath.toLowerCase();
  const baseName = lowered.slice(lowered.lastIndexOf('/') + 1);
  if (LOCK_FILE_BASENAMES.has(baseName) || GENERATED_BASENAMES.has(baseName)) {
    return true;
  }
  if (baseName.endsWith('.snap')) {
    return true;
  }
  if (baseName.endsWith(UNITY_META_SUFFIX)) {
    return true;
  }
  if (MINIFIED_PATTERN.test(baseName) || SOURCE_MAP_PATTERN.test(baseName)) {
    return true;
  }
  if (CODEGEN_SUFFIXES.some((suffix) => baseName.endsWith(suffix))) {
    return true;
  }
  if (VENDORED_DOMAIN_PATTERN.test(lowered)) {
    return true;
  }
  return GENERATED_DIR_SEGMENTS.some(
    (segment) => lowered.startsWith(`${segment}/`) || lowered.includes(`/${segment}/`),
  );
}

/**
 * Counts the contribution of the generated files of one author's
 * commits: `linesAdded`, `linesRemoved`, and `filesTouched`
 * (commit-file pairs) summed over the files `isGeneratedPath` flags.
 * The same classifier keeps generated files out of the per-language
 * counts; this is the separate bucket that keeps the activity visible.
 *
 * @param commits - Commits to count over, typically one author's.
 * @returns The generated-file contribution, or `undefined` when none
 * of the commits touched a generated file.
 */
export function countGeneratedContribution(
  commits: readonly Commit[],
): LanguageContribution | undefined {
  let contribution: LanguageContribution | undefined;
  for (const commit of commits) {
    for (const file of commit.files) {
      if (!isGeneratedPath(file.path)) {
        continue;
      }
      contribution ??= { linesAdded: 0, linesRemoved: 0, filesTouched: 0 };
      contribution.linesAdded += file.added ?? 0;
      contribution.linesRemoved += file.deleted ?? 0;
      contribution.filesTouched += 1;
    }
  }
  return contribution;
}
