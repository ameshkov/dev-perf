import { Command } from 'commander';
import { registerCompileCommand } from './commands/compile.js';
import { registerReportCommand } from './commands/report.js';
import { appVersion } from './version.js';

/**
 * Registers every dev-perf command on the program: `report` builds
 * the JSON report, `compile` turns it into a markdown report with
 * charts, `version` prints the application version (the same value
 * as the `--version` flag). New commands are added here alongside
 * them.
 *
 * @param program - The commander program to register commands on.
 */
export function registerCommands(program: Command): void {
  registerReportCommand(program);
  registerCompileCommand(program);
  program
    .command('version')
    .description('Print the application version')
    .action(() => {
      process.stdout.write(`${appVersion}\n`);
    });
}
