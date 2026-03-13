<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import MessagePartRenderer from '@/components/chat/MessagePartRenderer.vue'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import { isRenderablePart } from '@/composables/useOpencodeApp/messages'
import { useOpencodeStore } from '@/stores/opencode'
import type { ChatMessageRecord } from '@/types/opencode'

const props = defineProps<{
  message: ChatMessageRecord
}>()

const app = useOpencodeStore()
const isUser = computed(() => props.message.role === 'user')
const renderableParts = computed(() => props.message.parts.filter((part) => isRenderablePart(part)))
const questionChoices = ref<string[][]>([])
const questionCustomInputs = ref<string[]>([])
const isSubmittingQuestion = ref(false)
const isRejectingQuestion = ref(false)
const permissionMetadata = computed(() => {
  const metadata = props.message.confirmation?.metadata
  if (!metadata) {
    return []
  }

  return Object.entries(metadata).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value)
  }))
})
const questionId = computed(() => props.message.question?.id ?? '')
const canSubmitQuestion = computed(() => {
  const questions = props.message.question?.questions ?? []
  if (!questions.length) {
    return false
  }

  return questions.every((item, index) => {
    const selected = questionChoices.value[index] ?? []
    const custom = item.custom === false ? '' : (questionCustomInputs.value[index] ?? '').trim()
    return selected.length > 0 || Boolean(custom)
  })
})
const questionSummary = computed(() => {
  const question = props.message.question
  if (!question || question.status === 'pending') {
    return []
  }

  return question.questions.map((item, index) => ({
    header: item.header,
    answers: question.answers?.[index] ?? []
  }))
})

function resetQuestionForm() {
  const questions = props.message.question?.questions ?? []
  questionChoices.value = questions.map(() => [])
  questionCustomInputs.value = questions.map(() => '')
}

function hasQuestionOption(index: number, label: string) {
  return questionChoices.value[index]?.includes(label) ?? false
}

function toggleQuestionOption(index: number, label: string, multiple?: boolean) {
  const current = [...(questionChoices.value[index] ?? [])]
  if (multiple) {
    questionChoices.value[index] = current.includes(label)
      ? current.filter((item) => item !== label)
      : [...current, label]
    return
  }

  questionChoices.value[index] = current[0] === label ? [] : [label]
}

function getQuestionAnswers() {
  return (props.message.question?.questions ?? []).map((item, index) => {
    const selected = [...(questionChoices.value[index] ?? [])]
    const custom = item.custom === false ? '' : (questionCustomInputs.value[index] ?? '').trim()
    if (custom && !selected.includes(custom)) {
      selected.push(custom)
    }
    return selected
  })
}

async function handlePermissionReply(reply: 'once' | 'always' | 'reject') {
  if (!props.message.confirmation?.id || !props.message.confirmation.sessionId) {
    return
  }

  await app.replyPermission(props.message.confirmation.sessionId, props.message.confirmation.id, reply)
}

async function handleQuestionSubmit() {
  if (!props.message.question?.id || !props.message.question.sessionId || !canSubmitQuestion.value || isSubmittingQuestion.value) {
    return
  }

  isSubmittingQuestion.value = true
  try {
    await app.replyQuestion(props.message.question.sessionId, props.message.question.id, getQuestionAnswers())
  } finally {
    isSubmittingQuestion.value = false
  }
}

async function handleQuestionReject() {
  if (!props.message.question?.id || !props.message.question.sessionId || isRejectingQuestion.value) {
    return
  }

  isRejectingQuestion.value = true
  try {
    await app.rejectQuestion(props.message.question.sessionId, props.message.question.id)
  } finally {
    isRejectingQuestion.value = false
  }
}

watch(
  questionId,
  () => {
    resetQuestionForm()
    isSubmittingQuestion.value = false
    isRejectingQuestion.value = false
  },
  { immediate: true }
)
</script>

