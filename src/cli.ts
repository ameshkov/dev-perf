import { Command } from 'commander';
import { registerCompileCommand } from './commands/compile.js';
import { registerReportCommand } from './commands/report.js';

/**
 * Registers every dev-perf command on the program: `report` builds
 * the JSON report, `compile` turns it into a markdown report with
 * charts. New commands are added here alongside them.
 *
 * @param program - The commander program to register commands on.
 */
export function registerCommands(program: Command): void {
  registerReportCommand(program);
  registerCompileCommand(program);
}
