<script setup lang="ts">
import { computed } from 'vue'
import { CircleAlert, Link2, RefreshCw, ShieldCheck } from 'lucide-vue-next'

import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import { useOpencodeState } from '@/lib/app-context'

const app = useOpencodeState()

const connectionTone = computed(() => (app.streamReady.value ? 'settings-state-ok' : 'settings-state-off'))
</script>

<template>
  <section class="page settings-page">
    <header class="wechat-header">
      <div>
        <p class="wechat-overline">连接中心</p>
        <h1 class="wechat-title">设置</h1>
      </div>
    </header>

    <div class="settings-state" :class="connectionTone">
      <div class="settings-state-icon">
        <ShieldCheck v-if="app.streamReady.value" class="h-5 w-5" />
        <CircleAlert v-else class="h-5 w-5" />
      </div>
      <div>
        <strong>{{ app.connectionStateLabel.value }}</strong>
        <p>{{ app.streamReady.value ? '事件流已连接，可以直接新建对话。' : '连接失败时会在这里显示错误信息。' }}</p>
      </div>
    </div>

    <div class="settings-form">
      <label class="settings-field">
        <span>服务地址</span>
        <Input v-model="app.serverUrl.value" placeholder="http://127.0.0.1:4096" />
      </label>

      <label class="settings-field">
        <span>用户名</span>
        <Input v-model="app.username.value" placeholder="opencode" />
      </label>

      <label class="settings-field">
        <span>密码</span>
        <Input v-model="app.password.value" type="password" placeholder="留空则不认证" />
      </label>

      <label class="settings-field">
        <span>默认项目路径</span>
        <Input v-model="app.draftDirectory.value" placeholder="/Users/name/project" />
      </label>

      <div class="settings-actions">
        <Button class="settings-button" :disabled="app.isConnecting.value" @click="app.connect">
          <Link2 v-if="!app.isConnecting.value" class="h-4 w-4" />
          <RefreshCw v-else class="h-4 w-4 animate-spin" />
          {{ app.isConnecting.value ? '连接中...' : '重新连接' }}
        </Button>
        <Button variant="outline" class="settings-button" :disabled="app.isRefreshing.value" @click="app.refreshSessions({ reopen: false })">
          <RefreshCw class="h-4 w-4" :class="app.isRefreshing.value ? 'animate-spin' : ''" />
          同步项目
        </Button>
      </div>
    </div>

    <p v-if="app.lastError.value" class="settings-error">{{ app.lastError.value }}</p>
  </section>
</template>
