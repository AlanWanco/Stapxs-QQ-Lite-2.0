<template>
    <div v-if="dev" :class="'dev-bar' + (backend.platform == 'win32' ? ' win' : '')">
        Stapxs QQ Lite Development Mode
        {{ backend.platform ? ' / platform: ' + backend.platform : '' }}
        {{ ' / client: ' + appClient.type }}
        {{ ' / fps: ' + fps.value }}
    </div>
    <div v-if="['linux', 'win32'].includes(backend.platform ?? '')"
        :class="'top-bar' + ((backend.platform == 'win32' && dev) ? ' win' : '') + (backend.type == 'tauri' ? ' tauri' : '')"
        name="appbar"
        data-tauri-drag-region="true"
        @mousedown="handleAppbarMouseDown">
        <div class="bar-button" @click="barMainClick()" />
        <span v-if="runtimeData.sysConfig.opt_title_text_custom" class="top-bar-title">
            {{ processedTitle }}
        </span>
        <div class="space" />
        <div class="controller">
            <div class="min" @click="controllWin('minimize')">
                <font-awesome-icon :icon="['fas', 'minus']" />
            </div>
            <div class="close" @click="controllWin('close')">
                <font-awesome-icon :icon="['fas', 'xmark']" />
            </div>
        </div>
    </div>
    <div v-if="backend.platform == 'darwin'" class="controller mac-controller"
        data-tauri-drag-region="true" />
    <div id="base-app">
        <div class="main-body">
            <ul :style="get('fs_adaptation') > 0 ? `padding-bottom: ${get('fs_adaptation')}px;` : ''">
                <li id="bar-home" :class="(tags.page == 'Home' ? 'active' : '') +
                    (loginInfo.status ? ' hiden-home' : '')"
                    @click="changeTab('主页', 'Home', false)">
                    <font-awesome-icon :icon="['fas', 'home']" />
                    <span>{{ $t('主页') }}</span>
                </li>
                <li id="bar-msg" :class="tags.page == 'Messages' ? 'active' : ''"
                    @click="changeTab('信息', 'Messages', true)">
                    <font-awesome-icon :icon="['fas', 'envelope']" />
                    <span>{{ $t('信息') }}</span>
                </li>
                <li id="bar-friends" :class="tags.page == 'Friends' ? 'active' : ''"
                    @click="changeTab('列表', 'Friends', true)">
                    <font-awesome-icon :icon="['fas', 'user']" />
                    <span>{{ $t('列表') }}</span>
                </li>
                <div class="side-bar-space" />
                <li :class="tags.page == 'Options' ? 'active' : ''" @click="changeTab('设置', 'Options', false)">
                    <font-awesome-icon :icon="['fas', 'gear']" />
                    <span>{{ $t('设置') }}</span>
                </li>
            </ul>
            <div :style="get('fs_adaptation') > 0 ? `height: calc(100% - ${75 + Number(get('fs_adaptation'))}px);` : ''">
                <div v-if="tags.page == 'Home'" id="homeTab" name="主页">
                    <div class="home-body">
                        <div v-if="!napcat" class="login-pan-card ss-card">
                            <font-awesome-icon :icon="['fas', 'circle-nodes']" />
                            <p>{{ $t('连接到 OneBot') }}</p>
                            <form @submit.prevent @submit="connect">
                                <template v-if="loginInfo.quickLogin == null || loginInfo.quickLogin.length == 0">
                                    <label v-if="!sse">
                                        <font-awesome-icon :icon="['fas', 'link']" />
                                        <input id="sev_address" v-model="loginInfo.address" :placeholder="$t('连接地址')"
                                            class="ss-input" autocomplete="off">
                                    </label>
                                </template>
                                <div v-else class="ss-card quick-login">
                                    <div class="title">
                                        <font-awesome-icon :icon="['fas', 'link']" />
                                        <span>{{ $t('来自局域网的服务') }}</span>
                                        <a @click="cancelQUickLogin">{{ $t('取消') }}</a>
                                    </div>
                                    <div class="list">
                                        <div v-for="item in loginInfo.quickLogin" :key="item.address + ':' + item.port"
                                            :class="(tags.quickLoginSelect == item.address + ':' + item.port) ? 'select' : ''"
                                            @click="selectQuickLogin(item.address + ':' + item.port)">
                                            <span>{{ item.address }}:{{ item.port }}</span>
                                            <div><div /></div>
                                        </div>
                                    </div>
                                </div>
                                <label>
                                    <font-awesome-icon :icon="['fas', 'lock']" />
                                    <input id="access_token" v-model="loginInfo.token" :placeholder="$t('连接密钥')"
                                        class="ss-input" type="password" autocomplete="off">
                                </label>
                                <div style="display: flex">
                                    <label class="default">
                                        <input id="in_" v-model="tags.savePassword" type="checkbox"
                                            name="save_password"
                                            @click="savePassword">
                                        <a>{{ $t('记住密码') }}</a>
                                    </label>
                                    <div style="flex: 1" />
                                    <label class="default" style="justify-content: flex-end">
                                        <input v-model="runtimeData.sysConfig.auto_connect" type="checkbox"
                                            name="auto_connect" @click="saveAutoConnect">
                                        <a>{{ $t('自动连接') }}</a>
                                    </label>
                                </div>
                                <button id="connect_btn" class="ss-button" type="submit"
                                    :disabled="loginInfo.creating"
                                    @mousemove="afd">
                                    <template v-if="!loginInfo.creating">
                                        {{ $t('连接') }}
                                    </template>
                                    <template v-else>
                                        <font-awesome-icon :icon="['fas', 'spinner']" spin />
                                    </template>
                                </button>
                            </form>
                            <a :href="`https://github.com/${repoName}#%E5%BF%AB%E9%80%9F%E4%BD%BF%E7%94%A8`"
                                target="_blank" style="margin-bottom: -20px">{{ $t('如何连接') }}</a>
                            <div class="wave-pan" style="margin-left: -30px">
                                <svg id="login-wave" xmlns="http://www.w3.org/2000/svg"
                                    xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 24 170 70"
                                    preserveAspectRatio="none" shape-rendering="auto">
                                    <defs>
                                        <path id="gentle-wave" d="M -160 44 c 30 0 58 -18 88 -18 s 58 18 88 18 s 58 -18 88 -18 s 58 18 88 18 v 44 h -352 Z" />
                                    </defs>
                                    <g class="parallax">
                                        <use xlink:href="#gentle-wave" x="83" y="0" />
                                        <use xlink:href="#gentle-wave" x="135" y="3" />
                                        <use xlink:href="#gentle-wave" x="185" y="5" />
                                        <use xlink:href="#gentle-wave" x="54" y="7" />
                                    </g>
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>
                <div v-if="tags.page == 'Messages'" id="messageTab">
                    <Messages :chat="runtimeData.chatInfo" @user-click="changeChat" @load-history="loadHistory" />
                </div>
                <div v-if="tags.page == 'Friends'" id="friendTab">
                    <Friends :list="runtimeData.userList" @load-history="loadHistory" @user-click="changeChat" />
                </div>
                <div class="opt-main-tab" style="opacity: 0">
                    <Options :show="tags.page == 'Options'" :class="tags.page == 'Options' ? 'active' : ''"
                        :config="runtimeData.sysConfig" />
                </div>
            </div>
        </div>
        <component :is="runtimeData.pageView.chatView" v-if="
            loginInfo.status &&
                runtimeData.chatInfo &&
                runtimeData.chatInfo.show.id != 0"
            v-show="tags.showChat"
            ref="chat" :mumber-info="runtimeData.chatInfo.info.now_member_info == undefined ?
                {} : runtimeData.chatInfo.info.now_member_info"
            :merge-list="runtimeData.mergeMessageList"
            :list="runtimeData.messageList" :chat="runtimeData.chatInfo"
            @user-click="changeChat" />
        <TransitionGroup class="app-msg" name="appmsg" tag="div">
            <div v-for="msg in appMsgs" :key="'appmsg-' + msg.id">
                <div><font-awesome-icon :icon="['fas', msg.svg]" /></div>
                <a>{{ msg.text }}</a>
                <div v-if="!msg.autoClose" @click="popInfo.remove(msg.id)">
                    <font-awesome-icon :icon="['fas', 'xmark']" />
                </div>
            </div>
        </TransitionGroup>
        <Transition name="modal">
            <div v-if="runtimeData.popBoxList.length > 0" id="pop-box" class="pop-box">
                <div :class="'pop-box-body ss-card' +
                         (runtimeData.popBoxList[0].full ? ' full' : '') +
                         (get('option_view_no_window') == true ? '' : ' window')"
                    :style="(get('fs_adaptation') > 0 ? ` margin-bottom: ${40 + Number(get('fs_adaptation'))}px;` : '')">
                    <header v-show="runtimeData.popBoxList[0].title != undefined">
                        <div v-if="runtimeData.popBoxList[0].svg != undefined">
                            <font-awesome-icon :icon="['fas', runtimeData.popBoxList[0].svg]" />
                        </div>
                        <a>{{ runtimeData.popBoxList[0].title }}</a>
                        <font-awesome-icon v-if="runtimeData.popBoxList[0].allowClose != false"
                            :icon="['fas', 'xmark']" @click="removePopBox" />
                    </header>
                    <div v-if="runtimeData.popBoxList[0].html" v-html="runtimeData.popBoxList[0].html" />
                    <component :is="runtimeData.popBoxList[0].template" v-else :data="runtimeData.popBoxList[0].data"
                        v-bind="runtimeData.popBoxList[0].templateValue" />
                    <div v-show="runtimeData.popBoxList[0].button" class="button">
                        <button v-for="(button, index) in runtimeData.popBoxList[0].button"
                            :key="'pop-box-btn' + index" :class="'ss-button' + (button.master == true ? ' master' : '')"
                            @click="button.fun">
                            {{ button.text }}
                        </button>
                    </div>
                    <div class="pop-box-more">
                        <div v-for="index in runtimeData.popBoxList.length" :key="'pop-more-' + index" :data-id="index"
                            :class="index > runtimeData.popBoxList.length - 1 ? 'hid' : '' "
                            :style="'margin:-' + 2 * (index - 1) + 'px ' + (20 * index - 1 - 2 * (index - 1)) + 'px 0 ' + (20 * index - 1 - 2 * (index - 1)) + 'px;'" />
                    </div>
                </div>
                <div @click="popQuickClose(runtimeData.popBoxList[0].allowQuickClose != false && runtimeData.popBoxList[0].allowClose != false)" />
            </div>
        </Transition>
        <!-- 全局搜索栏 -->
        <GlobalSessionSearchBar />
        <NtViewer ref="nt-viewer" />
        <!-- 提示工具 -->
        <Tooltips />
        <div id="mobile-css" />
    </div>
