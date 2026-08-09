# Retry after a session limit

The previous analysis attempt hit {{limit}} and was aborted before it
could finish. It is now retried with a fresh session and a fresh
budget.

Be less thorough but faster: keep the exploration shallow, avoid
re-reading the commits or re-running commands, and call the
devperf_report tool with a correct but lighter-weight analysis as soon
as you have enough. A faster, shallower analysis is better than another
thorough one that hits the limit again.
