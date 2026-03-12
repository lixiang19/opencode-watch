import { inject, provide, type InjectionKey } from 'vue'

import { useOpencodeApp } from '@/composables/useOpencodeApp'

export type OpencodeAppState = ReturnType<typeof useOpencodeApp>

const opencodeAppKey: InjectionKey<OpencodeAppState> = Symbol('opencode-app')

export function provideOpencodeState(state: OpencodeAppState) {
  provide(opencodeAppKey, state)
}

export function useOpencodeState() {
  const state = inject(opencodeAppKey)

  if (!state) {
    throw new Error('Opencode app state is not available.')
  }

  return state
}
