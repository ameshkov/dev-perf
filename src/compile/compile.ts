/**
 * Compile orchestration: reads and validates the input report (schema
 * v2), loads the email mappings, filters and identity-merges the
 * report, extracts the chart data, renders every chart to an SVG
 * asset, and writes `report.md`, the `assets/` directory, and one
 * per-person report per user under `people/` into the output
 * directory. Progress goes to stderr through the level-based logger;
 * stdout carries nothing but the path of the written report.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { TrendReport } from '../report/index.js';
import { trendReportSchema } from '../report/index.js';
import { errorDetail } from '../util/error.js';
import { readJsonFile } from '../util/json.js';
import { logConfig, logInfo, setVerbose } from '../util/log.js';
import { appVersion } from '../version.js';
import { buildChartData } from './chart-data.js';
import type { ChartData } from './chart-data.js';
import { buildChartAssets } from './charts.js';
import type { ChartAsset } from './chart-util.js';
import { userSlug } from './chart-util.js';
import { filterReport } from './filter.js';
import type { EmailMap } from './filter.js';
import { assembleIndividualMarkdown } from './markdown-individual.js';
import { assemblePersonMarkdown } from './markdown-person.js';
import { assembleTeamMarkdown } from './markdown.js';
import type { CompileOptions } from './options.js';
import { renderSvg } from './vega.js';

/** The name of the compiled markdown report inside the output directory. */
const REPORT_FILE = 'report.md';

/** The name of the chart assets directory inside the output directory. */
const ASSETS_DIR = 'assets';

/** The name of the per-person reports directory inside the output directory. */
const PEOPLE_DIR = 'people';

/** JSON shape of an `--maps-file`: a flat email-to-name object. */
const mapsFileSchema = z.record(z.string(), z.string());

/** The outcome of a compile run. */
export interface CompileResult {
  /** The input report file. */
  reportFile: string;
  /** The output directory. */
  outputDir: string;
  /** Path of the written markdown report. */
  reportPath: string;
  /** Path of the written chart assets directory. */
  assetsPath: string;
  /** Path of the written per-person reports directory. */
  peoplePath: string;
  /** How many charts were rendered. */
  chartCount: number;
  /** How many users the compiled report covers. */
  userCount: number;
}

/**
 * Validates the input report document against the trend report schema.
 *
 * @param reportFile - The input report file.
 * @returns The parsed report.
 * @throws {Error} When the file is missing, not valid JSON, or does
 * not match the trend report schema; the message names the file.
 */
