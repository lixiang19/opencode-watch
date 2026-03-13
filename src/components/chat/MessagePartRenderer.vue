<script setup lang="ts">
import { computed } from 'vue'
import type { Part } from '@opencode-ai/sdk/v2/client'

const props = defineProps<{
  part: Part
}>()

const jsonSpace = 2

const fileSourceLabel = computed(() => {
  if (props.part.type !== 'file' || !props.part.source) {
    return ''
  }

  if (props.part.source.type === 'file') {
    return props.part.source.path
  }

  if (props.part.source.type === 'symbol') {
    return `${props.part.source.path} · ${props.part.source.name}`
  }

  return `${props.part.source.clientName} · ${props.part.source.uri}`
})

const toolStatusLabel = computed(() => {
  if (props.part.type !== 'tool') {
    return ''
  }

  switch (props.part.state.status) {
    case 'pending':
      return '等待中'
    case 'running':
      return '执行中'
    case 'completed':
      return '已完成'
    case 'error':
      return '失败'
  }
})

const toolTitle = computed(() => {
  if (props.part.type !== 'tool') {
    return ''
  }

  return 'title' in props.part.state && typeof props.part.state.title === 'string' ? props.part.state.title : ''
})

const toolInput = computed(() => {
  if (props.part.type !== 'tool') {
    return ''
  }

  return JSON.stringify(props.part.state.input, null, jsonSpace)
})

const toolRaw = computed(() => {
  if (props.part.type !== 'tool' || props.part.state.status !== 'pending') {
    return ''
  }

  return props.part.state.raw
})

const toolOutput = computed(() => {
  if (props.part.type !== 'tool' || props.part.state.status !== 'completed') {
    return ''
  }

  return props.part.state.output
})

const toolError = computed(() => {
  if (props.part.type !== 'tool' || props.part.state.status !== 'error') {
    return ''
  }

  return props.part.state.error
})

const toolAttachments = computed(() => {
  if (props.part.type !== 'tool' || props.part.state.status !== 'completed') {
    return []
  }

  return props.part.state.attachments ?? []
})

const retryError = computed(() => {
  if (props.part.type !== 'retry') {
    return ''
  }

  return props.part.error.data.message || props.part.error.name
})

function formatBool(value: boolean) {
  return value ? '是' : '否'
}
</script>

