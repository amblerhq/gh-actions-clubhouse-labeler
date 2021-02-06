# Clubhouse Labeler

A Github Action to sync labels between Clubhouse Story and its linked Pull Request

[![CI status](https://github.com/actions/typescript-action/workflows/build-test/badge.svg)](https://github.com/actions/gh-actions-clubhouse-labeler/actions)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)

## Usage

[Create a Clubhouse API token](https://app.clubhouse.io/settings/account/api-tokens),
and store it as an encrypted secret in your GitHub repository settings.
[Check the GitHub documentation for how to create an encrypted secret.](https://help.github.com/en/actions/configuring-and-managing-workflows/creating-and-storing-encrypted-secrets#creating-encrypted-secrets)
Name this secret `CLUBHOUSE_TOKEN`.

### Create Workflow

Create a workflow (eg: `.github/workflows/labeler.yml` see [Creating a Workflow file](https://help.github.com/en/articles/configuring-a-workflow#creating-a-workflow-file)) to utilize the labeler action with content:

```
name: "Clubhouse Labeler"
on:
  pull_request:
    types: [labeled, unlabeled]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: amblerhq/gh-actions-clubhouse-labeler@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          clubhouse-token: ${{ secrets.CLUBHOUSE_TOKEN}}
```

_Note: This grants access to the `GITHUB_TOKEN` so the action can make calls to GitHub's rest API_

### Options

#### create-if-missing (Default: false)

Create missing labels on Clubhouse (with same color than in GitHub).

#### synced-clubhouse-labels (Default: all labels)

Restrict synchronization to some labels only.
If not set, a Clubhouse label will be removed from the story if it is not present on PR and exists in the GitHub repository

#### label-ch-gh-map (Default: same name)

Map Clubhouse label name to a GitHub label name

### Example

```
name: "Clubhouse Labeler"
on:
  pull_request:
    types: [labeled, unlabeled]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: amblerhq/gh-actions-clubhouse-labeler@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          clubhouse-token: ${{ secrets.CLUBHOUSE_TOKEN}}
          create-if-missing: true
          synced-clubhouse-labels: |
            [
              "📖 doc"
            ]
          label-ch-gh-map: |
            {
              "📖 doc": "documentation"
            }
```

This workflow will synchronize only `📖 doc` Clubhouse label, create it if needed and link it from `documentation` label on GitHub
