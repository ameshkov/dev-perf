/**
 * Data model of the viewer's extraction layer: team points per period,
 * per-user series, repository summaries, categorical count rows, and
 * the assembled `ChartData` the whole UI renders. Mirrors the shapes
 * of the parent CLI's compile layer (`src/compile/chart-data.ts`).
 */
import type { ContributionSize, LlmAnalysis, PeriodUnit, RepoSpec, User } from '../report/index.js';

/** One counted categorical value, e.g. a pie slice or a tag. */
export interface CountRow {
  /** The category name. */
  key: string;
  /** How often the category occurs. */
  value: number;
}

/** Team-level series of one period. */
export interface TeamPoint {
  /** Commits in the period. */
  commits: number;
  /** Cumulative commits up to and including the period. */
  cumulativeCommits: number;
  /** Lines added in the period. */
  linesAdded: number;
  /** Lines removed in the period. */
  linesRemoved: number;
  /** Users with at least one commit in the period. */
  activeUsers: number;
  /** LLM-assessed contributions in the period. */
  contributions: number;
  /** Cumulative contributions up to and including the period. */
  cumulativeContributions: number;
  /** Size-weighted contribution points in the period. */
  weightedPoints: number;
  /** Contributions per size in the period. */
  sizes: Record<ContributionSize, number>;
  /** Contributions per complexity level in the period. */
  complexity: Record<string, number>;
  /** Contributions per work type in the period (multi-type
   * contributions count in each of their types). */
  workTypes: Record<string, number>;
  /** Lines added per language in the period. */
  languages: Record<string, number>;
}

/** One repository's commit count of a user. */
interface UserRepoCount {
  /** The repository as given on the command line. */
  repo: string;
  /** The user's commits in the repository across all periods. */
  commits: number;
}

/** Per-user series: totals plus one point per period. */
export interface UserSeries {
  /** The master user entry (totals across the whole report). */
  user: User;
  /** Per-period points, aligned with the periods of the report. */
  points: TeamPoint[];
  /** Per-period LLM quality-signal and risk-flag tallies, aligned
   * with `points`; each entry counts the contributions carrying each
   * value (once per contribution). */
  signals: {
    /** Quality signals per period, most frequent first. */
    quality: CountRow[][];
    /** Risk flags per period, most frequent first. */
    risk: CountRow[][];
  };
  /** Per-period LLM analyses, aligned with `points`: the merged user
   * entry of that period; a skipped analysis when the user has no
   * analysis in the period. */
  periodLlm: LlmAnalysis[];
  /** Commit counts per analyzed repository, most commits first. */
  repos: UserRepoCount[];
}

/** One repository of the report, aggregated across periods. */
export interface RepoSummary {
  /** The repository as given on the command line. */
  repo: string;
  /** Commits across all periods. */
  commits: number;
  /** Distinct user identities across all periods. */
  users: number;
  /** LLM-assessed contributions across all periods. */
  contributions: number;
  /** Size-weighted points of the contributions across all periods. */
  points: number;
  /** Top languages by lines added, best first (top 3). */
  topLanguages: Array<{ language: string; linesAdded: number }>;
  /** Commits per period, aligned with the periods of the report. */
  perPeriodCommits: number[];
}

/** One period's identity: bounds and a short label for chart axes. */
export interface PeriodInfo {
  /** Period start (UTC instant, inclusive). */
  since: string;
  /** Period end (UTC instant, inclusive). */
  until: string;
  /** Short axis label, e.g. `2026-01` for a month unit. */
  label: string;
}

/** Team totals of the whole report. */
interface TeamTotals {
  /** Commits across all users and periods. */
  commits: number;
  /** LLM-assessed contributions across all users. */
  contributions: number;
  /** Size-weighted contribution points across all users. */
  weightedPoints: number;
  /** Lines added across all users. */
  linesAdded: number;
  /** Lines removed across all users. */
  linesRemoved: number;
  /** Net lines (added minus removed). */
  netLines: number;
  /** Files touched across all users. */
  filesTouched: number;
  /** Users with at least one commit. */
  activeUsers: number;
}

/** The fewest users covering half of the commits. */
interface BusFactor {
  /** Users covering at least half of the commits, fewest first. */
  users: string[];
  /** Their combined share of commits, 0..1. */
  commitShare: number;
}

/** Everything the viewer's sections render. */
export interface ChartData {
  /** Report parameters plus the generation timestamp. */
  parameters: {
    /** Repositories analyzed, as full specs, in input order. */
    repos: RepoSpec[];
    /** Start of the analyzed range (UTC instant). */
    since: string;
    /** End of the analyzed range (UTC instant). */
    until: string;
    /** Period unit, absent when the range is one period. */
    unit?: PeriodUnit;
    /** Whether LLM analysis was enabled. */
    llmEnabled: boolean;
    /** Model used for LLM analysis. */
    model?: string;
    /** When the report was generated (ISO 8601, UTC). */
    generatedAt: string;
  };
  /** Period identities, oldest first. */
  periods: PeriodInfo[];
  /** Team-level points, one per period. */
  team: TeamPoint[];
  /** Per-repository summaries, sorted by contributions descending. */
  repos: RepoSummary[];
  /** Per-user series, one per master user. */
  users: UserSeries[];
  /** Top languages by total lines added, best first (chart order). */
  topLanguages: string[];
  /** LLM pies: work types, sizes, complexity. */
  pies: {
    /** Contributions per work type (multi-type contributions count in each). */
    workTypes: CountRow[];
    /** Contributions per size. */
    sizes: CountRow[];
    /** Contributions per complexity level. */
    complexity: CountRow[];
  };
  /** Aggregate LLM quality-signal and risk-flag tallies: how many
   * contributions carry each value (counted once per contribution). */
  tallies: {
    /** Quality signals, most frequent first. */
    quality: CountRow[];
    /** Risk flags, most frequent first. */
    risk: CountRow[];
  };
  /** Per-period LLM quality-signal and risk-flag tallies, aligned
   * with `periods`; each entry counts the contributions carrying
   * each value (once per contribution). */
  signals: {
    /** Quality signals per period, most frequent first. */
    quality: CountRow[][];
    /** Risk flags per period, most frequent first. */
    risk: CountRow[][];
  };
  /** Team totals. */
  totals: TeamTotals;
  /** Bus factor, or `undefined` when there are no commits. */
  busFactor?: BusFactor;
}