<template>
  <p v-if="part.type === 'text' && !part.ignored && part.text" class="msg-text">{{ part.text }}</p>

  <details v-else-if="part.type === 'reasoning'" class="msg-panel msg-panel-muted">
    <summary>思考过程</summary>
    <pre class="msg-code">{{ part.text }}</pre>
  </details>

  <details v-else-if="part.type === 'subtask'" class="msg-panel">
    <summary>子任务 · {{ part.agent }}</summary>
    <div class="msg-grid">
      <div><span class="msg-key">描述</span><span class="msg-val">{{ part.description }}</span></div>
      <div><span class="msg-key">提示</span><span class="msg-val">{{ part.prompt }}</span></div>
      <div v-if="part.command"><span class="msg-key">命令</span><span class="msg-val">{{ part.command }}</span></div>
      <div v-if="part.model"><span class="msg-key">模型</span><span class="msg-val">{{ part.model.providerID }}/{{ part.model.modelID }}</span></div>
    </div>
  </details>

  <div v-else-if="part.type === 'file'" class="msg-panel">
    <div class="msg-panel-title">文件</div>
    <div class="msg-grid">
      <div><span class="msg-key">名称</span><span class="msg-val">{{ part.filename || '未命名文件' }}</span></div>
      <div><span class="msg-key">类型</span><span class="msg-val">{{ part.mime }}</span></div>
      <div><span class="msg-key">链接</span><a class="msg-link" :href="part.url" target="_blank" rel="noreferrer">打开文件</a></div>
      <div v-if="fileSourceLabel"><span class="msg-key">来源</span><span class="msg-val">{{ fileSourceLabel }}</span></div>
    </div>
  </div>

  <details v-else-if="part.type === 'tool'" class="msg-panel">
    <summary>工具 · {{ part.tool }} · {{ toolStatusLabel }}</summary>
    <div class="msg-grid">
      <div v-if="toolTitle"><span class="msg-key">标题</span><span class="msg-val">{{ toolTitle }}</span></div>
      <div><span class="msg-key">调用 ID</span><span class="msg-val">{{ part.callID }}</span></div>
    </div>
    <div class="msg-section">
      <div class="msg-key">输入</div>
      <pre class="msg-code">{{ toolInput }}</pre>
    </div>
    <div v-if="toolRaw" class="msg-section">
      <div class="msg-key">原始输出</div>
      <pre class="msg-code">{{ toolRaw }}</pre>
    </div>
    <div v-if="toolOutput" class="msg-section">
      <div class="msg-key">输出</div>
      <pre class="msg-code">{{ toolOutput }}</pre>
    </div>
    <div v-if="toolError" class="msg-section">
      <div class="msg-key">错误</div>
      <pre class="msg-code msg-code-error">{{ toolError }}</pre>
    </div>
    <div v-if="toolAttachments.length" class="msg-section">
      <div class="msg-key">附件</div>
      <ul class="msg-list">
        <li v-for="attachment in toolAttachments" :key="attachment.id">
          <a class="msg-link" :href="attachment.url" target="_blank" rel="noreferrer">
            {{ attachment.filename || attachment.url }}
          </a>
        </li>
      </ul>
    </div>
  </details>

  <div v-else-if="part.type === 'agent'" class="msg-chip-row">
    <span class="msg-chip">Agent</span>
    <span class="msg-chip-secondary">{{ part.name }}</span>
  </div>

  <div v-else-if="part.type === 'retry'" class="msg-panel msg-panel-warning">
    <div class="msg-panel-title">重试 #{{ part.attempt }}</div>
    <pre class="msg-code msg-code-error">{{ retryError }}</pre>
  </div>

  <div v-else-if="part.type === 'compaction'" class="msg-chip-row">
    <span class="msg-chip">上下文压缩</span>
    <span class="msg-chip-secondary">自动: {{ formatBool(part.auto) }}</span>
    <span v-if="part.overflow" class="msg-chip-secondary">因溢出触发</span>
  </div>
</template>

<style scoped>
.msg-text {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.6;
}

.msg-panel {
  display: grid;
  gap: 0.75rem;
  padding: 0.875rem;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 0.9rem;
  background: color-mix(in srgb, var(--card) 88%, white 12%);
}

.msg-panel-muted {
  background: color-mix(in srgb, var(--muted) 70%, var(--card) 30%);
}

.msg-panel-warning {
  background: color-mix(in srgb, #f59e0b 10%, var(--card) 90%);
}

.msg-panel > summary {
  cursor: pointer;
  font-weight: 600;
}

.msg-panel-title {
  font-size: 0.82rem;
  font-weight: 700;
}

.msg-grid {
  display: grid;
  gap: 0.55rem;
}

.msg-grid > div,
.msg-section {
  display: grid;
  gap: 0.25rem;
}

.msg-key {
  color: var(--muted-foreground);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.msg-val {
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-code {
  margin: 0;
  padding: 0.75rem;
  overflow-x: auto;
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--background) 82%, black 18%);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.8rem;
  line-height: 1.5;
}

.msg-code-error {
  color: #b42318;
}

.msg-list {
  margin: 0;
  padding-left: 1rem;
  display: grid;
  gap: 0.35rem;
}

.msg-link {
  color: var(--foreground);
  text-decoration: underline;
  text-underline-offset: 0.16em;
}

.msg-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.msg-chip,
.msg-chip-secondary {
  display: inline-flex;
  align-items: center;
  min-height: 1.9rem;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  font-size: 0.76rem;
}

.msg-chip {
  background: color-mix(in srgb, var(--accent) 82%, transparent);
}

.msg-chip-secondary {
  background: color-mix(in srgb, var(--muted) 80%, transparent);
  color: var(--muted-foreground);
}
</style>
