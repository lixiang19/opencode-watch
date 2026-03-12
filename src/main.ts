import { createApp } from 'vue'

import App from './App.vue'
import themeSource from './theme.css?raw'
import { router } from './router'

const themeStyle = document.createElement('style')

themeStyle.textContent = themeSource
  .replace(/@import[^;]+;\s*/g, '')
  .replace(/@custom-variant[^;]+;\s*/g, '')
  .replace(/@theme inline\s*\{[\s\S]*?\}\s*/g, '')
  .replace(/@layer base\s*\{[\s\S]*?\}\s*/g, '')

document.head.appendChild(themeStyle)

createApp(App).use(router).mount('#app')
