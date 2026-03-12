<script setup lang="ts">
import { computed } from 'vue'
import { SendHorizonal, LoaderCircle } from 'lucide-vue-next'

import { useOpencodeState } from '@/lib/app-context'

const app = useOpencodeState()

const disabled = computed(() => !app.streamReady.value || app.isSending.value)
</script>

<template>
  <footer class="composer">
    <div class="composer-input-row">
      <textarea
        :value="app.composerText.value"
        :disabled="disabled"
        placeholder="发送消息… (/ 开头执行命令)"
        class="composer-input soft-scrollbar"
        rows="1"
        @input="app.composerText.value = ($event.target as HTMLTextAreaElement).value"
        @keydown.ctrl.enter.prevent="app.sendCurrentMessage"
        @keydown.meta.enter.prevent="app.sendCurrentMessage"
      />
      <button
        type="button"
        class="btn-send"
        :disabled="disabled"
        @click="app.sendCurrentMessage"
      >
        <LoaderCircle v-if="app.isSending.value" class="h-5 w-5 animate-spin" />
        <SendHorizonal v-else class="h-5 w-5" />
      </button>
    </div>
  </footer>
</template>