</template>

<script setup lang="ts">
import { useTemplateRef, provide } from 'vue'
import NtViewer from './components/ViewerCom.vue'

// 注册组件实例
const ntViewer = useTemplateRef<InstanceType<typeof NtViewer>>('nt-viewer')
provide('viewer', ntViewer)
</script>

<script lang="ts">
import Spacing from 'spacingjs/src/spacing'
import app from '@renderer/main'
import Option from '@renderer/function/option'
import Umami from '@stapxs/umami-logger-typescript'
import * as App from './function/utils/appUtil'
import anime from 'animejs'
import packageInfo from '../../../package.json'

import { defineComponent, defineAsyncComponent } from 'vue'
import { Connector, login as loginInfo } from '@renderer/function/connect'
import { Logger, popList, PopInfo, LogType } from '@renderer/function/base'
import { runtimeData } from '@renderer/function/msg'
import { BaseChatInfoElem } from '@renderer/function/elements/information'
import { Notify } from './function/notify'
import { updateBaseOnMsgList } from './function/utils/msgUtil'
import { getDeviceType } from './function/utils/systemUtil'
import { uptime } from '@renderer/main'

import Options from '@renderer/pages/Options.vue'
import Friends from '@renderer/pages/Friends.vue'
import Messages from '@renderer/pages/Messages.vue'
import { backend } from './runtime/backend'
import GlobalSessionSearchBar from './components/GlobalSessionSearchBar.vue'
import Tooltips from './components/tooltip/Tooltips.vue'

