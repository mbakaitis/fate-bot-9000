# Gitflow and Branching

This is the day-to-day workflow: which branches exist, how work moves between them, and what deploys when. For one-time project setup, use [Using this template](https://github.com/mbakaitis/cloudflare-workers-discord-template/blob/main/docs/using-this-template.md). For cutting versions and tags, use [Versioning and changesets](versioning-and-changesets.md).

## Our approach to branches

Two branches are load-bearing: `develop` and `main`. GitHub Actions matches them by exact name (see [How branch names drive deployment](#how-branch-names-drive-deployment) below), so they are the only names that must stay fixed.

Everything else — `feature/<name>`, `release/<name>`, `hotfix/<name>` — is a naming convention, not a rule GitHub enforces. No automation reads the prefix. The convention exists so anyone scanning the branch list can tell what a branch is for at a glance, and it's kept consistent through code review rather than tooling.

| Branch | Our convention | Role | Deployment |
| --- | --- | --- | --- |
| Feature | `feature/<name>` | Short-lived local work and pull requests | None |
| Non-production | `develop` | Integration branch | `wrangler deploy --env non-prod` |
| Production | `main` | Release branch | `wrangler deploy --env production` |

`release/<name>` and `hotfix/<name>` are short-lived coordination branches for the same reason `feature/<name>` is: they signal intent to reviewers. They don't deploy directly — merge them into `develop` or `main` through a pull request, depending on what the change is for.

For the prefixed branches, we ask that names use lowercase letters, numbers, dots, underscores, or hyphens after the prefix — `feature/add-health-check` rather than `feature/AddHealthCheck` — purely for consistency. GitHub's Rulesets have a `branch_name_pattern` rule that could enforce this automatically, but that rule requires GitHub Team or Enterprise and is rejected outright on Free and Pro accounts, so this template doesn't ship it. If a branch drifts from the convention, catch it in review; it has no effect on deployment.

## How branch names drive deployment

`develop` and `main` matter because two GitHub Actions workflows are wired directly to those exact names, not because of any access restriction:

- [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) triggers on `push` to `main` or `develop` and nothing else (`on.push.branches`). Inside the job, `github.ref_name` picks the environment: a push on `main` runs `wrangler deploy --env production`, a push on `develop` runs `wrangler deploy --env non-prod`. The same expression then picks the registration scope — `main` registers the slash commands globally, `develop` registers them to the non-production test guild — in a step that runs after the deploy, so a command reaches Discord only once the Worker serving it is live. Push the same commit under a different branch name and the workflow simply never starts.
- [.github/workflows/release.yml](../.github/workflows/release.yml) triggers on `push` to `main` only, and runs the changesets version/release job described in [Versioning and changesets](versioning-and-changesets.md).
- [.github/workflows/ci.yml](../.github/workflows/ci.yml) triggers on any `pull_request`, regardless of the source or target branch name, so lint and test run for `feature/*`, `release/*`, `hotfix/*`, or anything else you open a pull request from.

That's the whole reason branch naming is "critical" for `develop` and `main` specifically: rename either one, or typo it in a push, and the matching workflow step silently doesn't run. It's a wiring concern, not a security boundary — see [Required repository policy](#required-repository-policy) below for how direct pushes are actually blocked.

## Starting work

Create the branch with the prefix that matches the work, and include the issue number when the work comes from an issue:

```sh
# New work from develop
git switch develop
git pull --ff-only
git switch -c feature/1-add-health-check

# Release coordination from develop
git switch develop
git pull --ff-only
git switch -c release/0.2.0

# Production repair from main
git switch main
git pull --ff-only
git switch -c hotfix/2-fix-authentication
```

In a commit message, reference the related issue with a GitHub closing keyword — `Fixes #1`, `Closes #1`, or `Resolves #1`:

```sh
git commit -m "Add health check; fixes #1"
```

GitHub links the issue immediately and closes it once the commit reaches the default branch, normally when the pull request merges. For an issue in another repository, use `OWNER/REPOSITORY#NUMBER`. Labels stay useful for categorization but do not determine branch names.

## The development loop

```sh
git switch develop
git pull --ff-only
git switch -c feature/my-change
npm run dev
npm test
```

Open a pull request from `feature/my-change` into `develop`. CI must pass before merging. Merging to `develop` deploys the non-production Worker.

After validating there, open a pull request from `develop` into `main`. Merging to `main` deploys production, after the GitHub `production` environment approval gate.

Keep feature branches short-lived, start each one from the latest `develop`, and never commit directly to `develop` or `main`.

## Why pull requests matter here

If you're newer to git or GitHub, a [pull request](https://docs.github.com/en/pull-requests) (PR) is a request to merge one branch into another, with a page attached for discussion. It's the mechanism that makes everything above actually happen safely:

- **It's the gate, not the merge itself.** Nothing deploys when you push to `feature/my-change` — the deploy workflow only watches `develop` and `main`. The PR is what eventually moves your commits onto one of those branches, and only after CI (`ci.yml`) has run against the proposed merge and at least one reviewer has approved.
- **It's where review happens.** Reviewers comment on specific lines, ask for changes, and approve once satisfied. [Required repository policy](#required-repository-policy) requires at least one approval and resolved review threads before GitHub allows the merge button to be used.
- **It links back to the work.** A PR shows the full diff against the target branch, keeps commit history intact, and — via closing keywords like `Fixes #1` — connects the change to the issue that prompted it.
- **Promotion is two PRs, not one.** A change goes `feature/* → develop` first (so it reaches non-production), then `develop → main` (so it reaches production) once it's been validated. Each hop is its own pull request, its own CI run, and its own deploy.

You don't need deep git fluency to work this way — `git switch`, `git pull --ff-only`, and opening a PR in the GitHub UI cover the day-to-day loop above.

## Deployment is opt-in

The deployment workflow is skipped until the GitHub Actions repository **variable** `DEPLOY_ENABLED` is set to `true`. Set it only after your project has configured its Worker names, Cloudflare secrets, and protected environments. The flag is not a secret; it only enables deployment. This template repository leaves it unset, so pushes to `main` and `develop` here skip the deploy job entirely.

## Required repository policy

Protect `develop` and `main` from direct pushes, deletion, force-pushes, and merges without a pull request and passing CI. Require at least one approving review and resolved review threads. Leave feature branches unprotected, so local development stays lightweight.

This template does not ship a committed ruleset file for that policy. An imported JSON payload can save with fewer rules than it declares — organization policy, repository ownership, and plan availability all affect what GitHub accepts — so configure the settings by hand instead, following the checklist in [Using this template](https://github.com/mbakaitis/cloudflare-workers-discord-template/blob/main/docs/using-this-template.md#6-configure-branch-protection), and verify what actually saved with `gh api repos/OWNER/REPOSITORY/rulesets` rather than trusting a file in this repository.

## Rollback

Identify the previous successful version through the Cloudflare dashboard or Wrangler deployment history. Roll back with a reviewed commit on `main`; do not hot-edit production code in the dashboard. If production deployment must be stopped while you investigate, disable the `production` GitHub environment or tighten its required reviewers.

**Slash commands do not roll back with the Worker.** The Worker and its command registration are two separate pieces of state that happen to be updated by the same job. Rolling the Worker back through the Cloudflare dashboard changes only the code; Discord still advertises whatever command list was registered last. Only another registration changes that — which is why a reverting commit on `main` is the better rollback: it redeploys the older Worker *and* re-registers the older command list, in that order, in one run.

The mismatch is survivable in both directions, and the Worker is built to make it so. A command Discord no longer advertises simply cannot be invoked. A command Discord still advertises but the rolled-back Worker no longer knows gets an ephemeral "unknown command" reply rather than an error — see [Discord bot](discord-bot.md#registering-commands). Nothing crashes; users just see a command that does not work until the two agree again.
