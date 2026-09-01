<template>
    <div v-if="dev" :class="'dev-bar' + (backend.platform == 'win32' ? ' win' : '')">
        Stapxs QQ Lite Development Mode
        {{ backend.platform ? ' / platform: ' + backend.platform : '' }}
        {{ ' / client: ' + appClient.type }}
        {{ ' / fps: ' + fps.value }}
    </div>
    <div v-if="!isChatWindow && ['linux', 'win32'].includes(backend.platform ?? '')"
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
    <div v-if="!isChatWindow && backend.platform == 'darwin'" class="controller mac-controller"
        data-tauri-drag-region="true" />
    <div id="base-app">
        <div v-if="!isChatWindow" class="main-body">
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
                <li v-if="showFileManagerEntry" :class="tags.showFileManager ? 'active' : ''"
                    @click="toggleFileManager(undefined)">
                    <font-awesome-icon :icon="['fas', 'arrow-down']" />
                    <span>{{ $t('传输') }}</span>
                </li>
                <li :class="tags.page == 'Options' ? 'active' : ''" @click="changeTab('设置', 'Options', false)">
                    <font-awesome-icon :icon="['fas', 'gear']" />
                    <span>{{ $t('设置') }}</span>
                </li>
            </ul>
            <div :style="get('fs_adaptation') > 0 ? `height: calc(100% - ${75 + Number(get('fs_adaptation'))}px);` : ''">
                <div v-if="tags.page == 'Home'" id="homeTab" name="主页">
                    <div :class="'home-body' + (runtimeData.tags.openSideBar ? ' open' : '')">
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
                    <Messages :chat="runtimeData.chatInfo" @user-click="changeChat" @open-chat-window="openChatWindow" @load-history="loadHistory" />
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
                runtimeData.chatInfo.show.id != 0 &&
                (isChatWindow || tags.showChat)"
            v-show="tags.showChat"
            ref="chat" :mumber-info="runtimeData.chatInfo.info.now_member_info == undefined ?
                {} : runtimeData.chatInfo.info.now_member_info"
            :merge-list="runtimeData.mergeMessageList"
            :list="runtimeData.messageList" :chat="runtimeData.chatInfo"
            :detached="isChatWindow"
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
        <Transition name="music-player-float">
            <div v-show="tags.showFileManager" class="global-music-player ss-card">
                <FileManager />
            </div>
        </Transition>
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
import Spacing from 'spacingjs/src/spacing'
import app from '@renderer/main'
import Option from '@renderer/function/option'
import Umami from '@stapxs/umami-logger-typescript'
import * as App from './function/utils/appUtil'
import anime from 'animejs'
import packageInfo from '../../../package.json'

import { defineComponent, defineAsyncComponent, useTemplateRef, provide } from 'vue'
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
import FileManager, { panelVisible, closePanel, getDownloadTasks, getUploadTasks } from './components/FileManager.vue'
import GlobalSessionSearchBar from './components/GlobalSessionSearchBar.vue'
import NtViewer from './components/ViewerCom.vue'
import Tooltips from './components/tooltip/Tooltips.vue'

// 注册组件实例
const ntViewer = useTemplateRef<InstanceType<typeof NtViewer>>('nt-viewer')
provide('viewer', ntViewer)
</script>

