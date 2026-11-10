# Security

QuantStat (owned by sepoH) is a static website: no server program, database, login or forms, and no personal data is collected.

- The page loads nothing from other websites; a Content Security Policy blocks outside scripts, connections and frames.
- The update job runs on GitHub Actions with only the permission it needs (writing to this repository), and the actions are pinned to exact versions.

## Reporting a problem

Please report security problems by opening an issue in this repository, or by using GitHub's private vulnerability reporting under the **Security** tab if it is enabled. Do not include personal data in a public issue.
