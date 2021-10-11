import * as core from '@actions/core'
import * as github from '@actions/github'
import * as Webhooks from '@octokit/webhooks'
import Clubhouse, {Label as ClubhouseLabel, Story} from 'clubhouse-lib'

type GithubLabel = {name: string; color: string}

type LabelMap = Record<string, string>

const DEFAULT_OPTIONS = {
  createIfMissing: false,
  labelMap: {} as LabelMap,
  syncedClubhouseLabels: null as string[] | null
}
type Options = typeof DEFAULT_OPTIONS

const gihubToken = core.getInput('github-token', {required: true})
const octokit = github.getOctokit(gihubToken)

const clubhouseToken = core.getInput('clubhouse-token', {required: true})
const clubhouse = Clubhouse.create(clubhouseToken)

const {owner, repo} = github.context.repo

function getOptions(): Options {
  const configOptions: Partial<Options> = {}
  const createIfMissingRaw = core.getInput('create-if-missing') || undefined
  if (createIfMissingRaw) {
    configOptions.createIfMissing = createIfMissingRaw === 'true'
  }

  const syncedClubhouseLabelsRaw =
    core.getInput('synced-clubhouse-labels') || undefined
  if (syncedClubhouseLabelsRaw) {
    try {
      configOptions.syncedClubhouseLabels = JSON.parse(syncedClubhouseLabelsRaw)
    } catch (e) {
      core.warning(
        `'synced-clubhouse-labels' is not valid Array "${syncedClubhouseLabelsRaw}"`
      )
    }
  }

  const labelMapRaw = core.getInput('label-ch-gh-map') || undefined
  if (labelMapRaw) {
    try {
      configOptions.labelMap = JSON.parse(labelMapRaw)
    } catch (e) {
      core.warning(`'label-ch-gh-map' is not valid JSON "${labelMapRaw}"`)
    }
  }
  core.info(`User config found: ${JSON.stringify(configOptions, null, 2)}`)
  const options = {...DEFAULT_OPTIONS, ...configOptions}
  core.info(`Used config: ${JSON.stringify(options, null, 2)}`)
  return options
}