<script lang="ts">
export default defineComponent({
    name: 'App',
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
                showFileManager: false,
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
            loginInfo: loginInfo,
            windowWidth: window.innerWidth,
            panelVisibleUnwatch: null as null | (() => void),
            fileManagerEntryUnwatch: null as null | (() => void),
            isChatWindow: new URLSearchParams(window.location.search).get('chatWindow') === '1',
            chatWindowKey: '',
            chatWindows: {} as Record<string, any>,
            restoringMainChat: false,
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
        },
        hasTransferTasks() {
            return getDownloadTasks().length > 0 || getUploadTasks().length > 0
        },
        hasActiveTransferTasks() {
            return [...getDownloadTasks(), ...getUploadTasks()].some((task) => {
                return ['pending', 'downloading', 'uploading'].includes(task.status)
            })
        },
        showFileManagerEntry() {
            if (this.windowWidth <= 500) {
                return this.hasActiveTransferTasks
            }
            return this.hasTransferTasks
        }
    },
    mounted() {
        const logger = new Logger()
        if (this.isChatWindow) {
            const params = new URLSearchParams(window.location.search)
            const chatType = params.get('type') === 'group' ? 'group' : 'user'
            const chatId = Number(params.get('id') ?? 0)
            const chatName = params.get('name') ?? ''
            this.chatWindowKey = `${chatType}:${chatId}`
            const startChat = () => {
                if (loginInfo.status && chatId > 0) {
                    runtimeData.tags.openSideBar = false
                    this.changeChat({
                        id: chatId,
                        type: chatType,
                        name: chatName,
                        avatar: params.get('avatar') ?? '',
                    } as BaseChatInfoElem)
                    this.tags.showChat = true
                    const chat = {
                        id: chatId,
                        type: chatType,
                        name: chatName,
                        avatar: params.get('avatar') ?? '',
                    } as BaseChatInfoElem
                    App.loadHistory(chat)
                }
            }
            this.$watch(() => loginInfo.status, startChat, { immediate: true })
        }
        window.moYu = () => { return '\x75\x6e\x64\x65\x66\x69\x6e\x65\x64' }
        window.addEventListener('resize', this.handleWindowResize)
        this.panelVisibleUnwatch = this.$watch(() => panelVisible.value, (val: boolean) => {
            this.tags.showFileManager = val
        }, { immediate: true })
        this.fileManagerEntryUnwatch = this.$watch(() => this.showFileManagerEntry, (val: boolean) => {
            if (!val && this.tags.showFileManager) {
                this.toggleFileManager(false)
            }
        }, { immediate: true })
        // 页面加载完成后
        
        // 禁止所有原生滚动行为（防止缩放模式下的焦点偏移）
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
                
                // 过滤掉不可见或禁用的元素
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
                    
                    // 使用 preventScroll 确保聚焦时不触发页面滚动
                    focusableElements[nextIndex].focus({ preventScroll: true })

                    // 补丁：强制重置可能由于焦点行为产生的位移
                    // 即使有 preventScroll，某些浏览器在特定情况下仍可能产生 1px 级别的偏移
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

        // Ctrl+↑/↓ 切换聊天框（非移动端；macOS 用 Cmd+↑/↓）
        window.addEventListener('keydown', (e: KeyboardEvent) => {
            if (backend.isMobile()) return
            const isMac = backend.platform === 'darwin' ||
                (backend.platform === 'web' && /Mac OS X/.test(navigator.userAgent))
            const modifierPressed = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
            if (!modifierPressed) return
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
            const list = runtimeData.onMsgList
            if (!list || list.length === 0) return
            const currentId = runtimeData.chatInfo?.show?.id ?? 0
            const currentIndex = list.findIndex((item: any) =>
                (item.user_id && item.user_id === currentId) ||
                (item.group_id && item.group_id === currentId)
            )
            let nextIndex: number
            if (currentIndex === -1) {
                nextIndex = e.key === 'ArrowUp' ? list.length - 1 : 0
            } else {
                nextIndex = currentIndex + (e.key === 'ArrowUp' ? -1 : 1)
                if (nextIndex < 0 || nextIndex >= list.length) return
            }
            const item = list[nextIndex] as any
            const id = item.user_id ?? item.group_id
            const info = {
                type: item.user_id ? 'user' : 'group',
                id: id,
                name: item.remark || item.nickname || item.group_name || String(id),
                avatar: item.user_id? `https://q1.qlogo.cn/g?b=qq&s=0&nk=${id}`: `https://p.qlogo.cn/gh/${id}/${id}/0`,
            } as any
            e.preventDefault()
            this.changeChat(info)
            App.loadHistory(info)
        })

        // 焦点补丁：防止任何方式触发的焦点导致容器偏移
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

        // 全局处理右键菜单遮罩层的右键事件，使其能够穿透并在新位置触发右键菜单
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
                        clientX: e.clientX,
                        clientY: e.clientY,
                        button: 2
                    })
                    // 稍微延迟一下，让上一个右键菜单的关闭动画和 Vue 的 DOM 更新完成
                    // 这样在这个新位置弹出的菜单才能重新播放从上到下展开的动画
                    setTimeout(() => {
                        under.dispatchEvent(newEvent)
                    }, 100)
                }
            }
        }, true)

        window.onload = async () => {
            await backend.init() // Desktop：初始化客户端功能

            if(import.meta.env.DEV) {
                // eslint-disable-next-line
                console.log('[ SSystem Bootloader Complete took ' + (new Date().getTime() - uptime) + 'ms, welcome to sar-dos on stapxs-qq-lite.su ]')
            } else {
                // eslint-disable-next-line
                console.log('[ SSystem Bootloader Complete took ' + (new Date().getTime() - uptime) + 'ms, welcome to ssqq on stapxs-qq-lite.user ]')
            }
            // 初始化波浪动画
            runtimeData.tags.loginWaveTimer = this.waveAnimation(
                document.getElementById('login-wave'),
            )
            // AMAP：初始化高德地图
            window._AMapSecurityConfig = import.meta.env.VITE_APP_AMAP_SECRET
            // =============================================================
            // 初始化功能
            App.createMenu() // Electron：创建菜单
            App.createIpc() // Electron：创建 IPC 通信
            // 加载开发者相关功能
            if (this.dev) {
                document.title = 'Stapxs QQ Lite (Dev)'
                // 布局检查工具
                Spacing.start()
                // FPS 检查
                this.rafLoop()
            }
            // 加载设置项
            runtimeData.sysConfig = await Option.load()
            if(this.dev) {
                logger.debug('stapxs-qq-lite.su:$/mnt/boot/dawnHunt/bin/core --pour /mnt/app/bin/main', true)
                logger.system('[ dawnHuntCore Version: 1.0 Beta, dawnHuntDB: 2025-04-24 ]')
            } else {
                logger.debug('stapxs-qq-lite.user:$/mnt/app/bin/main', true)
            }
            logger.add(LogType.DEBUG, '系统配置', runtimeData.sysConfig)
            // PS：重新再应用部分需要加载完成后才能应用的设置
            Option.run('opt_dark', Option.get('opt_dark'))
            Option.run('opt_auto_dark', Option.get('opt_auto_dark'))
            Option.run('theme_color', Option.get('theme_color'))
            // 流体玻璃样式附加设置
            if (Option.get('glass_effect')) {
                const app = document.getElementById('app')
                const body = document.body
                if(app && body) {
                    body.style.setProperty('background', 'rgba(var(--color-bg-rgb), 0.5)', 'important')
                    app.style.borderRadius = '25px'
                }
            }
            if (['linux', 'win32', 'darwin'].includes(backend.platform ?? '')) {
                const app = document.getElementById('base-app')
                if (app) app.classList.add('withBar')
            }
            // 基础初始化完成
            logger.system('欢迎回来，开发者。Stapxs QQ Lite 正处于 ' + (this.dev ? 'development' : 'production') + ' 模式。正在为您加载更多功能。')
            // 加载移动平台特性
            App.loadMobile()
            // 加载额外样式
            App.loadAppendStyle()
            document.body.style.setProperty('--safe-area-bottom',
                (Option.get('fs_adaptation') > 0 ? Option.get('fs_adaptation') : 0) + 'px')
            document.body.style.setProperty('--safe-area-top', '0')
            document.body.style.setProperty('--safe-area-left', '0')
            document.body.style.setProperty('--safe-area-right', '0')
            // Capacitor：移动端初始化安全区域
            if (backend.isMobile()) {
                // 我把 viewer 挂在 body 上，所以css也得改到 body 上
                const safeArea = await backend.call('SafeArea', 'getSafeArea', true)
                if (safeArea) {
                    logger.add(LogType.DEBUG, '安全区域：', safeArea)
                    document.body.style.setProperty('--safe-area-top', safeArea.top + 'px')
                    document.body.style.setProperty('--safe-area-bottom', safeArea.bottom + 'px')
                    document.body.style.setProperty('--safe-area-left', safeArea.left + 'px')
                    document.body.style.setProperty('--safe-area-right', safeArea.right + 'px')
                    // 图片查看器安全区域
                    document.body.style.setProperty('--safe-area--viewer-top', safeArea.top + 'px')
                }
            }
            // Capacitor（Android）：注册全局 backButton 处理
            // Chat.vue 打开时会注册自己的 listener 并接管，此处只处理 Chat 未打开的情况
            if (backend.type === 'capacitor' && backend.platform === 'android') {
                (window as any).Capacitor.Plugins.App.addListener('backButton', () => {
                    // 如果 ChatPan 已打开，由 Chat.vue 的 listener 接管，此处跳过
                    if (runtimeData.chatInfo.show.id !== 0) return
                    // 弹窗：关闭弹窗
                    if (runtimeData.popBoxList.length > 0) {
                        runtimeData.popBoxList.shift()
                        return
                    }
                    // 群收纳盒展开时：关闭群收纳盒
                    if (runtimeData.tags.showGroupAssist) {
                        runtimeData.tags.showGroupAssist = false
                        return
                    }
                    // 主界面：弹出确认框退出 APP
                    const popInfo = {
                        title: this.$t('提醒'),
                        html: `<span>${this.$t('离开 Stapxs QQ Lite？')}</span>`,
                        button: [
                            {
                                text: this.$t('取消'),
                                fun: () => { runtimeData.popBoxList.shift() },
                            },
                            {
                                text: this.$t('离开'),
                                master: true,
                                fun: () => {
                                    runtimeData.popBoxList.shift()
                                    ;(window as any).Capacitor.Plugins.App.exitApp()
                                },
                            },
                        ],
                    }
                    runtimeData.popBoxList.push(popInfo)
                })
            }
            // 加载密码保存和自动连接
            loginInfo.address = runtimeData.sysConfig.address
            if (
                runtimeData.sysConfig.save_password !== undefined &&
                runtimeData.sysConfig.save_password !== true
            ) {
                loginInfo.token = runtimeData.sysConfig.save_password
                this.tags.savePassword = true
            }
            if (runtimeData.sysConfig.auto_connect == true) {
                this.connect()
            }
            if(import.meta.env.VITE_NAPCAT) {
                logger.info('Stapxs QQ Lite 处于 Napcat 模式 ……')
                const token = localStorage.getItem('token')
                if(token) {
                    // api/Debug/create 获取连接配置信息
                    fetch('/api/Debug/create', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + token
                        }
                    }).then(async (response) => {
                        if(response.ok) {
                            const data = await response.json()
                            // 获取当前页面的根 URL
                            const rootUrl = window.location.origin
                            loginInfo.address = rootUrl.replace('http', 'ws') + '/api/Debug/ws'
                            loginInfo.token = data.data.token
                            this.connect()
                        } else {
                            logger.error(null, 'Napcat 快速连接失败，状态码：' + response.status)
                        }
                    }).catch((error) => {
                        logger.error(null, 'Napcat 快速连接请求失败：' + error)
                    })
                    this.updateNapcatColor(token)
                    window.addEventListener('storage', (event) => {
                        if(event.key === 'theme') {
                            this.updateNapcatColor(token)
                        }
                    })
                }
            }
            // 服务发现
            backend.call('Onebot', 'sys:findService', false)
            backend.call('OneBot', 'sys:frontLoaded', false)
            // =============================================================
            // 初始化完成
            // 创建 popstate
            if(backend.platform == 'web' && (getDeviceType() === 'Android' || getDeviceType() === 'iOS')) {
                window.addEventListener('popstate', () => {
                    // 弹窗：关闭弹窗
                    if (runtimeData.popBoxList.length > 0) {
                        runtimeData.popBoxList.shift()
                        history.pushState('ssqqweb', '', location.href)
                        return
                    }
                    if(!loginInfo.status || runtimeData.tags.openSideBar) {
                        // 离开提醒
                        const popInfo = {
                            title: this.$t('提醒'),
                            html: `<span>${this.$t('离开 Stapxs QQ Lite？')}</span>`,
                            button: [
                                {
                                    text: this.$t('取消'),
                                    fun: () => {
                                        runtimeData.popBoxList.shift()
                                        history.pushState('ssqqweb', '', location.href)
                                    },
                                },
                                {
                                    text: this.$t('离开'),
                                    master: true,
                                    fun: () => {
                                        runtimeData.popBoxList.shift()
                                        history.back()
                                    },
                                },
                            ],
                        }
                        runtimeData.popBoxList.push(popInfo)
                    } else {
                        // 内部的页面返回处理，此处使用 watch backTimes 监听
                        runtimeData.watch.backTimes += 1
                        history.pushState('ssqqweb', '', location.href)
                    }
                });
                if (history.state != 'ssqqweb') {
                    history.pushState('ssqqweb', '', location.href)
                }
            }
            // UM：加载 Umami 统计功能
            if (!Option.get('close_ga') && !this.dev) {
                const config = {
                    baseUrl: import.meta.env.VITE_APP_MU_ADDRESS,
                    websiteId: import.meta.env.VITE_APP_MU_ID
                } as any
                // 给页面添加一个来源域名方便在非 web 端
                if(!backend.isWeb()) {
                    config.hostName = backend.type + '.stapxs.cn'
                }
                Umami.initialize(config)
                // 上报一些应用基础信息
                App.sendIdentifyData({
                    'app_version': import.meta.env.VITE_APP_CLIENT_TAG + ',' + packageInfo.version,
                    'os_version': backend.release,
                    'os_arch': backend.arch,
                })
            } else if (this.dev) {
                logger.system('开发者，由于 Stapxs QQ Lite 运行在调试模式下，分析组件并未初始化 …… 系统将无法捕获开发者阁下的访问状态，请悉知。')
            }
            //App.checkUpdate() // 检查更新
            //App.checkOpenTimes() // 检查打开次数
            App.checkNotice() // 检查公告
            // 加载愚人节附加
            if (new Date().getMonth() == 3 && new Date().getDate() == 1) {
                document.getElementById('connect_btn')?.classList.add('afd')
            }
            // 其他状态监听
            this.$watch(() => runtimeData.baseOnMsgList, () => {
                // macOS：刷新 Touch Bar 列表
                if (backend.isDesktop()) {
                    const list = [] as
                        { id: number, name: string, image?: string }[]
                    runtimeData.baseOnMsgList.forEach((item) => {
                        list.push({
                            id: item.user_id ? item.user_id : item.group_id,
                            name: item.group_name ? item.group_name : item.remark === item.nickname ? item.nickname : item.remark + '（' + item.nickname + '）',
                            image: item.user_id ? 'https://q1.qlogo.cn/g?b=qq&s=0&nk=' + item.user_id : 'https://p.qlogo.cn/gh/' + item.group_id + '/' + item.group_id + '/0'
                        })
                    })
                    backend.call(undefined, 'sys:flushOnMessage', false, list)
                }

                // 刷新列表
                updateBaseOnMsgList()
            }, { deep: true })
            // 更新标题
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
                const titleList = [
                    '也试试 Icalingua Plus Plus 吧！',
                    '点击阅读《社交功能限制提醒》',
                    '登录失败，Code 45',
                    '你好世界！',
                    '这只是个普通的彩蛋！'
                ]
                const title = titleList[Math.floor(Math.random() * titleList.length)]
                if(backend.platform == 'web') {
                    document.title = title + '- Stapxs QQ Lite'
                } else {
                    document.title = title
                    backend.call(undefined, 'win:setTitle', false, title)
                }
            }
        }
        // 页面关闭前
        window.onbeforeunload = () => {
            logger.system('开发者阁下—— 唔，阁下离开的太匆忙了！让我来帮开发者阁下收拾下东西吧。')
            new Notify().clear()
            if(import.meta.env.DEV) {
                Connector.close()
            }
        }
        },
    beforeUnmount() {
        window.removeEventListener('resize', this.handleWindowResize)
        this.panelVisibleUnwatch?.()
        this.fileManagerEntryUnwatch?.()
    },
    methods: {
        updateNapcatColor(token: string) {
            const logger = new Logger()
            // api/base/Theme 获取主题配置信息
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
                    if(media.matches) {
                        const colorHsl = data.data.dark['--heroui-primary']
                        document.documentElement.style.setProperty('--color-main', `hsl(${colorHsl} / .3)`)
                        document.documentElement.style.setProperty('--color-main-0', `hsl(${colorHsl} / .3)`)
                    } else {
                        const colorHsl = data.data.light['--heroui-primary']
                        document.documentElement.style.setProperty('--color-main', `hsl(${colorHsl} / .1)`)
                        document.documentElement.style.setProperty('--color-main-0', `hsl(${colorHsl} / .1)`)
                    }
                } else {
                    logger.error(null, 'Napcat 主题获取失败，状态码：' + response.status)
                }
            }).catch((error) => {
                logger.error(null, 'Napcat 主题请求失败：' + error)
            })
        },

        /**
         * electron 窗口操作
         */
        controllWin(name: string) {
            backend.call(undefined, 'win:' + name, false)
        },

        /**
         * 处理 appbar 鼠标按下事件（Linux 平台窗口拖拽）
         */
        handleAppbarMouseDown(event: MouseEvent) {
            // 只在 Linux + Tauri 平台生效
            if (backend.platform === 'linux' && backend.type === 'tauri') {
                // 检查是否点击了按钮或控制器
                const target = event.target as HTMLElement
                if (target.closest('.bar-button') || target.closest('.controller')) {
                    return
                }
                // 调用 Tauri 拖拽命令
                backend.call(undefined, 'win:startDrag', false)
            }
        },

        /**
         * 发起连接
         */
        connect() {
            if(this.tags.quickLoginSelect != '') {
                // PS：快速连接的地址只会是局域网，所以默认 ws 协议
                loginInfo.address = 'ws://' + this.tags.quickLoginSelect
            } else {
                // 如果是 http(s) 地址且末尾没有 /，自动加上
                const httpRegex = /^https?:\/\/[^/]+:\d+$/;
                if (httpRegex.test(loginInfo.address)) {
                    loginInfo.address += '/';
                }
            }
            // https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/issues/312
            Connector.create(loginInfo.address, loginInfo.token)
        },
        selectQuickLogin(address: string) {
            this.tags.quickLoginSelect = address
        },
        cancelQUickLogin() {
            loginInfo.quickLogin = null
        },

        /**
         * 切换主标签卡判定
         * @param name 页面名称
         * @param view 虚拟路径名称
         * @param show 是否显示聊天面板
         */
        changeTab(_: string, view: string, show: boolean) {
            // UM：发送页面路由分析
            if (
                !Option.get('close_ga') &&
                !this.dev
            ) {
                Umami.trackPageView('/' + view)
            }
            this.tags.showChat = show
            this.tags.page = view
            // 附加操作
            const optTab = document.getElementsByClassName('opt-main-tab')[0] as HTMLDivElement
            switch (view) {
                case 'Options': {
                    Connector.send('get_version_info', {}, 'getVersionInfo')
                    if (optTab) {
                        optTab.style.opacity = '1'
                    }
                    break
                }
                case 'Home': {
                    if (optTab) {
                        optTab.style.opacity = '0'
                    }
                    break
                }
            }
        },
        barMainClick() {
            if (loginInfo.status) {
                this.changeTab('信息', 'Messages', true)
            } else {
                this.changeTab('主页', 'Home', false)
            }
        },

        toggleFileManager(open: boolean | undefined) {
            if (open != undefined) {
                this.tags.showFileManager = open
            } else {
                this.tags.showFileManager = !this.tags.showFileManager
            }
            if (this.tags.showFileManager) {
                panelVisible.value = true
            } else {
                closePanel()
            }
        },

        handleWindowResize() {
            this.windowWidth = window.innerWidth
        },

        /**
         * 水波动画启动器
         * @param wave HTML 对象
         * @returns 动画循环器对象
         */
        waveAnimation(wave: HTMLElement | null) {
            if (wave) {
                const waves = wave.children[1].children
                const min = 20
                const max = 195
                const add = 1
                const timer = setInterval(() => {
                    // 遍历波浪体
                    for (let i = 0; i < waves.length; i++) {
                        const now = waves[i].getAttribute('x')
                        if (Number(now) + add > max) {
                            waves[i].setAttribute('x', min.toString())
                        } else {
                            waves[i].setAttribute(
                                'x',
                                (Number(now) + add).toString(),
                            )
                        }
                    }
                }, 50)
                return timer
            }
            return -1
        },

        /**
         * 刷新页面 fps 数据
         * @param timestamp 时间戳
         */
        rafLoop() {
            this.fps.ticks += 1
            //每30帧统计一次帧率
            if (this.fps.ticks >= 30) {
                const now = Date.now()
                const diff = now - this.fps.last
                const fps = Math.round(1000 / (diff / this.fps.ticks))
                this.fps.last = now
                this.fps.ticks = 0
                this.fps.value = fps
            }
            requestAnimationFrame(this.rafLoop)
        },

        /**
         * 切换聊天对象状态
         * @param data 切换信息
         */
        changeChat(data: BaseChatInfoElem) {
            const detachedWindow = !this.isChatWindow
                ? this.chatWindows[`${data.type}:${data.id}`]
                : undefined
            if (detachedWindow) {
                this.tags.showChat = false
                void detachedWindow.setFocus().catch((e: unknown) => {
                    void backend.call(undefined, 'sys:debugLog', false, {
                        tag: '独立窗口',
                        message: `点击已拆出聊天时聚焦失败 ${JSON.stringify({
                            chatKey: `${data.type}:${data.id}`,
                            error: e instanceof Error ? e.message : String(e),
                        })}`,
                    })
                })
            }
            // 设置聊天信息
            runtimeData.chatInfo = {
                show: data,
                info: {
                    group_info: {},
                    user_info: {},
                    me_info: {},
                    group_members: [],
                    group_files: {},
                    group_sub_files: {},
                    jin_info: {
                        list: [] as { [key: string]: any }[],
                        pages: 0,
                    },
                },
            }
            runtimeData.mergeMessageList = undefined // 清空合并转发缓存
            runtimeData.mergeMsgStack.length = 0 // 清空合并转发面板堆栈
            // 切换聊天时，清空属于旧聊天的待上传文件
            if (runtimeData.fileUploadChatId !== data.id) {
                runtimeData.fileUploadPending = null
            }
            runtimeData.tags.canLoadHistory = true // 重置终止加载标志
            runtimeData.tags.loadHistoryFail = false // 重置加载失败标志
            if (!this.isChatWindow) {
                this.tags.showChat = !detachedWindow
            }
            if (data.type == 'group') {
                // 获取自己在群内的资料
                Connector.send(
                    'get_group_member_info',
                    {
                        group_id: data.id,
                        user_id: runtimeData.loginInfo.uin,
                    },
                    'getUserInfoInGroup',
                )
                // 获取群成员列表
                // PS：部分功能不返回用户名需要进来查找所以提前获取
                Connector.send(
                    'get_group_member_list',
                    { group_id: data.id, no_cache: true },
                    'getGroupMemberList',
                )
            }

            // 清理通知
            backend.call(undefined, 'sys:closeAllNotice', false, String(data.id))
        },

        async openChatWindow(data: BaseChatInfoElem) {
            const key = `${data.type}:${data.id}`
            const hidingCurrentChat = runtimeData.chatInfo.show.type === data.type && runtimeData.chatInfo.show.id === data.id
            const previousShowChat = this.tags.showChat
            const debugWindow = (message: string, extra: Record<string, any> = {}) => {
                if (!import.meta.env.DEV || backend.type !== 'tauri') return
                void backend.call(undefined, 'sys:debugLog', false, {
                    tag: '独立窗口',
                    message: `${message} ${JSON.stringify({ chatKey: key, ...extra })}`,
                })
            }
            debugWindow('开始打开')
            if (hidingCurrentChat) this.tags.showChat = false
            const existing = this.chatWindows[key]
            if (existing) {
                try {
                    await existing.setFocus()
                    debugWindow('已有窗口已聚焦')
                    this.tags.showChat = false
                } catch (e) {
                    debugWindow('已有窗口聚焦失败', { error: e instanceof Error ? e.message : String(e) })
                }
                return
            }
            const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
            const params = new URLSearchParams({
                chatWindow: '1',
                type: data.type,
                id: String(data.id),
                name: data.name ?? '',
                avatar: data.avatar ?? '',
            })
            const label = `chat-${data.type}-${data.id}`
            const child = new WebviewWindow(label, {
                url: `/?${params.toString()}`,
                title: data.name ?? '聊天',
                width: 850,
                height: 650,
                resizable: true,
            })
            this.chatWindows[key] = child
            const created = await new Promise<boolean>((resolve) => {
                void child.once('tauri://created', () => {
                    debugWindow('窗口创建成功', { label })
                    resolve(true)
                })
                void child.once('tauri://error', (event) => {
                    debugWindow('窗口创建失败', { label, error: event.payload })
                    resolve(false)
                })
            })
            if (!created) {
                delete this.chatWindows[key]
                if (hidingCurrentChat) this.tags.showChat = previousShowChat
                return
            }
            // Hide the main panel only when it is showing this detached chat.
            if (runtimeData.chatInfo.show.type === data.type && runtimeData.chatInfo.show.id === data.id) {
                this.tags.showChat = false
            }
            await child.once('tauri://destroyed', () => {
                delete this.chatWindows[key]
                debugWindow('窗口已关闭', { label })
                this.restoringMainChat = true
                this.changeChat(data)
                this.tags.showChat = true
                this.restoringMainChat = false
            })
            try {
                await child.setFocus()
                debugWindow('窗口已聚焦', { label })
            } catch (e) {
                debugWindow('窗口聚焦失败', { label, error: e instanceof Error ? e.message : String(e) })
            }
        },

        /**
         * 移除当前的全局弹窗
         */
        removePopBox() {
            runtimeData.popBoxList[0]?.onClose?.()
            runtimeData.popBoxList.shift()
        },

        /**
         * 保存密码
         * @param event 事件
         */
        savePassword(event: Event) {
            const sender = event.target as HTMLInputElement
            const value = sender.checked
            if (value) {
                Option.save('save_password', true)
                // 创建提示弹窗
                const popInfo = {
                    title: this.$t('提醒'),
                    html: `<span>${this.$t('连接密钥将以明文存储在浏览器 Cookie 中，请确保设备安全以防止密钥泄漏。')}</span>`,
                    button: [
                        {
                            text: app.config.globalProperties.$t('知道了'),
                            master: true,
                            fun: () => {
                                runtimeData.popBoxList.shift()
                            },
                        },
                    ],
                }
                runtimeData.popBoxList.push(popInfo)
            } else {
                Option.remove('save_password')
            }
        },

        /**
         * 保存自动连接
         * @param event 事件
         */
        saveAutoConnect(event: Event) {
            Option.runASWEvent(event)
            // 如果自动保存密码没开，那也需要开
            if (!runtimeData.sysConfig.save_password) {
                this.savePassword(event)
            }
        },

        /**
         * 快速关闭弹窗（点击空白处关闭）
         * @param allow 是否允许快速关闭
         */
        popQuickClose(allow: boolean | undefined) {
            if (allow != false) {
                runtimeData.popBoxList[0]?.onClose?.()
                runtimeData.popBoxList.shift()
            } else {
                const animeBody = document.getElementById('pop-box')
                const timeLine = anime.timeline({ targets: animeBody })
                // 使用 animejs 实现一个沿中心左右摇晃的动画，摇晃三次
                timeLine.add({
                    rotate: [
                        { value: -1, duration: 75, easing: 'easeInOutSine' },
                        { value: 1, duration: 150, easing: 'easeInOutSine' },
                        { value: 0, duration: 75, easing: 'easeInOutSine' },
                    ],
                    duration: 200,
                    easing: 'easeInOutSine',
                    loop: 3,
                })
            }
        },

        afd(event: MouseEvent) {
            // 只在愚人节时生效
            if (new Date().getMonth() == 3 && new Date().getDate() == 1) {
                const sender = event.target as HTMLButtonElement
                // 获取文档整体宽高
                const docWidth = document.documentElement.clientWidth
                const docHeight = document.documentElement.clientHeight
                // 获取按钮宽高
                const senderWidth = sender.offsetWidth
                const senderHeight = sender.offsetHeight
                // 获取鼠标位置
                const mouseX = event.clientX
                const mouseY = event.clientY
                // 在宽高里随机抽一个位置，不能超出文档，不能让按钮在鼠标下
                let x, y
                do {
                    x = Math.floor(Math.random() * docWidth)
                    y = Math.floor(Math.random() * docHeight)
                } while (
                    x + senderWidth > docWidth ||
                    y + senderHeight > docHeight ||
                    (x < mouseX &&
                        x + senderWidth > mouseX &&
                        y < mouseY &&
                        y + senderHeight > mouseY)
                )
                // 设置按钮位置
                sender.style.left = x + 'px'
                sender.style.top = y + 'px'
            }
        },
    },
})
</script>

