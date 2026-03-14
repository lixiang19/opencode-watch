<script setup lang="ts">
import { computed } from 'vue'
import { KeyRound, RefreshCw, ShieldAlert } from 'lucide-vue-next'

import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import { useOpencodeStore } from '@/stores/opencode'

const app = useOpencodeStore()

const isAdminMode = computed(() => app.authGateMode === 'admin')
const passwordModel = computed({
  get: () => (isAdminMode.value ? app.adminPassword : app.password),
  set: (value: string) => {
    if (isAdminMode.value) {
      app.adminPassword = value
      return
    }

    app.password = value
  }
})
const canSubmit = computed(() => {
  if (isAdminMode.value) {
    return Boolean(app.adminPassword.trim())
  }

  return Boolean(app.username.trim()) && Boolean(app.password.trim())
})

async function submitAuth() {
  if (!canSubmit.value) {
    return
  }

  if (isAdminMode.value) {
    await app.loginAdmin()
    return
  }

  if (app.isConnecting) {
    return
  }

  await app.connect()
}
</script>

<template>
  <div v-if="app.authGateVisible" class="auth-gate" role="dialog" aria-modal="true" aria-labelledby="auth-gate-title">
    <div class="auth-gate-backdrop" />

    <section class="auth-gate-panel">
      <div class="auth-gate-icon">
        <ShieldAlert class="h-5 w-5" />
      </div>

      <p class="auth-gate-kicker">{{ isAdminMode ? '管理端鉴权' : 'OpenCode 认证' }}</p>
      <h2 id="auth-gate-title">{{ isAdminMode ? '先完成管理登录' : '先完成账号验证' }}</h2>
      <p class="auth-gate-copy">{{ app.authGateMessage }}</p>

      <form class="auth-gate-form" @submit.prevent="submitAuth">
        <label v-if="!isAdminMode" class="settings-field">
          <span>认证账号</span>
          <Input v-model="app.username" placeholder="请输入账号" autocomplete="username" autofocus />
        </label>

        <label class="settings-field">
          <span>{{ isAdminMode ? '管理密码' : '认证密码' }}</span>
          <Input
            v-model="passwordModel"
            type="password"
            :placeholder="isAdminMode ? '请输入管理密码' : '请输入认证密码'"
            autocomplete="current-password"
            :autofocus="isAdminMode"
          />
        </label>



        <Button class="auth-gate-submit" type="submit" :disabled="!canSubmit || (isAdminMode ? app.isAdminAuthenticating : app.isConnecting)">
          <RefreshCw v-if="isAdminMode ? app.isAdminAuthenticating : app.isConnecting" class="h-4 w-4 animate-spin" />
          <ShieldAlert v-else class="h-4 w-4" />
          {{ isAdminMode ? (app.isAdminAuthenticating ? '登录中...' : '登录并进入') : (app.isConnecting ? '验证中...' : '验证并进入') }}
        </Button>
      </form>
    </section>
  </div>
</template>

<style scoped>
.auth-gate {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.auth-gate-backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--background) 40%, black);
  backdrop-filter: blur(10px);
}

.auth-gate-panel {
  position: relative;
  width: min(100%, 27rem);
  padding: 1.5rem;
  border: 1px solid var(--border);
  border-radius: 1.75rem;
  background: var(--card);
  box-shadow: var(--shadow-2xl);
}

.auth-gate-icon {
  display: grid;
  width: 3.25rem;
  height: 3.25rem;
  place-items: center;
  border-radius: 1rem;
  background: var(--accent);
  color: var(--accent-foreground);
}

.auth-gate-kicker {
  margin: 1rem 0 0.5rem;
  color: var(--primary);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.auth-gate-panel h2 {
  margin: 0;
  color: var(--foreground);
  font-size: clamp(1.75rem, 5vw, 2.25rem);
  line-height: 1;
}

.auth-gate-copy,
.auth-gate-note,
.settings-field span {
  color: var(--muted-foreground);
}

.auth-gate-copy {
  margin: 0.75rem 0 0;
  line-height: 1.7;
}

.auth-gate-form {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  margin-top: 1.25rem;
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

.auth-gate-note {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  line-height: 1.6;
}

.auth-gate-submit {
  width: 100%;
  justify-content: center;
}
</style>
