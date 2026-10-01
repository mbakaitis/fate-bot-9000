# Versioning and Changesets

This project versions itself with [Changesets](https://github.com/changesets/changesets) and Semantic Versioning. This guide explains how a change becomes a version and a Git tag. For branching, see [Gitflow and branching](gitflow-and-branching.md).

## How a release happens

1. On your feature branch, you record the impact of your change as a changeset file.
2. Your pull request merges into `main`.
3. The release workflow opens or updates a **release pull request** that collects every pending changeset.
4. Merging the release pull request bumps the version, rewrites `CHANGELOG.md`, and creates a Git tag.

Nothing is published to npm. This package is private; `npm run release` creates the tag only.

## Recording a change

Run this on your feature branch, before opening the pull request:

```sh
npm run changeset
```

Changesets asks for the release type and a summary, then writes a Markdown file into `.changeset/`. Commit that file with your pull request — it is the release note, so write it for whoever has to decide whether to adopt the change.

Check what is pending at any time:

```sh
npm run changeset:status
```

### Choosing the release type

| Type | Use it for |
| --- | --- |
| `patch` | Backward-compatible fixes, documentation, test improvements, and dependency updates that do not alter the supported contract |
| `minor` | Backward-compatible features, new optional capabilities, or new extension points |
| `major` | Breaking changes to scripts, file layout, runtime assumptions, Wrangler configuration, environments, bindings, or migration requirements |

Ask what a downstream project has to do. If the answer is "nothing," it is a patch or a minor. If the answer is "edit files, rename something, or change a command," it is major.

A changeset is not required for changes that are purely internal and do not alter the template contract. Documentation-only changes may omit one.

## The release pull request

When commits reach `main`, `.github/workflows/release.yml` runs and opens or updates a release pull request. It stays open and accumulates changesets until you merge it, so several changes can ship as one version.

Review it before merging:

- The generated version is the next version you intend.
- The release type matches the actual downstream migration requirement.
- The `CHANGELOG.md` entry explains the user-visible change and any migration steps.
- `npm run changeset:status`, `npm run lint`, and `npm test` pass.
- The `package.json` and lockfile changes are limited to the version bump.

Merging it runs `npm run version` (which applies the bumps, consumes the changeset files, and refreshes `package-lock.json`) and then `npm run release` (which creates the tag).

## Cutting a version manually

The workflow is the supported path. If you need to run it locally — for example to inspect the result before it lands — the same scripts apply:

```sh
npm run changeset:status   # what is pending
npm run version            # apply bumps, update CHANGELOG.md and the lockfile, consume changesets
npm run release            # create the Git tag
```

Run these on an up-to-date `main`, and push the resulting commit and tag through the normal reviewed path. Do not commit a version bump in a feature pull request when the automated workflow is handling releases; you will conflict with the release pull request.

## Deployment is separate

Versioning and deployment are independent. Creating a version and tag does not deploy anything, and deploying does not create a version. Deploying the resulting `main` commit is governed by the opt-in deployment workflow described in [Gitflow and branching](gitflow-and-branching.md#deployment-is-opt-in).

## What every release should state

- What changed.
- Whether downstream projects need to act.
- The migration or rollback procedure.
- The supported Node.js, Wrangler, and runtime versions.
- The validation that was performed.

## For projects built from this template

Your project may use this same Changesets workflow, and it is preconfigured for you. Your release cadence and versioning are your own — your application's bindings, deployment policy, and compatibility promises are not this template's to decide.

When you adopt an upstream release, review it as a change to your project rather than an automatic update. Read this template's `CHANGELOG.md` entry, check whether it says migration is required, and classify the effect on *your* version yourself. See [Keeping up with upstream changes](https://github.com/mbakaitis/cloudflare-workers-discord-template/blob/main/docs/using-this-template.md#10-keeping-up-with-upstream-changes).

If you make your package public or want npm publication, update the Changesets `access` and `privatePackages` settings in `.changeset/config.json`, add registry authentication through CI secrets, and review `.github/workflows/release.yml` before enabling publication. Never commit registry credentials.
