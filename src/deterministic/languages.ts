/**
 * Language identification: a built-in
 * extension→language map, so per-language contribution counts can be
 * computed cloc-style from numstat paths — applied to contributions,
 * not the whole tree. The map covers the common programming languages
 * plus the platform file types that otherwise flood reports as
 * `Text`/`Unknown`: Apple Xcode and localization files, Unity
 * editor-serialized assets, markup/media, and documents.
 */
import type { LanguageContribution } from '../report/index.js';
import type { Commit } from './commits.js';
import { isGeneratedPath } from './generated.js';

/** Fallback language for file paths no mapping recognizes. */
const UNKNOWN_LANGUAGE = 'Unknown';

/** Generic bucket for dotfiles and other plain config files: `.gitignore`,
 * `.editorconfig`, `CODEOWNERS`, husky hooks, and similar. They are
 * authored tools configuration, not source code, and deserve a visible
 * bucket rather than landing in `Unknown`. */
const CONFIG_LANGUAGE = 'Config';

/**
 * Extension→language map for well-known extensions (lowercased keys
 * without the leading dot).
 */
const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  c: 'C',
  h: 'C/C++ Header',
  cpp: 'C++',
  cc: 'C++',
  cxx: 'C++',
  hpp: 'C++',
  hh: 'C++',
  hxx: 'C++',
  'c++': 'C++',
  'h++': 'C++',
  ipp: 'C++',
  inl: 'C/C++ Header',
  m: 'Objective-C',
  mm: 'Objective-C++',
  vcxproj: 'C++',
  cs: 'C#',
  csproj: 'C#',
  rb: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  kt: 'Kotlin',
  kts: 'Kotlin',
  scala: 'Scala',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  fish: 'Shell',
  ps1: 'PowerShell',
  sql: 'SQL',
  html: 'HTML',
  htm: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  md: 'Markdown',
  markdown: 'Markdown',
  rst: 'reStructuredText',
  json: 'JSON',
  jsonc: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  resx: 'XML',
  wxs: 'XML',
  txt: 'Text',
  config: 'Text',
  bin: 'Binary',
  // Ruby/CocoaPods land: podspecs are Ruby DSL, so they join the Ruby
  // bucket with the extension-less `Podfile`/fastlane basenames.
  podspec: 'Ruby',
  // Android tooling config: ProGuard/R8 rules (`proguard-rules.pro`)
  // and Java-style `*.properties` (gradle.properties, sentry.properties).
  pro: 'Android ProGuard Config',
  properties: 'Properties',
  // Editorconfig files are named `*editorconfig` (`kmp.editorconfig`).
  editorconfig: 'Config',
  // Kotlin/Native cinterop definition files (`*.def`).
  def: 'Kotlin/Native',
  // Apple platform files: Xcode project/build configuration and Apple
  // resource formats — neither code nor plain text. Unity's per-asset
  // `.meta` sidecars are excluded as generated in
  // `src/deterministic/generated.ts`, not mapped to a language here.
  pbxproj: 'Xcode Project',
  xcworkspacedata: 'Xcode Workspace',
  xcscheme: 'Xcode Scheme',
  xcconfig: 'Xcode Config',
  xcsettings: 'Xcode Config',
  intentdefinition: 'Xcode Config',
  modulemap: 'Xcode Config',
  strings: 'Apple Localization',
  stringsdict: 'Apple Localization',
  plist: 'Apple Property List',
  entitlements: 'Apple Entitlements',
  // Unity editor-serialized assets: scenes, prefabs, animators, and
  // the other YAML-ish files the editor rewrites.
  unity: 'Unity',
  prefab: 'Unity',
  asset: 'Unity',
  anim: 'Unity',
  controller: 'Unity',
  overridecontroller: 'Unity',
  mat: 'Unity',
  uss: 'Unity',
  uxml: 'Unity UI',
  inputactions: 'Unity',
  asmdef: 'Unity',
  lighting: 'Unity',
  shader: 'Unity Shader',
  shadergraph: 'Unity Shader',
  // Declarative and markup formats.
  svg: 'SVG',
  xsd: 'XML Schema',
  // Authored media and document assets (contribute line counts only
  // when git reports them as text; binary media count as touched only).
  png: 'Image',
  jpg: 'Image',
  jpeg: 'Image',
  gif: 'Image',
  webp: 'Image',
  ico: 'Image',
  ttf: 'Font',
  otf: 'Font',
  woff: 'Font',
  woff2: 'Font',
  ogg: 'Audio',
  wav: 'Audio',
  mp3: 'Audio',
  aiff: 'Audio',
  m4a: 'Audio',
  mp4: 'Video',
  mov: 'Video',
  m4v: 'Video',
  webm: 'Video',
  pdf: 'PDF',
  vue: 'Vue',
  svelte: 'Svelte',
  astro: 'Astro',
  dart: 'Dart',
  lua: 'Lua',
  r: 'R',
  pl: 'Perl',
  ex: 'Elixir',
  exs: 'Elixir',
  erl: 'Erlang',
  hs: 'Haskell',
  clj: 'Clojure',
  cljs: 'ClojureScript',
  groovy: 'Groovy',
  gradle: 'Groovy',
  proto: 'Protocol Buffers',
  graphql: 'GraphQL',
  gql: 'GraphQL',
  // `Dockerfile`-suffixed files (`android.Dockerfile`, `dev.Dockerfile`).
  dockerfile: 'Dockerfile',
};