<style scoped>
/* 应用通知动画 */
.appmsg-move,
.appmsg-enter-active,
.appmsg-leave-active {
    transition: all 0.2s;
}

.appmsg-leave-active {
    position: absolute;
}

.appmsg-enter-from,
.appmsg-leave-to {
    transform: translateX(-20px);
    opacity: 0;
}

/* 标题栏变更动画 */
.appbar-enter-active,
.appbar-leave-active {
    transition: all 0.2s;
}

.appbar-enter-from,
.appbar-leave-to {
    transform: translateY(-60px);
}

/* 弹窗动画 */
.modal-enter-active {
    transition: opacity 0.2s ease-out;
}

.modal-leave-active {
    transition: opacity 0.2s ease-in;
}

.modal-leave-to {
    opacity: 0;
}

.modal-enter-active .pop-box-body {
    animation: panelSlideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.modal-leave-active .pop-box-body {
    animation: panelSlideDown 0.2s cubic-bezier(0.4, 0, 0.6, 1);
}

.global-music-player {
    position: fixed;
    left: 90px;
    bottom: 20px;
    z-index: 33;
    width: 350px;
    max-height: min(72vh, 560px);
    overflow: auto;
    box-shadow: 0 0 10px var(--color-shader);
}

.music-player-float-enter-active,
.music-player-float-leave-active {
    transition: opacity 0.2s ease, transform 0.2s ease;
}

.music-player-float-enter-from,
.music-player-float-leave-to {
    opacity: 0;
    transform: translateY(12px);
}

@media (max-width: 700px) {
    .global-music-player {
        left: 100px;
        bottom: 60px;
        width: calc(100vw - 200px);
        max-height: min(66vh, 460px);
    }
}

@media (max-width: 500px) {
    .global-music-player {
        left: 20px !important;
        bottom: 60px;
        width: calc(100vw - 70px);
        max-height: min(66vh, 460px);
    }
}

@keyframes panelSlideUp {
    from {
        transform: translate(-50%, -20%) scale(0.95);
        opacity: 0;
    }

    to {
        transform: translate(-50%, -50%) scale(1);
        opacity: 1;
    }
}

@keyframes panelSlideDown {
    from {
        transform: translate(-50%, -50%) scale(1);
        opacity: 1;
    }

    to {
        transform: translate(-50%, -5%) scale(0.98);
        opacity: 0;
    }
}
</style>