export default defineComponent({
    name: 'App',
    components: {
        Options,
        Friends,
        Messages,
        GlobalSessionSearchBar,
        NtViewer,
        Tooltips
    },
    data() {
        return {
            repoName: import.meta.env.VITE_APP_REPO_NAME,
            appClient: backend,
            dev: import.meta.env.DEV,
            napcat: import.meta.env.VITE_NAPCAT,
            sse: import.meta.env.VITE_APP_SSE_MODE == 'true',
            defineAsyncComponent: defineAsyncComponent,
            save: Option.runASWEvent,
            get: Option.get,
            popInfo: new PopInfo(),
            appMsgs: popList,
            loadHistory: App.loadHistory,
            tags: {
                page: 'Home',
                showChat: false,
                isSavePwdClick: false,
                savePassword: false,
                quickLoginSelect: ''
            },
            fps: {
                last: Date.now(),
                ticks: 0,
                value: 0,
            },
            backend: backend,
            runtimeData: runtimeData,
            loginInfo: loginInfo
        }
    },
    computed: {
        processedTitle() {
            if (runtimeData.sysConfig.opt_title_text_custom) {
                let title = runtimeData.sysConfig.custom_title_text
                title = title.replace('{version}', packageInfo.version)
                title = title.replace('{nickname}', runtimeData.loginInfo.nickname || '')
                return title
            }
            return ''
        }
    },
    mounted() {
        const logger = new Logger()
        window.moYu = () => { return '\x75\x6e\x64\x65\x66\x69\x6e\x65\x64' }
        
        // 禁止所有原生滚动行为
        window.addEventListener('scroll', () => {
            if (backend.platform !== 'android') {
                if (window.scrollX !== 0 || window.scrollY !== 0) {
                    window.scrollTo(0, 0)
                }
            }
        }, { passive: true })

        // 全局 Tab 键焦点管理
        window.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Tab') {
                const focusableSelector = 'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
                const elements = Array.from(document.querySelectorAll(focusableSelector)) as HTMLElement[]
                const focusableElements = elements.filter(el => {
                    const style = window.getComputedStyle(el)
                    return !el.hasAttribute('disabled') && 
                           style.display !== 'none' && 
                           style.visibility !== 'hidden' && 
                           el.offsetWidth > 0 && 
                           el.offsetHeight > 0
                })
                if (focusableElements.length > 0) {
                    e.preventDefault()
                    const currIndex = focusableElements.indexOf(document.activeElement as HTMLElement)
                    let nextIndex = 0
                    if (currIndex === -1) {
                        nextIndex = e.shiftKey ? focusableElements.length - 1 : 0
                    } else {
                        nextIndex = (currIndex + (e.shiftKey ? -1 : 1) + focusableElements.length) % focusableElements.length
                    }
                    focusableElements[nextIndex].focus({ preventScroll: true })
                    setTimeout(() => {
                        const containers = document.querySelectorAll('html, body, .main-body, .main-body > div, #base-app, #app')
                        containers.forEach(el => {
                            if (el.scrollTop !== 0) el.scrollTop = 0
                            if (el.scrollLeft !== 0) el.scrollLeft = 0
                        })
                        window.scrollTo(0, 0)
                    }, 0)
                }
            }
        }, true)

        // 焦点补丁
        window.addEventListener('focusin', () => {
            setTimeout(() => {
                const containers = document.querySelectorAll('.main-body, .main-body > div, #base-app, #app')
                containers.forEach(el => {
                    if (el.scrollTop !== 0) el.scrollTop = 0
                    if (el.scrollLeft !== 0) el.scrollLeft = 0
                })
                window.scrollTo(0, 0)
            }, 0)
        }, { passive: true })

        // 右键穿透
        window.addEventListener('contextmenu', (e: MouseEvent) => {
            const target = e.target as HTMLElement
            if (target && target.classList && target.classList.contains('msg-menu-bg')) {
                e.preventDefault()
                e.stopPropagation()
                target.style.display = 'none'
                const under = document.elementFromPoint(e.clientX, e.clientY)
                target.style.display = ''
                target.click()
                if (under) {
                    const newEvent = new MouseEvent('contextmenu', {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        button: 2,
                        buttons: 2,
                        clientX: e.clientX,
                        clientY: e.clientY
                    })
                    under.dispatchEvent(newEvent)
                }
            }
        }, true)

        this.init()

        // 页面关闭前
        window.onbeforeunload = () => {
            logger.system('开发者阁下—— 唔，阁下离开的太匆忙了！让我来帮开发者阁下收拾下东西吧。')
            new Notify().clear()
            if(import.meta.env.DEV) {
                Connector.close()
            }
        }
    },
    async created() {
        const logger = new Logger()
        window.onerror = (message, source, lineno, colno, error) => {
            logger.error(null, `Uncaught Error: ${message} at ${source}:${lineno}:${colno}`)
            if (error) logger.error(null, (error as any).stack || (error as any).message)
        }
        window.onunhandledrejection = (event) => {
            logger.error(null, `Unhandled Rejection: ${event.reason}`)
        }

        await backend.init()
        const systemInfo = {
            release: await backend.call('sys', 'sys:getRelease', true),
            arch: await backend.call('sys', 'sys:getArch', true),
        }
        runtimeData.plantform = systemInfo
        if(backend.isDesktop()) {
            if (backend.type == 'electron') this.tags.isElectron = true
        }
        if(backend.isMobile()) this.tags.isCapacitor = true

        if (this.dev) {
            const requestAnimationFrame = window.requestAnimationFrame
            const loop = () => {
                this.fps.ticks++
                if (Date.now() - this.fps.last >= 1000) {
                    this.fps.value = this.fps.ticks
                    this.fps.ticks = 0
                    this.fps.last = Date.now()
                }
                requestAnimationFrame(loop)
            }
            requestAnimationFrame(loop)
            window.addEventListener('keydown', (e) => {
                if (e.ctrlKey && e.key === 'd') {
                    e.preventDefault()
                    this.tags.page = 'Dev'
                }
            })
        }

        if (backend.isMobile()) {
            const safeArea = await backend.call('SafeArea', 'getSafeArea', true)
            if (safeArea) {
                document.documentElement.style.setProperty('--safe-area-top', safeArea.top + 'px')
                document.documentElement.style.setProperty('--safe-area-bottom', safeArea.bottom + 'px')
                document.documentElement.style.setProperty('--safe-area-left', safeArea.left + 'px')
                document.documentElement.style.setProperty('--safe-area-right', safeArea.right + 'px')
            }
        }
        new Notify().init()
    },
    methods: {
        async init() {
            const logger = new Logger()
            App.loadApendCss()
            App.updateThemeColor()
            const urlParams = new URLSearchParams(window.location.search)
            const token = urlParams.get('token')
            if (token) this.updateNapcatColor(token)
            
            runtimeData.sysConfig = await Option.load()
            if (backend.isDesktop()) {
                backend.call('sys', 'sys_get_default_face_path', true).then((path) => {
                    runtimeData.tags.default_face_path = path as string
                })
            }
            if (Option.get('auto_connect') == true) this.connect()
            
            const appEl = document.getElementById('base-app')
            if (appEl) {
                anime({
                    targets: appEl,
                    opacity: [0, 1],
                    duration: 1000,
                    easing: 'easeInOutQuad',
                })
                if (['linux', 'win32', 'darwin'].includes(backend.platform ?? '')) {
                    appEl.classList.add('withBar')
                }
            }

            if (!this.dev && !Option.get('close_ga')) {
                Umami.init(import.meta.env.VITE_APP_UMAMI_ID, import.meta.env.VITE_APP_UMAMI_URL)
                Umami.trackPageView('/')
                sendIdentifyData({
                    platform: backend.platform,
                    client: backend.type,
                    version: packageInfo.version
                })
            }
            App.checkNotice()
            
            this.$watch(() => runtimeData.baseOnMsgList, () => {
                if (backend.isDesktop()) {
                    const list = [] as { id: number, name: string, image?: string }[]
                    runtimeData.baseOnMsgList.forEach((item) => {
                        list.push({
                            id: item.user_id ? item.user_id : (item as any).group_id,
                            name: (item as any).group_name ? (item as any).group_name : item.remark === item.nickname ? item.nickname : item.remark + '（' + item.nickname + '）',
                            image: item.user_id ? 'https://q1.qlogo.cn/g?b=qq&s=0&nk=' + item.user_id : 'https://p.qlogo.cn/gh/' + (item as any).group_id + '/' + (item as any).group_id + '/0'
                        })
                    })
                    backend.call(undefined, 'sys:flushOnMessage', false, list)
                }
                updateBaseOnMsgList()
            }, { deep: true })

            this.$watch(() => this.processedTitle, (newVal) => {
                if (runtimeData.sysConfig.opt_title_text_custom && newVal) {
                    if (backend.platform == 'web') {
                        document.title = newVal + '- Stapxs QQ Lite'
                    } else {
                        document.title = newVal
                        backend.call(undefined, 'win:setTitle', false, newVal)
                    }
                }
            }, { immediate: true })

            if (!runtimeData.sysConfig.opt_title_text_custom) {
                const titleList = ['你好世界！', '这只是个普通的彩蛋！']
                const title = titleList[Math.floor(Math.random() * titleList.length)]
                if(backend.platform == 'web') document.title = title + '- Stapxs QQ Lite'
                else {
                    document.title = title
                    backend.call(undefined, 'win:setTitle', false, title)
                }
            }
        },

        updateNapcatColor(token: string) {
            fetch('/api/Base/Theme', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                }
            }).then(async (response) => {
                if(response.ok) {
                    const data = await response.json()
                    const media = window.matchMedia('(prefers-color-scheme: dark)')
                    const colorHsl = media.matches ? data.data.dark['--heroui-primary'] : data.data.light['--heroui-primary']
                    const alpha = media.matches ? '.3' : '.1'
                    document.documentElement.style.setProperty('--color-main', `hsl(${colorHsl} / ${alpha})`)
                    document.documentElement.style.setProperty('--color-main-0', `hsl(${colorHsl} / ${alpha})`)
                }
            })
        },

        controllWin(name: string) {
            backend.call(undefined, 'win:' + name, false)
        },

        handleAppbarMouseDown(event: MouseEvent) {
            if (backend.platform === 'linux' && backend.type === 'tauri') {
                const target = event.target as HTMLElement
                if (!target.closest('.bar-button') && !target.closest('.controller')) {
                    backend.call(undefined, 'win:startDrag', false)
                }
            }
        },

        connect() {
            if(this.tags.quickLoginSelect != '') {
                loginInfo.address = 'ws://' + this.tags.quickLoginSelect
            } else {
                const httpRegex = /^https?:\/\/[^/]+:\d+$/;
                if (httpRegex.test(loginInfo.address)) loginInfo.address += '/';
            }
            Connector.create(loginInfo.address, loginInfo.token)
        },
        selectQuickLogin(address: string) { this.tags.quickLoginSelect = address },
        cancelQUickLogin() { loginInfo.quickLogin = null },

        changeTab(_: string, view: string, show: boolean) {
            if (!Option.get('close_ga') && !this.dev) Umami.trackPageView('/' + view)
            this.tags.showChat = show
            this.tags.page = view
            const optTab = document.getElementsByClassName('opt-main-tab')[0] as HTMLDivElement
            if (view === 'Options') {
                Connector.send('get_version_info', {}, 'getVersionInfo')
                if (optTab) optTab.style.opacity = '1'
            } else if (view === 'Home' && optTab) optTab.style.opacity = '0'
        },
        barMainClick() {
            if (loginInfo.status) this.changeTab('信息', 'Messages', true)
            else this.changeTab('主页', 'Home', false)
        },

        waveAnimation(wave: HTMLElement | null) {
            if (wave) {
                const waves = wave.children[1].children
                return setInterval(() => {
                    for (let i = 0; i < waves.length; i++) {
                        const now = Number(waves[i].getAttribute('x'))
                        waves[i].setAttribute('x', (now + 1 > 195 ? 20 : now + 1).toString())
                    }
                }, 50)
            }
            return null
        },

        savePassword() { this.tags.isSavePwdClick = true },
        saveAutoConnect() {
            this.save({ target: { name: 'auto_connect', checked: !runtimeData.sysConfig.auto_connect } } as any)
        },
        afd() {},
        removePopBox() { runtimeData.popBoxList.shift() },
        popQuickClose(allow: boolean) { if (allow) runtimeData.popBoxList.shift() },
        changeChat(user: any) {
            this.tags.showChat = true
            Connector.send('get_group_info', { group_id: user.group_id }, 'getGroupInfo')
        }
    }
})
</script>

<style scoped>
#base-app {
    width: 100%;
    height: 100%;
}
</style>
