/**
 * A request from the navigation panel to jump to one period's
 * contribution group in the selected user's contribution list. The
 * monotonic `salt` makes a repeat jump to the same period still
 * trigger a scroll: the panel bumps it on every navigation.
 */
export interface PeriodJump {
  /** The report period index. */
  index: number;
  /** Monotonic tag, bumped on every navigation. */
  salt: number;
}
