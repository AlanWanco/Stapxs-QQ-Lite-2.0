import VueClipboard from 'vue-clipboard2'

import App from './App.vue'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { library } from '@fortawesome/fontawesome-svg-core'
import { fas } from '@fortawesome/free-solid-svg-icons'

import { faSquare } from '@fortawesome/free-regular-svg-icons'

import './assets/css/view.css'
import './assets/css/chat.css'
import './assets/css/msg.css'
import './assets/css/options.css'
import './assets/css/sys_notice.css'

import { getPortableFileLang } from './function/utils/systemUtil'
import { preloadPinyin } from './function/utils/pinyin'

const zh = getPortableFileLang('zh-CN')

// 载入 l10n
const messages = { 'zh-CN': zh }
// 初始化 i18n
export const i18n = createI18n({
    legacy: false,
    locale: 'zh-CN',
    fallbackLocale: 'zh-CN',
    silentFallbackWarn: true,
    messages,
})

// 创建 App
const app = createApp(App)
app.use(i18n)
app.use(createPinia())
app.use(VueClipboard)

library.add(fas)
library.add(faSquare)
app.component('FontAwesomeIcon', FontAwesomeIcon)

app.mount('#app')
export default app
export const uptime = new Date().getTime()

// 预加载拼音库（非阻塞，失败不影响应用启动）
preloadPinyin()
