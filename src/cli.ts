import { Command } from 'commander';
import { registerReportCommand } from './commands/report.js';

/**
 * Registers every dev-perf command on the program. New commands are
 * added here alongside `report` (e.g. a future `compile` command that
 * turns a JSON report into a markdown report with charts).
 *
 * @param program - The commander program to register commands on.
 */
export function registerCommands(program: Command): void {
  registerReportCommand(program);
}
