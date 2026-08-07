import { Command } from 'commander';
import { parseCompileOptions, resolveCompileOptions, runCompile } from '../compile/index.js';
import type { CompileResult } from '../compile/index.js';
import { resolveDevPerfConfig } from '../config-file.js';
import type { DevPerfConfig } from '../config-file.js';

/**
 * Registers the `compile` command on the program: it turns a JSON
 * report (as written by `report`) into a markdown report with charts,
 * writing `report.md` and the chart SVGs into an output directory. All
 * settings — the input report (`compile.report`), the output directory,
 * user and repository selection, and email mappings — come from the
 * YAML config file; `--config <path>` selects it, else `./config.yaml`
 * auto-loads when it exists.
 *
 * @param program - The commander program to register the command on.
 */
export function registerCompileCommand(program: Command): void {
  program
    .command('compile')
    .description('Compile a JSON report into a markdown report with charts')
    .option('--config <path>', 'YAML config file (default: ./config.yaml when it exists)')
    .addHelpText('after', '\nAll settings come from the YAML config file (see README).\n')
    .action(async (options: { config?: string }) => {
      const { config } = await resolveDevPerfConfig(options.config);
      await runCompilation(config);
    });
}

/**
 * Runs the compile pipeline: map the config file to the compile
 * options, validate them, then read the report, filter and merge
 * identities, render the charts and write `report.md` with the assets
 * into the output directory. The written report path is printed to
 * stdout.
 *
 * @param config - The validated config file (empty when no file is in
 * effect).
 * @throws {Error} When the options fail validation, the report is
 * invalid, or a chart fails to render.
 */
async function runCompilation(config: DevPerfConfig): Promise<void> {
  const parsed = parseCompileOptions(resolveCompileOptions(config));
  const result: CompileResult = await runCompile(parsed.report, parsed);
  // stdout carries nothing but the path of the written report.
  process.stdout.write(`${result.reportPath}\n`);
}