/**
 * Whole-filename→language map (lowercased keys) for files whose name
 * carries no useful extension.
 */
const FILENAME_LANGUAGES: Record<string, string> = {
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
  'cmakelists.txt': 'CMake',
  'go.mod': 'Go',
  'go.sum': 'Go',
  'go.work': 'Go',
  // CocoaPods manifest (Ruby DSL) and fastlane's Ruby scripts.
  podfile: 'Ruby',
  fastfile: 'Ruby',
  matchfile: 'Ruby',
  pluginfile: 'Ruby',
  gemfile: 'Ruby',
  // Well-known config tooling that carries no useful extension.
  codeowners: 'Config',
  'commit-msg': 'Config',
  'post-checkout': 'Config',
  'pre-push': 'Config',
};

/**
 * Maps a file path to a language name via the built-in map:
 * the basename is matched against the filename map
 * first, then the extension after its last dot. Matching is
 * case-insensitive; paths nothing matches fall back to `Unknown`.
 * Dotfiles (a basename starting with `.`, such as `.gitignore` or
 * `.editorconfig`) that no filename or extension mapping recognizes
 * land in the generic `Config` bucket instead of `Unknown`.
 *
 * @param filePath - Path as reported by git numstat.
 * @returns The language name.
 *
 * @internal Exported for tests only (`languages.test.ts` asserts the
 * mapping); used by `countLanguageContributions` within the module.
 * Not part of the public module API.
 */
export function languageForPath(filePath: string): string {
  const baseName = filePath.slice(filePath.lastIndexOf('/') + 1).toLowerCase();
  const byName = FILENAME_LANGUAGES[baseName];
  if (byName !== undefined) {
    return byName;
  }
  const dot = baseName.lastIndexOf('.');
  if (dot === -1) {
    return UNKNOWN_LANGUAGE;
  }
  const byExtension = EXTENSION_LANGUAGES[baseName.slice(dot + 1)];
  if (byExtension !== undefined) {
    return byExtension;
  }
  // A dotfile with no recognized extension (`.gitignore`, `.babelrc`)
  // is a plain config file; one with a recognized extension (`.eslintrc.
  // json`) already returned it above.
  if (baseName.startsWith('.')) {
    return CONFIG_LANGUAGE;
  }
  return UNKNOWN_LANGUAGE;
}

/**
 * Counts per-language contributions over commits:
 * `linesAdded`, `linesRemoved`, and `filesTouched` (commit-file pairs)
 * are summed per language mapped from each numstat path. Binary files
 * (no line counts) contribute zero lines but still count as touched;
 * unmapped paths land under `Unknown`. Generated files — lock files,
 * test snapshots, minified/build artifacts (`src/deterministic/
 * generated.ts`) — are excluded from the per-language counts entirely
 * and are reported separately as the `generated` deterministic stat,
 * so an auto-generated lockfile can never inflate a language bucket
 * like `YAML` or `Unknown`.
 *
 * @param commits - Commits to count over, typically one author's.
 * @returns Per-language contribution counts, keyed by language name.
 */
export function countLanguageContributions(
  commits: Commit[],
): Record<string, LanguageContribution> {
  const byLanguage = new Map<string, LanguageContribution>();
  for (const commit of commits) {
    for (const file of commit.files) {
      if (isGeneratedPath(file.path)) {
        continue;
      }
      const language = languageForPath(file.path);
      let contribution = byLanguage.get(language);
      if (contribution === undefined) {
        contribution = { linesAdded: 0, linesRemoved: 0, filesTouched: 0 };
        byLanguage.set(language, contribution);
      }
      contribution.linesAdded += file.added ?? 0;
      contribution.linesRemoved += file.deleted ?? 0;
      contribution.filesTouched += 1;
    }
  }
  return Object.fromEntries(byLanguage);
}
