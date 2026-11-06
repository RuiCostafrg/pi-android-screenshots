# Local CI — `gh-signoff` (Linux only)

Run the CI checks on your own machine and post a green `signoff/tests` commit
status with [basecamp/gh-signoff](https://github.com/basecamp/gh-signoff).

Use it when free Actions minutes run out — or as a fast pre-push gate. The GitHub
Actions workflows stay untouched; this lane covers **Linux only**.

## Setup (Linux)

```bash
gh auth login
gh extension install basecamp/gh-signoff
```

Toolchains: Node ≥ 22.

## Usage

```bash
scripts/local-ci.sh                # stages: tests
scripts/local-ci.sh --no-signoff   # checks only, no statuses posted
```

Push your commits first: `gh signoff` only attests pushed work. A failing stage
posts a red `signoff/tests` status automatically.

## Optional: make sign-off a merge requirement

```bash
gh signoff install tests
gh signoff uninstall
```
