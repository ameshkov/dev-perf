/**
 * Tests for language identification: the built-in
 * extension→language mapping and per-language contribution counting
 * from numstat paths (cloc-style, applied to contributions).
 */
import { describe, expect, it } from 'vitest';
import type { Commit } from './commits.js';
import { countLanguageContributions, languageForPath } from './languages.js';

/** A commit with the given files, for counting tests. */
function commit(files: Commit['files']): Commit {
  return {
    sha: 'abc',
    parents: [],
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    authorDate: '2026-01-01T10:00:00Z',
    subject: 'work',
    files,
    isMerge: false,
  };
}

describe('languageForPath', () => {
  it('maps common extensions to languages', () => {
    expect(languageForPath('src/app.ts')).toBe('TypeScript');
    expect(languageForPath('src/app.tsx')).toBe('TypeScript');
    expect(languageForPath('index.js')).toBe('JavaScript');
    expect(languageForPath('lib.py')).toBe('Python');
    expect(languageForPath('main.go')).toBe('Go');
    expect(languageForPath('mod.rs')).toBe('Rust');
    expect(languageForPath('Main.java')).toBe('Java');
    expect(languageForPath('util.c')).toBe('C');
    expect(languageForPath('util.h')).toBe('C/C++ Header');
    expect(languageForPath('util.cpp')).toBe('C++');
    expect(languageForPath('script.sh')).toBe('Shell');
    expect(languageForPath('index.html')).toBe('HTML');
    expect(languageForPath('style.css')).toBe('CSS');
    expect(languageForPath('README.md')).toBe('Markdown');
    expect(languageForPath('package.json')).toBe('JSON');
    expect(languageForPath('config.yaml')).toBe('YAML');
    expect(languageForPath('Cargo.toml')).toBe('TOML');
  });

  it('maps .NET project, resource, and binary files', () => {
    expect(languageForPath('src/App.csproj')).toBe('C#');
    expect(languageForPath('native/App.vcxproj')).toBe('C++');
    expect(languageForPath('Resources.resx')).toBe('XML');
    expect(languageForPath('Installer/Bundle.wxs')).toBe('XML');
    expect(languageForPath('packages.config')).toBe('Text');
    expect(languageForPath('assets/firmware.bin')).toBe('Binary');
  });

  it('maps Apple Xcode and localization files', () => {
    expect(languageForPath('project.pbxproj')).toBe('Xcode Project');
    expect(languageForPath('App.xcworkspace/contents.xcworkspacedata')).toBe('Xcode Workspace');
    expect(languageForPath('App.xcscheme')).toBe('Xcode Scheme');
    expect(languageForPath('Config.xcconfig')).toBe('Xcode Config');
    expect(languageForPath('en.lproj/Localizable.strings')).toBe('Apple Localization');
    expect(languageForPath('en.lproj/Localizable.stringsdict')).toBe('Apple Localization');
    expect(languageForPath('Info.plist')).toBe('Apple Property List');
    expect(languageForPath('App.entitlements')).toBe('Apple Entitlements');
  });

  it('maps Unity editor-serialized assets to a single Unity bucket', () => {
    expect(languageForPath('Assets/Scenes/Main.unity')).toBe('Unity');
    expect(languageForPath('Assets/Enemy.prefab')).toBe('Unity');
    expect(languageForPath('Assets/Scene.asset')).toBe('Unity');
    expect(languageForPath('Assets/Walk.anim')).toBe('Unity');
    expect(languageForPath('Assets/Walk.controller')).toBe('Unity');
    expect(languageForPath('Assets/Material.mat')).toBe('Unity');
    expect(languageForPath('Assets/Style.uss')).toBe('Unity');
    expect(languageForPath('Assets/UI.uxml')).toBe('Unity UI');
    expect(languageForPath('Assets/Gray.shadergraph')).toBe('Unity Shader');
    expect(languageForPath('Assets/Player.cs')).toBe('C#');
  });

  it('maps markup and media assets out of Unknown', () => {
    expect(languageForPath('icon.svg')).toBe('SVG');
    expect(languageForPath('schema.xsd')).toBe('XML Schema');
    expect(languageForPath('photo.png')).toBe('Image');
    expect(languageForPath('photo.jpeg')).toBe('Image');
    expect(languageForPath('font.ttf')).toBe('Font');
    expect(languageForPath('font.woff2')).toBe('Font');
    expect(languageForPath('music.ogg')).toBe('Audio');
    expect(languageForPath('clip.mp4')).toBe('Video');
    expect(languageForPath('doc.pdf')).toBe('PDF');
  });

  it('maps C-family variants, Objective-C, and module formats', () => {
    expect(languageForPath('App.m')).toBe('Objective-C');
    expect(languageForPath('App.mm')).toBe('Objective-C++');
    expect(languageForPath('impl.c++')).toBe('C++');
    expect(languageForPath('impl.h++')).toBe('C++');
    expect(languageForPath('impl.ipp')).toBe('C++');
    expect(languageForPath('impl.inl')).toBe('C/C++ Header');
    expect(languageForPath('lib.mts')).toBe('TypeScript');
    expect(languageForPath('lib.cts')).toBe('TypeScript');
  });

  it('takes the extension after the last dot of the basename', () => {
    expect(languageForPath('src/deep/dir/app.test.ts')).toBe('TypeScript');
    expect(languageForPath('a.b.c.py')).toBe('Python');
  });

  it('is case-insensitive', () => {
    expect(languageForPath('README.MD')).toBe('Markdown');
    expect(languageForPath('SRC/App.TS')).toBe('TypeScript');
    expect(languageForPath('DOCKERFILE')).toBe('Dockerfile');
  });

  it('maps well-known filenames without a useful extension', () => {
    expect(languageForPath('Dockerfile')).toBe('Dockerfile');
    expect(languageForPath('build/Dockerfile')).toBe('Dockerfile');
    expect(languageForPath('Makefile')).toBe('Makefile');
    expect(languageForPath('cmake/CMakeLists.txt')).toBe('CMake');
    expect(languageForPath('go.mod')).toBe('Go');
    expect(languageForPath('go.sum')).toBe('Go');
    expect(languageForPath('go.work')).toBe('Go');
  });

  it('maps CocoaPods and fastlane basenames to Ruby', () => {
    expect(languageForPath('Podfile')).toBe('Ruby');
    expect(languageForPath('ios/Podfile')).toBe('Ruby');
    expect(languageForPath('fastlane/Fastfile')).toBe('Ruby');
    expect(languageForPath('fastlane/Matchfile')).toBe('Ruby');
    expect(languageForPath('fastlane/Pluginfile')).toBe('Ruby');
    expect(languageForPath('Gemfile')).toBe('Ruby');
    expect(languageForPath('App.podspec')).toBe('Ruby');
  });

  it('maps Android, Kotlin/Native, and Properties tooling extensions', () => {
    expect(languageForPath('proguard-rules.pro')).toBe('Android ProGuard Config');
    expect(languageForPath('app/proguard-rules.pro')).toBe('Android ProGuard Config');
    expect(languageForPath('gradle.properties')).toBe('Properties');
    expect(languageForPath('gradle/wrapper/gradle-wrapper.properties')).toBe('Properties');
    expect(languageForPath('sentry.properties')).toBe('Properties');
    expect(languageForPath('common_native/CommonNative.def')).toBe('Kotlin/Native');
    expect(languageForPath('android.Dockerfile')).toBe('Dockerfile');
  });

  it('maps Xcode config analogues and dotfiles to Config buckets', () => {
    expect(languageForPath('App.xcworkspace/xcshareddata/WorkspaceSettings.xcsettings')).toBe(
      'Xcode Config',
    );
    expect(languageForPath('Base.lproj/Intents.intentdefinition')).toBe('Xcode Config');
    expect(languageForPath('native_code/exception/module.modulemap')).toBe('Xcode Config');
    expect(languageForPath('.gitignore')).toBe('Config');
    expect(languageForPath('.editorconfig')).toBe('Config');
    expect(languageForPath('.github/CODEOWNERS')).toBe('Config');
    expect(languageForPath('.husky/commit-msg')).toBe('Config');
    expect(languageForPath('fastlane/.env')).toBe('Config');
    // A dotfile with a recognized extension still gets its language.
    expect(languageForPath('.eslintrc.json')).toBe('JSON');
    expect(languageForPath('.template.ts')).toBe('TypeScript');
  });

  it('falls back to Unknown for unrecognized paths', () => {
    expect(languageForPath('noextension')).toBe('Unknown');
    expect(languageForPath('assets/font.raw')).toBe('Unknown');
    expect(languageForPath('texture.nomap')).toBe('Unknown');
    expect(languageForPath('custom.local.template')).toBe('Unknown');
  });
});