<template>
  <div :class="['msg-row', isUser ? 'msg-row-user' : 'msg-row-assistant']">
    <div :class="['msg-bubble', isUser ? 'msg-bubble-user' : 'msg-bubble-assistant']">
      <div v-if="renderableParts.length" class="msg-parts">
        <MessagePartRenderer v-for="part in renderableParts" :key="part.id" :part="part" />
      </div>

      <div v-if="message.error" class="msg-error">{{ message.error }}</div>

      <div v-if="message.question" class="msg-question">
        <div class="msg-section-title">
          {{ message.question.status === 'pending' ? '需要你补充信息' : '表单结果' }}
        </div>
        <div
          v-for="(item, index) in message.question.questions"
          :key="`${message.question.id}-${index}`"
          class="msg-question-block"
        >
          <div class="msg-question-header">{{ item.header }}</div>
          <p class="msg-question-copy">{{ item.question }}</p>

          <div class="msg-question-options">
            <button
              v-for="option in item.options"
              :key="option.label"
              type="button"
              :class="['msg-question-option', hasQuestionOption(index, option.label) ? 'msg-question-option-active' : '']"
              :disabled="message.question.status !== 'pending'"
              @click="toggleQuestionOption(index, option.label, item.multiple)"
            >
              <span class="msg-question-option-label">{{ option.label }}</span>
              <span class="msg-question-option-copy">{{ option.description }}</span>
            </button>
          </div>

          <Input
            v-if="item.custom !== false && message.question.status === 'pending'"
            v-model="questionCustomInputs[index]"
            class="msg-question-input"
            placeholder="输入自定义答案"
          />
        </div>

        <div v-if="message.question.status === 'pending'" class="msg-actions">
          <Button
            variant="outline"
            size="sm"
            :disabled="isRejectingQuestion || isSubmittingQuestion"
            @click="handleQuestionReject"
          >
            {{ isRejectingQuestion ? '处理中…' : '暂不回答' }}
          </Button>
          <Button
            size="sm"
            :disabled="!canSubmitQuestion || isRejectingQuestion || isSubmittingQuestion"
            @click="handleQuestionSubmit"
          >
            {{ isSubmittingQuestion ? '提交中…' : '提交表单' }}
          </Button>
        </div>

        <div v-else-if="message.question.status === 'answered'" class="msg-question-summary">
          <div class="msg-state msg-state-done">已提交</div>
          <div v-for="item in questionSummary" :key="item.header" class="msg-summary-item">
            <span class="msg-summary-label">{{ item.header }}</span>
            <span class="msg-summary-value">{{ item.answers.join('、') || '未填写' }}</span>
          </div>
        </div>

        <div v-else class="msg-question-summary">
          <div class="msg-state msg-state-muted">已拒绝回答</div>
        </div>
      </div>

      <div v-if="message.confirmation" class="msg-permission">
        <div class="msg-section-title">需要权限确认</div>
        <div class="msg-permission-row">
          <span class="msg-label">类型</span>
          <span class="msg-value">{{ message.confirmation.type }}</span>
        </div>
        <div v-if="message.confirmation.patterns.length" class="msg-permission-row msg-permission-stack">
          <span class="msg-label">规则</span>
          <div class="msg-tags">
            <span v-for="pattern in message.confirmation.patterns" :key="pattern" class="msg-tag">
              {{ pattern }}
            </span>
          </div>
        </div>
        <div v-if="permissionMetadata.length" class="msg-permission-row msg-permission-stack">
          <span class="msg-label">输入</span>
          <div class="msg-meta">
            <div v-for="item in permissionMetadata" :key="item.key" class="msg-meta-item">
              <span class="msg-meta-key">{{ item.key }}</span>
              <span class="msg-meta-val">{{ item.value }}</span>
            </div>
          </div>
        </div>
        <div class="msg-actions">
          <Button variant="outline" size="sm" @click="handlePermissionReply('once')">允许一次</Button>
          <Button size="sm" @click="handlePermissionReply('always')">始终允许</Button>
          <Button variant="destructive" size="sm" @click="handlePermissionReply('reject')">拒绝</Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.msg-row {
  display: flex;
}

