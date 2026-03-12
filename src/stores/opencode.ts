import { defineStore } from 'pinia'

import { useOpencodeApp } from '@/composables/useOpencodeApp'

export const useOpencodeStore = defineStore('opencode', () => useOpencodeApp())