describe('countLanguageContributions', () => {
  it('sums lines and touched files per language across commits', () => {
    const commits = [
      commit([
        { path: 'src/app.ts', added: 2, deleted: 0 },
        { path: 'README.md', added: 1, deleted: 0 },
      ]),
      commit([
        { path: 'src/app.ts', added: 1, deleted: 1 },
        { path: 'src/util.py', added: 3, deleted: 0 },
      ]),
    ];
    expect(countLanguageContributions(commits)).toStrictEqual({
      TypeScript: { linesAdded: 3, linesRemoved: 1, filesTouched: 2 },
      Markdown: { linesAdded: 1, linesRemoved: 0, filesTouched: 1 },
      Python: { linesAdded: 3, linesRemoved: 0, filesTouched: 1 },
    });
  });

  it('counts binary files as touched with zero lines', () => {
    const commits = [commit([{ path: 'assets/logo.bin', added: undefined, deleted: undefined }])];
    expect(countLanguageContributions(commits)).toStrictEqual({
      Binary: { linesAdded: 0, linesRemoved: 0, filesTouched: 1 },
    });
  });

  it('counts commit-file pairs, not distinct paths', () => {
    const commits = [
      commit([{ path: 'src/app.ts', added: 1, deleted: 0 }]),
      commit([{ path: 'src/app.ts', added: 2, deleted: 0 }]),
    ];
    expect(countLanguageContributions(commits)).toStrictEqual({
      TypeScript: { linesAdded: 3, linesRemoved: 0, filesTouched: 2 },
    });
  });

  it('returns an empty record when nothing changed', () => {
    expect(countLanguageContributions([])).toStrictEqual({});
    expect(countLanguageContributions([commit([])])).toStrictEqual({});
  });
});