.msg-row-user {
  justify-content: flex-end;
}

.msg-row-assistant {
  justify-content: flex-start;
}

/* ── Bubbles ── */
.msg-bubble {
  max-width: min(82%, 32rem);
  padding: 0.75rem 1rem;
  border-radius: 1.375rem;
}

.msg-bubble-user {
  background: var(--primary);
  color: var(--primary-foreground);
  border-bottom-right-radius: 0.375rem;
}

.msg-bubble-assistant {
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--card-foreground);
  border-bottom-left-radius: 0.375rem;
}

.msg-parts {
  display: grid;
  gap: 0.75rem;
}

.msg-error {
  margin-top: 0.75rem;
  padding: 0.75rem 0.875rem;
  border-radius: 0.9rem;
  background: color-mix(in srgb, #ef4444 10%, transparent);
  color: #b42318;
  font-size: 0.875rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── Question card ── */
.msg-question,
.msg-permission {
  display: grid;
  gap: 0.75rem;
  margin-top: 0.5rem;
  padding: 0.875rem;
  border-radius: 1rem;
}

.msg-question {
  border: 1px solid color-mix(in srgb, var(--primary) 20%, var(--border));
  background: color-mix(in srgb, var(--primary) 6%, var(--card));
}

.msg-permission {
  border: 1px solid color-mix(in srgb, var(--warning, #d97706) 22%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, var(--card));
}

.msg-section-title {
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.msg-question-block {
  display: grid;
  gap: 0.5rem;
}

.msg-question-header {
  color: var(--muted-foreground);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.msg-question-copy {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.6;
}

.msg-question-options {
  display: grid;
  gap: 0.4rem;
}

.msg-question-option {
  display: grid;
  gap: 0.1rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  background: color-mix(in srgb, var(--background) 75%, transparent);
  color: inherit;
  text-align: left;
  font: inherit;
  transition: border-color 0.12s, background 0.12s;
  cursor: pointer;
}

.msg-question-option:disabled {
  cursor: default;
  opacity: 0.8;
}

.msg-question-option:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--primary) 40%, var(--border));
}

.msg-question-option-active {
  border-color: color-mix(in srgb, var(--primary) 55%, var(--border));
  background: color-mix(in srgb, var(--primary) 10%, var(--card));
}

.msg-question-option-label {
  font-size: 0.875rem;
  font-weight: 600;
}

.msg-question-option-copy {
  color: var(--muted-foreground);
  font-size: 0.75rem;
  line-height: 1.5;
}

.msg-question-input {
  height: auto;
  min-height: 2.5rem;
}

.msg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.msg-question-summary {
  display: grid;
  gap: 0.4rem;
}

.msg-state {
  font-size: 0.75rem;
  font-weight: 600;
}

.msg-state-done {
  color: var(--primary);
}

.msg-state-muted {
  color: var(--muted-foreground);
}

.msg-summary-item {
  display: grid;
  gap: 0.15rem;
}

.msg-summary-label {
  color: var(--muted-foreground);
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.msg-summary-value {
  font-size: 0.875rem;
  line-height: 1.6;
  word-break: break-word;
}

/* ── Permission ── */
.msg-permission-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.msg-permission-stack {
  display: grid;
  gap: 0.35rem;
}

.msg-label,
.msg-meta-key {
  color: var(--muted-foreground);
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.msg-value,
.msg-meta-val {
  font-size: 0.875rem;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
}

.msg-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.msg-tag {
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  font-size: 0.75rem;
}

.msg-meta {
  display: grid;
  gap: 0.4rem;
}

.msg-meta-item {
  display: grid;
  gap: 0.15rem;
}

@media (max-width: 640px) {
  .msg-bubble {
    max-width: 90%;
  }
}
</style>