async function run(): Promise<void> {
  try {
    const options = getOptions()

    const pushPayload = github.context
      .payload as Webhooks.EventPayloads.WebhookPayloadPullRequest
    const {
      number,
      title,
      body,
      labels: ghLabels,
      head: {ref}
    } = pushPayload.pull_request

    const content = `${number} ${title} ${body} ${ref}`
    core.info(
      `Analyzing the PR to indentify linked Clubhouse stories: ${content}`
    )
    const storyIds = extractStoryIds(content)
    if (!storyIds.length) {
      core.info(`No linked Clubhouse story found`)
      return
    }
    core.info(`Linked Clubhouse stories found: ${storyIds.join(',')}`)

    for (const storyId of storyIds) {
      core.info(`Fetching story: ${storyId}`)
      const story = await clubhouse.getStory(storyId)
      core.info(`Story: ${JSON.stringify(story, null, 2)}`)
      core.info(
        `Analyzing story to sync labels. Current labels: ${
          story.labels.length
            ? story.labels.map(label => label.name).join(',')
            : 'none'
        }`
      )
      const toAddLabels = getLabelsToAdd(
        ghLabels,
        story.labels,
        options.labelMap
      )
      const toRemoveLabels = getLabelsToRemove(
        ghLabels,
        story.labels,
        options.labelMap
      )
      await syncLabels(story, toAddLabels, toRemoveLabels, options)
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

/**
 * Finds all clubhouse story IDs in some string content.
 *
 * @param {string} content - content that may contain story IDs.
 * @return {Array} - Clubhouse story IDs 1-7 digit strings.
 */

function extractStoryIds(content: string): string[] {
  core.info(`extractStoryIds ${content}`)
  // Matching ch42, sc42 and sc-42 pattern
  const regex = /((?<=(sc|ch))|(?<=(sc-)))\d{1,7}/gm
  core.info(`regex ${regex.toString()}`)
  const all = content.match(regex)
  core.info(`all ${JSON.stringify(all)}`)
  const unique = [...new Set(all)]
  return unique
}

function getChLabelName(labelMap: LabelMap, ghLabelName: string): string {
  const entry = Object.entries(labelMap).find(
    ([, value]) => value === ghLabelName
  )
  return entry ? entry[0] : ghLabelName
}

function getLabelsToAdd(
  ghLabels: GithubLabel[],
  chLabels: ClubhouseLabel[],
  labelMap: LabelMap
): GithubLabel[] {
  const toAddLabels: GithubLabel[] = []
  for (const ghLabel of ghLabels) {
    if (!ghLabel) {
      continue
    }
    const chLabelName = getChLabelName(labelMap, ghLabel.name)
    const foundLabel = chLabels.find(label_ => {
      return chLabelName === label_.name
    })
    if (!foundLabel) {
      toAddLabels.push({
        name: chLabelName,
        color: `#${ghLabel.color}` // a Clubhouse label color is prefixed with #
      })
    }
  }
  return toAddLabels
}

function getLabelsToRemove(
  ghLabels: GithubLabel[],
  chLabels: ClubhouseLabel[],
  labelMap: LabelMap
): ClubhouseLabel[] {
  const toRemoveLabels: ClubhouseLabel[] = []
  for (const chLabel of chLabels) {
    if (!chLabel) {
      continue
    }
    const ghLabelName = labelMap[chLabel.name] ?? chLabel.name

    const foundLabel = ghLabels.find(ghLabel => {
      return ghLabel.name === ghLabelName
    })
    if (!foundLabel) {
      toRemoveLabels.push(chLabel)
    }
  }
  return toRemoveLabels
}

async function syncLabels(
  story: Story,
  missingLabels: GithubLabel[],
  surplusLabels: ClubhouseLabel[],
  options: typeof DEFAULT_OPTIONS
): Promise<void> {
  //* Labels to add
  const chExistingLabels = await clubhouse.listLabels()
  const labelsToAdd: ClubhouseLabel[] = []
  for (const label of missingLabels) {
    const chLabelName = getChLabelName(options.labelMap, label.name)
    if (options.syncedClubhouseLabels) {
      //* Restrict labels to add only labels specified in syncedClubhouseLabels array
      if (!options.syncedClubhouseLabels.includes(chLabelName)) {
        continue
      }
    }

    let existingLabel = chExistingLabels.find(
      candidate => candidate.name === chLabelName
    )
    if (!existingLabel && !options.createIfMissing) {
      continue
    }

    if (!existingLabel) {
      core.info(`Creating Label ${label.name} ${label.color}`)

      existingLabel = await clubhouse.createLabel(label.name, label.color)
    }
    if (!existingLabel) {
      core.warning(`Failed to create label ${label.name} #${label.color}`)
      continue
    }

    labelsToAdd.push(existingLabel)
  }
  if (labelsToAdd.length) {
    core.info(
      `Labels to add: ${labelsToAdd.map(label => label.name).join(',')}`
    )
  }

  //* Lables to remove
  const {data: ghExistingLabels} = await octokit.issues.listLabelsForRepo({
    owner,
    repo
  })
  const labelsToRemove = surplusLabels.filter(chLabel => {
    //* If syncedClubhouseLabels is specified, use it
    if (options.syncedClubhouseLabels) {
      return options.syncedClubhouseLabels.includes(chLabel.name)
    }
    //* Else delete only labels that exist in GitHub
    const ghLabelName = options.labelMap[chLabel.name] ?? chLabel.name
    return ghExistingLabels.find(ghLabel => ghLabel.name === ghLabelName)
  })
  if (labelsToRemove.length) {
    core.info(
      `Labels to remove: ${labelsToRemove.map(label => label.name).join(',')}`
    )
  }

  const labelsToKeep = [...story.labels, ...labelsToAdd].filter(
    label =>
      !labelsToRemove.find(labelToRemove => label.name === labelToRemove.name)
  )
  core.info(
    `Labels to finally have: ${labelsToKeep.map(label => label.name).join(',')}`
  )

  if (
    labelsToKeep.length === story.labels.length &&
    !story.labels.find(
      storyLabel =>
        !labelsToKeep.find(keepLabel => storyLabel.name === keepLabel.name)
    )
  ) {
    core.info('No change to sync')
    return
  }

  core.info(`Syncing labels... ${JSON.stringify(labelsToKeep, null, 2)}`)
  await clubhouse.updateStory(story.id, {
    /* @ts-expect-error: Waiting a new release: https://github.com/clubhouse/clubhouse-lib/commit/3af721bc84c6067ed45eed5e70879bfafdd090f1 */
    labels: labelsToKeep.map(label => ({
      name: label.name
    }))
  })
}

run()
