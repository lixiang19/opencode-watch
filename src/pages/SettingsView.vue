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
      <div class="page-intro">
        <p class="wechat-overline">连接中心</p>
        <h1 class="wechat-title">设置</h1>
        <p class="page-copy">统一管理服务连接与默认路径，让界面保持轻盈且可预测。</p>
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
        <span>认证账号</span>
        <Input v-model="app.username.value" placeholder="请输入账号" autocomplete="username" />
      </label>

      <label class="settings-field">
        <span>认证密码</span>
        <Input
          v-model="app.password.value"
          type="password"
          placeholder="请输入密码"
          autocomplete="current-password"
        />
      </label>

      <p class="settings-hint">账号密码不再预填；清空后会重新弹出认证窗口。</p>

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

<style scoped>
.page {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  gap: 1rem;
  padding-top: calc(env(safe-area-inset-top) + 1rem);
}

.wechat-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.page-intro {
  max-width: 34rem;
}

.wechat-overline {
  margin: 0 0 0.5rem;
  color: var(--primary);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.wechat-title {
  margin: 0;
  color: var(--foreground);
  font-size: clamp(2rem, 6vw, 3rem);
  line-height: 1;
}

.page-copy,
.settings-field span,
.settings-hint {
  color: var(--muted-foreground);
}

.page-copy {
  margin: 0.75rem 0 0;
  line-height: 1.7;
}

.settings-state,
.settings-form,
.settings-error {
  border: 1px solid var(--border);
  border-radius: 1.5rem;
  background: var(--card);
  box-shadow: var(--shadow-lg);
}

.settings-state {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.875rem;
  padding: 1.25rem;
}

.settings-state-ok {
  border-color: color-mix(in srgb, var(--primary) 35%, var(--border));
}

.settings-state-off {
  border-color: color-mix(in srgb, var(--destructive) 32%, var(--border));
}

.settings-state-icon {
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  border-radius: 1rem;
  background: var(--accent);
  color: var(--accent-foreground);
}

.settings-state strong {
  color: var(--foreground);
}

.settings-state p {
  margin: 0.375rem 0 0;
  color: var(--muted-foreground);
  line-height: 1.7;
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: 1.25rem;
}

.settings-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.settings-field span {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.settings-hint {
  margin: 0;
  line-height: 1.7;
}

.settings-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.settings-button {
  width: 100%;
}

.settings-error {
  margin: 0;
  padding: 1rem 1.125rem;
  border-color: color-mix(in srgb, var(--destructive) 40%, var(--border));
  color: var(--destructive);
}

@media (max-width: 640px) {
  .settings-actions {
    grid-template-columns: 1fr;
  }
}
</style>
