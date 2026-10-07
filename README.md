# Git Graph Standalone

A fast, modern desktop Git client built around a clear commit graph. Browse your repositories, see the full history at a glance, stage and commit, resolve merge conflicts, and run the everyday Git actions from the graph - no subscription, no IDE required.

## Features

- **Repository hub** - one place to open, clone, create and organise all your repositories.
- **Commit graph** - branches, merges, tags and stashes, with search and per-commit details.
- **Working copy** - stage / unstage / discard, amend, commit (and push), stash.
- **AI commit messages** - the ✨ button next to the commit summary asks your own [Claude Code](https://claude.com/claude-code) CLI to write the summary and description from your staged changes (the CLI must be installed and signed in; set `claudeCli.model` / `claudeCli.path` in `config.json` to change the model or location, default model is `haiku`).
- **Sidebar** - local and remote branches, tags and stashes; double-click to check out, hover for merge / delete.
- **Merge conflict resolver** - side-by-side ours / theirs with an editable result; continue, skip or abort the merge, rebase, cherry-pick or revert.
- **Graph actions** - checkout, create / rename / delete branches, merge, rebase, cherry-pick, revert, reset, tags, fetch / pull / push, pull-request links.
- **Auto update** - new releases are picked up from GitHub Releases.

## Requirements

- Windows, macOS or Linux
- [Git](https://git-scm.com/) 2.13+ on your `PATH`
- To build from source: Node.js 20+

## Build from source

The repository has two parts: `electron/` (the app: main process, preload, UI shell) and `web/` (the graph renderer, compiled into `media/`).

```bash
# one-time
npm --prefix electron ci
npm ci

# run the app
npm start

# build an installer into electron/release/
npm run dist
```

Useful scripts (from the repository root): `npm run lint`, `npm run build:main`, `npm run build:web`, `npm run compile` (all three).

## Releases

Every push to `develop` checks `electron/package.json`'s `version`. If no release `v<version>` exists yet, GitHub Actions builds the Windows installer and publishes it. To ship a new version, bump the version (in `electron/package.json` and its lock file) and push.

## Configuration

Settings live in `config.json` in the app data folder (Help-menu / settings panel opens it). Per-repository options can be exported to a `.git-graph.json` file in the repository root.

## Credits and license

Built on the open-source [Git Graph](https://github.com/mhutchie/vscode-git-graph) by Michael Hutchison (MIT). See [LICENSE](LICENSE) and the third-party notices in [licenses/](licenses/).
