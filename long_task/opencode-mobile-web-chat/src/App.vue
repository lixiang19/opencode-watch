<script setup lang="ts">
import { computed, onMounted } from 'vue'
import {
  ArrowRight,
  Bot,
  FolderTree,
  LoaderCircle,
  MessagesSquare,
  RefreshCw,
  Send,
  TerminalSquare,
  Wifi
} from 'lucide-vue-next'

import MessageBubble from '@/components/chat/MessageBubble.vue'
import Badge from '@/components/ui/badge/Badge.vue'
import Button from '@/components/ui/button/Button.vue'
import Card from '@/components/ui/card/Card.vue'
import Input from '@/components/ui/input/Input.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import { useOpencodeApp } from '@/composables/useOpencodeApp'

const app = useOpencodeApp()

const currentModeHint = computed(() =>
  app.composerMode.value === 'command'
    ? '例如 /status、/model、/help，命令结果会直接回到当前会话。'
    : '继续当前对话，只发送纯文本提示词。'
)

const sessionCountLabel = computed(() => `${app.filteredSessions.value.length} 个会话`)

const statusTone = computed(() => {
  if (app.lastError.value) {
    return 'danger'
  }

  if (app.streamReady.value) {
    return 'success'
  }

  return 'muted'
})

const sessionStatusText = computed(() =>
  app.sessionStatus.value === 'busy' || app.isSending.value ? '处理中' : '空闲'
)

function formatRelativeTime(timestamp?: number) {
  if (!timestamp) {
    return '无时间'
  }

  const diff = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) {
    return '刚刚'
  }

  if (minutes < 60) {
    return `${minutes} 分钟前`
  }

  if (hours < 24) {
    return `${hours} 小时前`
  }

  return `${days} 天前`
}

onMounted(() => {
  void app.connect()
})
</script>

