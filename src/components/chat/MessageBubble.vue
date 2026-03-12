<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import { useOpencodeState } from '@/lib/app-context'
import type { ChatMessageRecord } from '@/types/opencode'

const props = defineProps<{
  message: ChatMessageRecord
}>()

const app = useOpencodeState()
const isUser = computed(() => props.message.role === 'user')
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
  if (!props.message.confirmation?.id) {
    return
  }

  await app.replyPermission(props.message.confirmation.id, reply)
}

async function handleQuestionSubmit() {
  if (!props.message.question?.id || !canSubmitQuestion.value || isSubmittingQuestion.value) {
    return
  }

  isSubmittingQuestion.value = true
  try {
    await app.replyQuestion(props.message.question.id, getQuestionAnswers())
  } finally {
    isSubmittingQuestion.value = false
  }
}

async function handleQuestionReject() {
  if (!props.message.question?.id || isRejectingQuestion.value) {
    return
  }

  isRejectingQuestion.value = true
  try {
    await app.rejectQuestion(props.message.question.id)
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
      <p v-if="message.content" class="msg-text">{{ message.content }}</p>

      <div v-if="message.question" class="msg-question">
        <div class="msg-question-title">
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

        <div v-if="message.question.status === 'pending'" class="msg-question-actions">
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
          <div class="msg-question-state">已提交</div>
          <div v-for="item in questionSummary" :key="item.header" class="msg-question-summary-item">
            <span class="msg-question-summary-label">{{ item.header }}</span>
            <span class="msg-question-summary-value">{{ item.answers.join('、') || '未填写' }}</span>
          </div>
        </div>

        <div v-else class="msg-question-summary">
          <div class="msg-question-state msg-question-state-muted">已拒绝回答</div>
        </div>
      </div>

      <div v-if="message.confirmation" class="msg-permission">
        <div class="msg-permission-title">需要权限确认</div>
        <div class="msg-permission-row">
          <span class="msg-permission-label">类型</span>
          <span class="msg-permission-value">{{ message.confirmation.type }}</span>
        </div>
        <div v-if="message.confirmation.patterns.length" class="msg-permission-row msg-permission-row-stack">
          <span class="msg-permission-label">规则</span>
          <div class="msg-permission-tags">
            <span v-for="pattern in message.confirmation.patterns" :key="pattern" class="msg-tag">
              {{ pattern }}
            </span>
          </div>
        </div>
        <div v-if="permissionMetadata.length" class="msg-permission-row msg-permission-row-stack">
          <span class="msg-permission-label">输入</span>
          <div class="msg-permission-meta">
            <div v-for="item in permissionMetadata" :key="item.key" class="msg-meta-item">
              <span class="msg-meta-key">{{ item.key }}</span>
              <span class="msg-meta-value">{{ item.value }}</span>
            </div>
          </div>
        </div>
        <div class="msg-permission-actions">
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

.msg-bubble {
  max-width: min(86%, 34rem);
  padding: 0.875rem 1rem;
  border-radius: 1.5rem;
}

.msg-bubble-user {
  background: var(--primary);
  color: var(--primary-foreground);
  border-bottom-right-radius: 0.625rem;
}

.msg-bubble-assistant {
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--card-foreground);
  border-bottom-left-radius: 0.625rem;
}

.msg-text {
  margin: 0;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-question,
.msg-permission {
  display: grid;
  gap: 0.65rem;
  margin-top: 0.25rem;
  padding: 0.85rem;
  border-radius: 1rem;
}

.msg-question {
  border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--border));
  background: color-mix(in srgb, var(--primary) 8%, var(--card));
}

.msg-permission {
  border: 1px solid color-mix(in srgb, var(--warning, #d97706) 24%, var(--border));
  background: color-mix(in srgb, var(--accent) 18%, var(--card));
}

.msg-question-title,
.msg-permission-title {
  font-size: 0.875rem;
  font-weight: 600;
}

.msg-question-block {
  display: grid;
  gap: 0.55rem;
}

.msg-question-header {
  color: var(--muted-foreground);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.msg-question-copy {
  margin: 0;
  line-height: 1.6;
}

.msg-question-options {
  display: grid;
  gap: 0.5rem;
}

.msg-question-option {
  display: grid;
  gap: 0.15rem;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 0.95rem;
  background: color-mix(in srgb, var(--background) 80%, transparent);
  color: inherit;
  text-align: left;
  font: inherit;
}

.msg-question-option:disabled {
  cursor: default;
  opacity: 0.82;
}

.msg-question-option-active {
  border-color: color-mix(in srgb, var(--primary) 55%, var(--border));
  background: color-mix(in srgb, var(--primary) 12%, var(--card));
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
  min-height: 2.75rem;
}

.msg-question-actions,
.msg-permission-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.msg-question-summary {
  display: grid;
  gap: 0.5rem;
}

.msg-question-state {
  color: var(--primary);
  font-size: 0.75rem;
  font-weight: 600;
}

.msg-question-state-muted {
  color: var(--muted-foreground);
}

.msg-question-summary-item {
  display: grid;
  gap: 0.2rem;
}

.msg-question-summary-label {
  color: var(--muted-foreground);
  font-size: 0.75rem;
}

.msg-question-summary-value {
  line-height: 1.6;
  word-break: break-word;
}

.msg-permission-row {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.msg-permission-row-stack {
  display: grid;
  gap: 0.45rem;
}

.msg-permission-label,
.msg-meta-key {
  color: var(--muted-foreground);
  font-size: 0.75rem;
}

.msg-permission-value,
.msg-meta-value {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}

.msg-permission-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.msg-tag {
  padding: 0.22rem 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  font-size: 0.75rem;
}

.msg-permission-meta {
  display: grid;
  gap: 0.45rem;
}

.msg-meta-item {
  display: grid;
  gap: 0.18rem;
}

@media (max-width: 640px) {
  .msg-bubble {
    max-width: 92%;
  }
}
</style>