async function loadReport(reportFile: string): Promise<TrendReport> {
  const raw = await readJsonFile(reportFile);
  const result = trendReportSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || 'report'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid report (${reportFile}):\n${details}`);
  }
  return result.data;
}

/**
 * The compiled email mappings: the `--maps-file` entries merged with
 * the `--map` entries, with the `--map` entries winning on conflict
 * (the flag wins over the file, mirroring the env resolution).
 *
 * @param options - The validated compile options.
 * @returns The email-to-name mapping.
 * @throws {Error} When the maps file is missing or not a flat
 * email-to-name object.
 */
async function loadEmailMap(options: CompileOptions): Promise<EmailMap> {
  const emailMap: EmailMap = {};
  if (options.mapsFile !== undefined) {
    const raw = await readJsonFile(options.mapsFile);
    const result = mapsFileSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(
        `Invalid maps file (${options.mapsFile}): expected an object of { "email": "Name" } entries`,
      );
    }
    for (const [email, name] of Object.entries(result.data)) {
      emailMap[email.toLowerCase()] = name;
    }
  }
  for (const entry of options.maps) {
    emailMap[entry.email] = entry.name;
  }
  return emailMap;
}

/**
 * Renders every chart of the inventory to its SVG file.
 *
 * @param assets - The chart inventory.
 * @param assetsDir - The assets directory (created here).
 * @returns The chart assets by file name.
 * @throws {Error} When a chart fails to render; the message names the
 * chart file.
 */
async function renderCharts(
  assets: ChartAsset[],
  assetsDir: string,
): Promise<Map<string, ChartAsset>> {
  await mkdir(assetsDir, { recursive: true });
  // Rendering every chart is the long step of a compile (each one is a
  // Vega compile plus render); log that the batch started so the user
  // sees what dev-perf is doing instead of a silent wait. Each finished
  // chart is logged as `rendered "<file>"`.
  logInfo(`compile: rendering ${assets.length} charts`);
  const byFile = new Map<string, ChartAsset>();
  for (const asset of assets) {
    try {
      const svg = await renderSvg(asset.spec);
      await writeFile(path.join(assetsDir, asset.file), svg, 'utf8');
      byFile.set(asset.file, asset);
      logInfo(`compile: rendered "${asset.file}"`);
    } catch (error) {
      throw new Error(`failed to render chart ${asset.file}: ${errorDetail(error)}`, {
        cause: error,
      });
    }
  }
  return byFile;
}

/**
 * Runs the compile command end to end: load and validate the input
 * report, resolve the email mappings, filter and identity-merge,
 * extract chart data, render the charts, assemble and write the
 * markdown report and the per-person reports.
 *
 * @param reportFile - The input report file (JSON, schema v2).
 * @param options - Validated compile options (see `parseCompileOptions`).
 * @returns The compile outcome.
 * @throws {Error} When the report or maps file is invalid, or a chart
 * fails to render; the message names the file or chart.
 */
export async function runCompile(
  reportFile: string,
  options: CompileOptions,
): Promise<CompileResult> {
  setVerbose(options.verbose === true);
  // The startup version line is always logged, mirroring report runs,
  // so a compile log file names the dev-perf build that produced it.
  logConfig(`dev-perf ${appVersion}`);
  const report = await loadReport(reportFile);
  logInfo(`compile: report "${reportFile}" (${report.periods.length} periods)`);
  const emailMap = await loadEmailMap(options);
  const filtered = filterReport(report, {
    repos: options.repos,
    excludeRepos: options.excludeRepos,
    includeUsers: options.includeUsers,
    excludeUsers: options.excludeUsers,
    emailMap,
  });
  const data = buildChartData(filtered);
  const outputDir = options.output;
  const assetsPath = path.join(outputDir, ASSETS_DIR);
  const assets = await renderCharts(buildChartAssets(data), assetsPath);
  const markdown = [
    assembleTeamMarkdown(data, assets),
    assembleIndividualMarkdown(data, assets, options, emailMap),
  ]
    .filter((section) => section !== '')
    .join('\n\n');
  const reportPath = path.join(outputDir, REPORT_FILE);
  await mkdir(outputDir, { recursive: true });
  await writeFile(reportPath, `${markdown}\n`, 'utf8');
  const peopleDir = await writePersonReports(data, assets, outputDir);
  logInfo(
    `compile: wrote "${reportPath}" with ${assets.size} charts for ${filtered.users.length} users`,
  );
  return {
    reportFile,
    outputDir,
    reportPath,
    assetsPath,
    peoplePath: peopleDir,
    chartCount: assets.size,
    userCount: filtered.users.length,
  };
}

/**
 * Writes one per-person markdown report per user into
 * `<output>/people/`, with slug collisions resolved by `-2`, `-3`
 * suffixes.
 *
 * @param data - The chart data.
 * @param assets - The chart assets by file name.
 * @param outputDir - The output directory.
 * @returns The path of the people directory.
 */
async function writePersonReports(
  data: ChartData,
  assets: ReadonlyMap<string, ChartAsset>,
  outputDir: string,
): Promise<string> {
  const peopleDir = path.join(outputDir, PEOPLE_DIR);
  await mkdir(peopleDir, { recursive: true });
  const usedSlugs = new Set<string>();
  for (const series of data.users) {
    const base = userSlug(series.user.name);
    let slug = base;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(slug);
    const personPath = path.join(peopleDir, `${slug}.md`);
    await writeFile(personPath, `${assemblePersonMarkdown(series, data, assets)}\n`, 'utf8');
    logInfo(`compile: wrote "${personPath}"`);
  }
  return peopleDir;
}
