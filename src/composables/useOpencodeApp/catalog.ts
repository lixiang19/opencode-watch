import type { Command as OpencodeCommand, GlobalSession, Project } from '@opencode-ai/sdk/v2/client'

import type {
  ChatAgentRecord,
  ChatCommandRecord,
  ChatModelRecord,
  DesktopSessionState,
  SessionRecord
} from '@/types/opencode'

import { INITIAL_HISTORY_LIMIT } from './constants'
import { getDirectoryName, makeModelKey, normalizeDirectory, normalizeModelKey } from './helpers'
import type {
  AgentInfo,
  ChatOptionsSnapshot,
  ChatSelectionOptions,
  ConfigProvidersResponse,
  MessageHistoryItem,
  ProjectCatalogEntry,
  SkillInfo
} from './types'

export function buildModelCatalog(response?: ConfigProvidersResponse) {
  return (response?.providers ?? [])
    .flatMap((provider) => {
      return Object.values(provider.models ?? {})
        .filter((model) => model.status !== 'deprecated')
        .map<ChatModelRecord>((model) => {
          const variants = Object.entries(model.variants ?? {})
            .filter(([variant, detail]) => Boolean(variant) && detail?.disabled !== true)
            .map(([variant]) => variant)

          return {
            key: makeModelKey(provider.id, model.id),
            providerId: provider.id,
            providerName: provider.name || provider.id,
            modelId: model.id,
            label: model.name || model.id,
            status: model.status,
            variants,
            limit: model.limit
              ? {
                  context: model.limit.context,
                  input: model.limit.input,
                  output: model.limit.output
                }
              : undefined
          }
        })
    })
    .sort((left, right) => {
      const providerCompare = left.providerName.localeCompare(right.providerName)
      if (providerCompare !== 0) {
        return providerCompare
      }

      return left.modelId.localeCompare(right.modelId)
    })
}

export function resolveDefaultModelKey(response?: ConfigProvidersResponse) {
  const defaults = response?.default
  if (!defaults) {
    return ''
  }

  for (const [providerId, modelValue] of Object.entries(defaults)) {
    const normalizedValue = normalizeModelKey(modelValue)
    if (normalizedValue) {
      return normalizedValue
    }

    const normalizedKey = normalizeModelKey(makeModelKey(providerId, modelValue))
    if (normalizedKey) {
      return normalizedKey
    }
  }

  return ''
}

export function buildAgentCatalog(input?: AgentInfo[]) {
  return (input ?? [])
    .filter((agent) => !agent.hidden && agent.mode !== 'subagent')
    .map<ChatAgentRecord>((agent) => ({
      id: agent.name,
      description: agent.description || '',
      mode: agent.mode,
      hidden: agent.hidden,
      model: agent.model
        ? {
            providerId: agent.model.providerID,
            modelId: agent.model.modelID
          }
        : undefined,
      variant: agent.variant
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function buildCommandCatalog(
  scopedCommands: OpencodeCommand[] = [],
  globalCommands: OpencodeCommand[] = [],
  skills: SkillInfo[] = []
) {
  const globalNames = new Set(globalCommands.map((command) => command.name))
  const skillNames = new Set(skills.map((skill) => skill.name))
  const entries = new Map<string, ChatCommandRecord>()

  for (const command of [...globalCommands, ...scopedCommands]) {
    const isSkill = command.source === 'skill' || skillNames.has(command.name)
    const category = isSkill ? 'skill' : globalNames.has(command.name) ? 'system' : 'custom'

    entries.set(command.name, {
      name: command.name,
      description: command.description || '',
      template: command.template,
      hints: command.hints ?? [],
      source: command.source,
      category
    })
  }

  return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export function createDesktopSessionState(sessionId: string): DesktopSessionState {
  return {
    sessionId,
    messages: [],
    availableAgents: [],
    availableCommands: [],
    availableModels: [],
    selectedAgentId: '',
    selectedModelKey: '',
    selectedVariant: '',
    selectedCommandName: '',
    isLoadingSession: false,
    isSending: false,
    isLoadingOlderMessages: false,
    sessionStatus: 'idle',
    lastError: '',
    historyMessageLimit: INITIAL_HISTORY_LIMIT,
    hasMoreHistory: false
  }
}

export function resolveChatSelections(snapshot: ChatOptionsSnapshot, options: ChatSelectionOptions = {}) {
  const agentIds = new Set(snapshot.agents.map((agent) => agent.id))
  const nextAgentId = [
    options.preferredAgentId,
    options.currentAgentId,
    snapshot.agents.find((agent) => agent.id === 'build')?.id,
    snapshot.agents[0]?.id
  ].find((candidate) => Boolean(candidate) && agentIds.has(candidate as string)) || ''

  const modelKeys = new Set(snapshot.models.map((model) => model.key))
  const agentModel = snapshot.agents.find((agent) => agent.id === nextAgentId)?.model
  const agentModelKey = agentModel ? makeModelKey(agentModel.providerId, agentModel.modelId) : ''
  const nextModelKey = [
    options.preferredModelKey,
    options.currentModelKey,
    agentModelKey,
    snapshot.defaultModelKey,
    snapshot.models[0]?.key
  ]
    .map((candidate) => normalizeModelKey(candidate))
    .find((candidate) => Boolean(candidate) && modelKeys.has(candidate)) || ''

  return {
    selectedAgentId: nextAgentId,
    selectedModelKey: nextModelKey
  }
}

export function getHistorySelection(history: MessageHistoryItem[]) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const info = history[index]?.info as MessageHistoryItem['info'] & {
      agent?: string
      model?: {
        providerID?: string
        modelID?: string
      }
      variant?: string
    }

    if (info.role !== 'user') {
      continue
    }

    return {
      agentId: info.agent || '',
      modelKey:
        info.model?.providerID && info.model?.modelID
          ? makeModelKey(info.model.providerID, info.model.modelID)
          : '',
      variant: info.variant || ''
    }
  }

  return {
    agentId: '',
    modelKey: '',
    variant: ''
  }
}

export function mapProjectCatalogEntry(project: Project): ProjectCatalogEntry {
  return {
    projectId: project.id,
    directory: normalizeDirectory(project.worktree),
    name: project.name || getDirectoryName(project.worktree),
    lastUpdated: project.time.updated,
    icon: project.icon
      ? {
          url: project.icon.url,
          override: project.icon.override,
          color: project.icon.color
        }
      : undefined
  }
}

export function mapGlobalSession(session: GlobalSession): SessionRecord {
  return {
    id: session.id,
    projectId: session.projectID,
    title: session.title,
    directory: normalizeDirectory(session.directory),
    parentID: session.parentID,
    project: session.project
      ? {
          id: session.project.id,
          name: session.project.name,
          worktree: normalizeDirectory(session.project.worktree)
        }
      : null,
    time: {
      created: session.time.created,
      updated: session.time.updated
    }
  }
}
