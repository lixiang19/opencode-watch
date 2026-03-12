<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, PlugZap, RefreshCw, ShieldCheck } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import Badge from '@/components/ui/badge/Badge.vue'
import Button from '@/components/ui/button/Button.vue'
import Card from '@/components/ui/card/Card.vue'
import Input from '@/components/ui/input/Input.vue'
import { useOpencodeState } from '@/lib/app-context'

const router = useRouter()
const app = useOpencodeState()

const connectionTone = computed(() => {
  if (app.lastError.value) {
    return 'danger'
  }

  return app.streamReady.value ? 'success' : 'muted'
})
</script>

<template>
  <div class="screen-page pb-8">
    <header class="flex items-center gap-3 px-1 pt-1">
      <button class="icon-chip" type="button" @click="router.back()">
        <ChevronLeft class="h-5 w-5" />
      </button>
      <div>
        <p class="eyebrow">连接设置</p>
        <h1 class="text-2xl font-semibold tracking-[-0.04em] text-slate-950">保持手机端随时接续</h1>
      </div>
    </header>

    <Card class="settings-hero mt-5">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="eyebrow">当前状态</p>
          <p class="mt-1 text-lg font-semibold text-slate-950">{{ app.connectionStateLabel.value }}</p>
        </div>
        <Badge :tone="connectionTone">{{ app.lastError.value ? '异常' : '正常' }}</Badge>
      </div>

      <p class="mt-3 text-sm leading-6 text-slate-500">
        这里单独放连接和认证，不再打断首页的聊天节奏。连好一次，后面就只管继续对话。
      </p>
    </Card>

    <Card class="mt-4 space-y-4 p-5">
      <div class="field-block">
        <label class="field-label">服务地址</label>
        <Input v-model="app.serverUrl.value" placeholder="http://127.0.0.1:4096" />
      </div>

      <div class="field-block">
        <label class="field-label">用户名</label>
        <Input v-model="app.username.value" placeholder="opencode" />
      </div>

      <div class="field-block">
        <label class="field-label">密码</label>
        <Input v-model="app.password.value" type="password" placeholder="如未启用可留空" />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <Button :disabled="app.isConnecting.value" @click="app.connect">
          <PlugZap v-if="!app.isConnecting.value" class="h-4 w-4" />
          <RefreshCw v-else class="h-4 w-4 animate-spin" />
          {{ app.isConnecting.value ? '连接中' : '连接' }}
        </Button>
        <Button variant="outline" :disabled="app.isRefreshing.value" @click="app.refreshSessions({ reopen: false })">
          <RefreshCw class="h-4 w-4" :class="app.isRefreshing.value ? 'animate-spin' : ''" />
          刷新会话
        </Button>
      </div>
    </Card>

    <Card class="mt-4 p-5">
      <div class="flex items-start gap-3">
        <div class="status-icon">
          <ShieldCheck class="h-5 w-5" />
        </div>
        <div>
          <p class="text-sm font-semibold text-slate-950">项目默认目录</p>
          <p class="mt-1 text-sm leading-6 text-slate-500">
            当服务里还没有历史会话时，可以先给一个绝对路径，方便直接创建第一个会话。
          </p>
        </div>
      </div>

      <div class="mt-4">
        <Input v-model="app.draftDirectory.value" placeholder="/Users/name/project" />
      </div>
    </Card>

    <Card v-if="app.lastError.value" class="mt-4 border-red-200 bg-red-50/90 p-5 text-sm leading-6 text-red-700">
      {{ app.lastError.value }}
    </Card>
  </div>
</template>