<template>
  <div class="min-h-screen px-4 py-5 sm:px-6">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <Card class="overflow-hidden px-5 py-5 sm:px-6">
        <div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div class="space-y-3">
            <Badge tone="accent">移动端接续</Badge>
            <div class="space-y-2">
              <h1 class="max-w-2xl text-2xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">
                用最少界面继续你的 opencode 对话，并且直接下达命令。
              </h1>
              <p class="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                这里只保留三件事：找到项目、进入会话、继续发消息或命令。工具流和复杂面板全部砍掉。
              </p>
            </div>
          </div>

          <div class="grid gap-3 lg:min-w-[520px]">
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="space-y-2 sm:col-span-2">
                <label class="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Opencode 服务地址
                </label>
                <Input v-model="app.serverUrl.value" placeholder="http://127.0.0.1:4096" />
              </div>

              <div class="space-y-2">
                <label class="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  用户名
                </label>
                <Input v-model="app.username.value" placeholder="opencode" />
              </div>

              <div class="space-y-2">
                <label class="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  密码
                </label>
                <Input v-model="app.password.value" type="password" placeholder="如未启用可留空" />
              </div>
            </div>

            <div class="space-y-2">
              <label class="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                连接控制
              </label>
              <div class="flex items-end gap-2">
                <Button class="flex-1 sm:flex-none" :disabled="app.isConnecting.value" @click="app.connect">
                  <LoaderCircle v-if="app.isConnecting.value" class="h-4 w-4 animate-spin" />
                  <Wifi v-else class="h-4 w-4" />
                  {{ app.isConnecting.value ? '连接中' : '连接 / 重连' }}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  :disabled="app.isRefreshing.value"
                  @click="app.refreshSessions({ reopen: false })"
                >
                  <RefreshCw :class="['h-4 w-4', app.isRefreshing.value ? 'animate-spin' : '']" />
                </Button>
              </div>
              <p class="text-xs text-muted-foreground">
                如果你的本机 server 开了 Basic Auth，就在这里直接填用户名和密码。
              </p>
            </div>
          </div>
        </div>

        <div class="mt-5 flex flex-wrap items-center gap-2 border-t border-border/70 pt-4 text-xs text-muted-foreground">
          <Badge :tone="statusTone">{{ app.connectionStateLabel.value }}</Badge>
          <span v-if="app.selectedProjectMeta.value">
            当前项目：{{ app.selectedProjectMeta.value.name }}
          </span>
          <span v-if="app.activeSession.value">当前会话：{{ app.activeSession.value.title || '未命名会话' }}</span>
          <span>状态：{{ sessionStatusText }}</span>
        </div>
      </Card>

      <div class="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div class="flex flex-col gap-4">
          <Card class="px-4 py-4 sm:px-5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  项目目录
                </p>
                <h2 class="mt-1 text-lg font-semibold tracking-[-0.02em]">已有项目</h2>
              </div>
              <FolderTree class="h-5 w-5 text-muted-foreground" />
            </div>

            <div class="mt-4 space-y-3">
              <Input
                v-model="app.draftDirectory.value"
                placeholder="没有历史会话时，手动输入项目绝对路径"
              />

              <div class="soft-scrollbar flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
                <button
                  v-for="project in app.projects.value"
                  :key="project.directory"
                  class="min-w-[220px] rounded-2xl border px-4 py-3 text-left transition lg:min-w-0"
                  :class="
                    app.selectedProject.value === project.directory
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border/80 bg-white/80 hover:border-primary/35 hover:bg-white'
                  "
                  @click="app.selectedProject.value = project.directory"
                >
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-sm font-semibold">{{ project.name }}</span>
                    <Badge :tone="project.manual ? 'accent' : 'muted'">
                      {{ project.sessionCount }}
                    </Badge>
                  </div>
                  <p class="mt-2 break-all text-xs" :class="app.selectedProject.value === project.directory ? 'text-primary-foreground/80' : 'text-muted-foreground'">
                    {{ project.directory }}
                  </p>
                </button>
              </div>
            </div>
          </Card>

          <Card class="px-4 py-4 sm:px-5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  会话列表
                </p>
                <h2 class="mt-1 text-lg font-semibold tracking-[-0.02em]">{{ sessionCountLabel }}</h2>
              </div>
              <MessagesSquare class="h-5 w-5 text-muted-foreground" />
            </div>

            <div class="mt-4 flex flex-col gap-3">
              <Button variant="outline" :disabled="!app.canCreateSession.value" @click="app.createSession">
                <ArrowRight class="h-4 w-4" />
                新建当前项目会话
              </Button>

              <div class="soft-scrollbar max-h-[36vh] space-y-2 overflow-y-auto pr-1 lg:max-h-[58vh]">
                <button
                  v-for="session in app.filteredSessions.value"
                  :key="session.id"
                  class="w-full rounded-2xl border px-4 py-3 text-left transition"
                  :class="
                    app.selectedSessionId.value === session.id
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border/80 bg-white/80 hover:border-primary/35 hover:bg-white'
                  "
                  @click="app.openSession(session.id)"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <p class="text-sm font-semibold">
                        {{ session.title || '未命名会话' }}
                      </p>
                      <p
                        class="mt-1 text-xs"
                        :class="app.selectedSessionId.value === session.id ? 'text-primary-foreground/80' : 'text-muted-foreground'"
                      >
                        {{ formatRelativeTime(session.time.updated || session.time.created) }}
                      </p>
                    </div>
                    <Badge :tone="app.selectedSessionId.value === session.id ? 'accent' : 'muted'">
                      {{ session.id.slice(0, 6) }}
                    </Badge>
                  </div>
                </button>

                <div
                  v-if="!app.filteredSessions.value.length"
                  class="rounded-2xl border border-dashed border-border px-4 py-6 text-sm leading-6 text-muted-foreground"
                >
                  这个项目还没有会话。输入项目路径后点“新建当前项目会话”，就能开始新的上下文。
                </div>
              </div>
            </div>
          </Card>
        </div>

        <Card class="flex min-h-[65vh] flex-col overflow-hidden px-4 py-4 sm:px-5">
          <div class="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <Bot class="h-5 w-5 text-primary" />
                <h2 class="text-lg font-semibold tracking-[-0.02em]">
                  {{ app.activeSession.value?.title || '选择会话开始' }}
                </h2>
              </div>
              <p class="text-sm leading-6 text-muted-foreground">
                {{ app.selectedProjectMeta.value?.directory || app.draftDirectory.value || '先连接服务，再选项目。' }}
              </p>
            </div>

            <div class="flex items-center gap-2">
              <Badge tone="muted">{{ app.composerMode.value === 'command' ? '命令模式' : '对话模式' }}</Badge>
              <Badge :tone="app.sessionStatus.value === 'busy' || app.isSending.value ? 'accent' : 'success'">
                {{ sessionStatusText }}
              </Badge>
            </div>
          </div>

          <div class="soft-scrollbar flex-1 space-y-4 overflow-y-auto py-5 pr-1">
            <div
              v-if="app.lastError.value"
              class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
            >
              {{ app.lastError.value }}
            </div>

            <div
              v-if="app.isLoadingSession.value"
              class="flex items-center gap-2 rounded-2xl border border-border/80 bg-white/70 px-4 py-3 text-sm text-muted-foreground"
            >
              <LoaderCircle class="h-4 w-4 animate-spin" />
              正在恢复历史消息…
            </div>

            <template v-if="app.messages.value.length">
              <MessageBubble
                v-for="message in app.messages.value"
                :key="message.id"
                :message="message"
              />
            </template>

            <div
              v-else
              class="grid gap-3 rounded-[1.6rem] border border-dashed border-border/80 bg-white/60 px-5 py-6 text-sm leading-6 text-muted-foreground sm:grid-cols-3"
            >
              <div class="space-y-2">
                <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  1 / 选择项目
                </p>
                <p>从左边选已有目录，或者直接输入一个绝对路径。</p>
              </div>
              <div class="space-y-2">
                <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  2 / 打开会话
                </p>
                <p>点击历史会话即可继续聊天，也可以新建当前项目会话。</p>
              </div>
              <div class="space-y-2">
                <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  3 / 发消息或命令
                </p>
                <p>只保留纯文本内容，保证在手机上足够快、足够清楚。</p>
              </div>
            </div>
          </div>

          <div class="border-t border-border/70 pt-4">
            <div class="mb-3 flex flex-wrap items-center gap-2">
              <Button
                :variant="app.composerMode.value === 'prompt' ? 'default' : 'outline'"
                size="sm"
                @click="app.composerMode.value = 'prompt'"
              >
                <MessagesSquare class="h-4 w-4" />
                文本对话
              </Button>
              <Button
                :variant="app.composerMode.value === 'command' ? 'default' : 'outline'"
                size="sm"
                @click="app.composerMode.value = 'command'"
              >
                <TerminalSquare class="h-4 w-4" />
                命令
              </Button>
              <p class="text-xs text-muted-foreground">
                {{ currentModeHint }}
              </p>
            </div>

            <div class="space-y-3">
              <Textarea
                v-model="app.composerText.value"
                :disabled="!app.streamReady.value || app.isSending.value"
                :placeholder="app.composerMode.value === 'command' ? '/status' : '继续当前 opencode 对话…'"
                @keydown.ctrl.enter.prevent="app.sendCurrentMessage"
                @keydown.meta.enter.prevent="app.sendCurrentMessage"
              />

              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p class="text-xs leading-5 text-muted-foreground">
                  当前只渲染文本 part；工具调用和 diff 故意不显示，避免移动端噪音。
                </p>

                <Button :disabled="!app.streamReady.value || app.isSending.value" @click="app.sendCurrentMessage">
                  <LoaderCircle v-if="app.isSending.value" class="h-4 w-4 animate-spin" />
                  <Send v-else class="h-4 w-4" />
                  {{ app.composerMode.value === 'command' ? '发送命令' : '发送消息' }}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  </div>
</template>
