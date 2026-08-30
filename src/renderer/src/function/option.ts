/*
 * @FileDescription: 设置功能模块
 * @Author: Stapxs
 * @Date:
 *      2022/09/27
 *      2022/12/07
 * @Version:
 *      1.0 - 初始版本
 *      1.5 - 重构为 ts 版本，代码格式优化
 * @Description: 设置功能相关模块
 */

import app from '@renderer/main'
import languageConfig from '@renderer/assets/l10n/_l10nconfig.json'

import { i18n } from '@renderer/main'
import { markRaw, defineAsyncComponent } from 'vue'
import { Logger, LogType, PopInfo, PopType } from './base'
import { runtimeData } from './msg'
import {
    loadWinColor,
    sendStatEvent,
    updateWinColor,
} from '@renderer/function/utils/appUtil'
import {
    getPortableFileLang,
    getTrueLang,
    rgbToHsl,
    hslToRgb,
} from '@renderer/function/utils/systemUtil'
import { updateBaseOnMsgList } from './utils/msgUtil'
import { backend } from '@renderer/runtime/backend'
import { refreshFavicon } from './favicon'

let cacheConfigs: { [key: string]: any }

// 设置项的初始值，防止下拉菜单选项为空或者首次使用初始错误
export const optDefault: { [key: string]: any } = {
    // System
    address: '',
    top_info: {},
    save_password: '',
    notice_group: {},
    group_box_override: {},
    auto_connect: false,
    official_face_folder: null,
    official_face_folder_custom: false,
    official_face_downloaded: false,
    local_emoji_folder: null,
    global_proxy: '',
    url_parse_auto: true,
    custom_title_text: 'Stapxs QQ Lite v{version} - Hello, {nickname}',
    opt_title_text_custom: false,
    opt_dark: false,
    opt_auto_dark: true,
    opt_deeper_dark: false,
    // View
    theme_color: 0,
    opt_auto_win_color: false,
    chat_background: '',
    chat_background_blur: 0,
    custom_scale: 1.0,
    font_scale: 1.0,
    chatview_name: '',
    opt_fast_animation: false,
    chat_more_blur: false,
    glass_effect: false,
    initial_scale: 0.85,
    fs_adaptation: 0,
    opt_always_top: false,
    opt_revolve: false,
    use_favicon_notice: true,
    use_super_face: true,
    opt_ind_message: false,
    opt_privacy_mode: false,
    opt_privacy_show_content: false,
    opt_privacy_hide_time: false,
    // Function
    close_notice: false,
    bubble_sort_user: true,
    close_respond: false,
    msg_taill: '',
    quick_send: 'default',
    group_notice_type: 'none',
    send_face: false,
    use_breakline: true,
    send_key: 'none',
    opt_send_history: false,
    close_browser: false,
    close_ga: false,
    open_ga_bot: true,
    record_recent_emoji: '100times' as 'none' | 'order' | '100times' | '500times',
    enable_local_history: false,
    local_history_path: '',
    mixed_load_messages: false,
    disable_local_history_image_cache: false,
    // Dev
    msg_type: 2,
    log_level: 'err',
    debug_msg: false,
    custom_css: '',
    // Glagame
    openai_api: '',
    openai_token: '',
    openai_model: '',
    glagame_prompt: `你是 glagame 游戏内的对话助手。你将根据历史的对话内容生成 3 条可供玩家选择回复的选项。

- 输出格式：只输出三条回复文本
- 玩家默认是温和、体贴、日常向、有点小俏皮。
- **不要**为玩家本人的消息生成回复，玩家本人的消息仅供上下文参考。
- 若对话之间时间相隔较久，可自然应对（如"刚看到消息"）。
- 避免引入与对话无关的新背景。

# 示例
示例：
【1763695603000】三硝基猫猫酚：我们学校有实力的课倒是不少
【1763695610000】三硝基猫猫酚：可惜校区不好
【1763695614000】三硝基猫猫酚：好多选不上
【1763695616000】林小槐：我记得我大学选了个商务学院的 AI 选修课
【1763695620000】林小槐：给我上无聊死了

正确输出示例：
选课系统真是让人头疼    ← 继续他人话题
要不下次咱们一起选课吧？    ← 自然衔接

错误示例：
我觉得 AI 课还挺有意思的    ← 错误，不能改变玩家
无聊可以找我陪你玩游戏啊    ← 错误，不能回复自己`,
    glagame_max_messages: 50,
}

// =============== 设置项事件 ===============

const configFunction: { [key: string]: (value: any) => void } = {
    language: setLanguage,
    opt_dark: setDarkMode,
    opt_auto_dark: setAutoDark,
    opt_deeper_dark: setDeeperDark,
    theme_color: changeTheme,
    chatview_name: changeChatView,
    initial_scale: changeInitialScale,
    msg_type: setMsgType,
    opt_auto_win_color: updateWinColorOpt,
    opt_revolve: viewRevolve,
    opt_always_top: viewAlwaysTop,
    opt_fast_animation: updateFarstAnimation,
    bubble_sort_user: clearGroupAssist,
    use_favicon_notice: setFaviconNotice,
    custom_css: injectCustomCss,
    custom_scale: setCustomScale,
    font_scale: setFontScale,
    opt_ind_message: updateChatPan,
    opt_privacy_mode: setPrivacyMode,
    opt_privacy_show_content: setPrivacyShowContent,
    opt_privacy_hide_time: setPrivacyHideTime,
}

function setPrivacyMode(value: boolean) {
    if (value) {
        document.body.classList.add('privacy-mode')
    } else {
        document.body.classList.remove('privacy-mode')
    }
}

function setPrivacyShowContent(value: boolean) {
    if (value) {
        document.body.classList.add('privacy-show-content')
    } else {
        document.body.classList.remove('privacy-show-content')
    }
}

function setPrivacyHideTime(value: boolean) {
    if (value) {
        document.body.classList.add('privacy-hide-time')
    } else {
        document.body.classList.remove('privacy-hide-time')
    }
}

function updateChatPan() {
    runtimeData.chatInfo.show.id = 0
    runtimeData.tags.openSideBar = true
}


function setFaviconNotice(_: boolean) {
    refreshFavicon()
}

function injectCustomCss(value: string) {
    console.log('DEBUG: injectCustomCss called with value:', value);
    
    // 使用延时注入，确保在应用样式初始化完成后再应用自定义样式，避免被覆盖
    setTimeout(() => {
        // 移除旧的自定义 CSS
        const oldStyle = document.getElementById('custom-css-inject')
        if (oldStyle) {
            document.head.removeChild(oldStyle)
        }

        // 如果有新的 CSS 内容，注入它
        if (value && value.trim() !== '') {
            const style = document.createElement('style')
            style.id = 'custom-css-inject'
            style.textContent = value
            document.head.appendChild(style)
            new Logger().add(LogType.UI, '已注入自定义 CSS (延时)')
        }
    }, 500)
}

function setCustomScale(value: number) {
    console.log('DEBUG: setCustomScale called with value:', value);
    document.documentElement.style.setProperty('--scale-custom', value.toString());
}

function setFontScale(value: number) {
    console.log('DEBUG: setFontScale called with value:', value);
    document.documentElement.style.setProperty('--scale-font', value.toString());
}

function clearGroupAssist() {
    updateBaseOnMsgList()
}

function updateFarstAnimation(value: boolean) {
    if(value) {
        // 创建 <style> 元素
        const style = document.createElement('style')
        style.textContent = `* {
            transition: .1s !important;
        }`
        style.id = 'disable-transitions'
        document.head.appendChild(style)
    } else {
        const style = document.getElementById('disable-transitions')
        if(style) {
            document.head.removeChild(style)
        }
    }
}

function viewAlwaysTop(value: boolean) {
    backend.call(undefined, 'win:alwaysTop', false, value)
}

function viewRevolve(value: boolean) {
    const baseApp = document.getElementById('base-app')
    if (baseApp && value) {
        if (baseApp.classList.contains('no-touch')) {
            baseApp.classList.remove('no-touch')
            // 把这个选项设置为 false
            save('opt_revolve', false)
        } else {
            baseApp.classList.add('no-touch')
            sendStatEvent('click_statistics', { name: 'touch_randomly' })
        }
    }
}

function updateWinColorOpt(value: boolean) {
    if (value == true) {
        backend.addListener(undefined, 'sys:WinColorChanged', (_, params) => {
            updateWinColor(params, backend.platform == 'win32' ? 'windows' : 'macos')
        })
        loadWinColor()
    }
}

function setMsgType(value: any) {
    if (value) {
        runtimeData.tags.msgType = Number(value)
    }
}

/**
 * 修改移动端缩放比例
 * @param value 数值（0.5 - 1.5）
 */
function changeInitialScale(value: number) {
    const viewport = document.getElementById('viewport')
    if (viewport && value && value >= 0.5 && value <= 1.5) {
        (viewport as any).content =
            `width=device-width, initial-scale=${value}, maximum-scale=5, user-scalable=0`
    } else {
        (viewport as any).content =
            'width=device-width, initial-scale=0.85, maximum-scale=5, user-scalable=0'
    }
}

/**
 * 加载语言文件并设置为当前的语言
 * @param name 语言文件名（不是实际语言代码）
 */
function setLanguage(name: string) {
    // 加载语言文件
    const lang = getPortableFileLang(name)
    i18n.global.setLocaleMessage(name, lang)
    app.config.globalProperties.$i18n.locale = name
    // 检查是否设置了备选语言
    let get = false
    for (let i = 0; i < languageConfig.length; i++) {
        if (
            languageConfig[i].value == name &&
            (languageConfig[i] as any).fallback
        ) {
            const fbname = (languageConfig[i] as any).fallback
            const fbLang = getPortableFileLang(fbname)
            i18n.global.setLocaleMessage(fbname, fbLang)
            get = true
            app.config.globalProperties.$i18n.fallbackLocale = fbname
            break
        }
    }
    if (!get) {
        app.config.globalProperties.$i18n.fallbackLocale = 'zh-CN'
    }
    // 刷新 html 语言标签
    const htmlBody = document.querySelector('html')
    if (htmlBody !== null) {
        htmlBody.setAttribute('lang', getTrueLang())
    }
}

/**
 * 设置暗黑模式
 * @param value 是否启用暗黑模式
 */
function setDarkMode(value = true) {
    if (value === true) {
        // 如果启用了深黑模式，则使用 deeper-dark
        if (get('opt_deeper_dark')) {
            changeColorMode('deeper-dark')
        } else {
            changeColorMode('dark')
        }
    } else {
        changeColorMode('light')
    }
}

/**
 * 设置自动暗黑模式
 * @param value 是否启用自动暗黑模式
 */
function setAutoDark(value: boolean) {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const opt = document.getElementById('opt_view_dark')
    if (value == true) {
        // 刷新一次颜色模式
        if (media.matches) {
            setDarkMode()
        } else {
            setDarkMode(false)
        }
        // 创建颜色模式变化监听
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', (e) => {
                if (get('opt_auto_dark')) {
                    const prefersDarkMode = e.matches
                    new Logger().add(
                        LogType.UI,
                        '正在自动切换颜色模式为：' + prefersDarkMode,
                    )
                    if (prefersDarkMode) {
                        setDarkMode()
                    } else {
                        setDarkMode(false)
                    }
                    // 刷新主题色
                    runAS('opt_auto_win_color', get('opt_auto_win_color'))
                }
            })
        }
        // 将颜色模式设置项移除
        if (opt) opt.style.display = 'none'
    } else {
        if (opt) opt.style.display = 'flex'
        setDarkMode(Boolean(get('opt_dark')))
    }
}

/**
 * 设置深黑模式
 * @param value 是否启用深黑模式
 */
function setDeeperDark(value: boolean) {
    // 仅当当前处于深色模式时才立即切换
    const isDark = runtimeData.tags.darkMode
    if (isDark) {
        if (value) {
            changeColorMode('deeper-dark')
        } else {
            changeColorMode('dark')
        }
    }
}

/**
 * 修改颜色模式
 * @param mode 颜色模式 ('light' | 'dark' | 'deeper-dark')
 */
function changeColorMode(mode: string) {
    if (!runtimeData.tags.firstLoad) {
        // 启用颜色渐变动画
        document.body.style.transition =
            'background, color, background-color .3s'
    } else {
        runtimeData.tags.firstLoad = false
    }
    // 切换颜色：使用正则匹配，支持 light / dark / deeper-dark 三种模式
    const modePattern = /(light|deeper-dark|dark)/
    const match_list = ['color-.*.css', 'prism-.*.css', 'append-.*.css']
    const css_list = document.getElementsByTagName('link')
    for (let i = 0; i < css_list.length; i++) {
        const name = css_list[i].href
        match_list.forEach((value) => {
            if (name.match(value) != null) {
                // 构建目标文件名：将当前模式替换为目标模式
                const newName = name.replace(modePattern, mode)
                if (newName === name) return // 已经是目标模式，跳过
                // 检查切换的文件是否可以被访问到
                const xhr = new XMLHttpRequest()
                xhr.open('HEAD', newName, false)
                xhr.send()
                if (xhr.status != 200) {
                    // 无法访问到对应的颜色模式文件，放弃切换
                    new PopInfo().add(
                        PopType.ERR,
                        '无法切换颜色模式：访问颜色模式文件失败。',
                    )
                    return
                }
                const newLink = document.createElement('link')
                newLink.setAttribute('rel', 'stylesheet')
                newLink.setAttribute('type', 'text/css')
                newLink.setAttribute('href', newName)
                const head = document.getElementsByTagName('head').item(0)
                if (head !== null) {
                    head.replaceChild(newLink, css_list[i])
                }
            }
        })
    }
    // 如果主题色模式是自定，则刷新系统主题色
    getRaw('theme_color').then((themeColor) => {
        if(themeColor && themeColor > 10) {
            const colorUpdate = ('000000' + Number(themeColor).toString(16)).slice(-6)
            updateWinColor(colorUpdate, 'windows')
        }
    })
    // 刷新页面主题色
    const meta = document.getElementsByName('theme-color')[0]
    if (meta) {
        (meta as HTMLMetaElement).content = getComputedStyle(
            document.documentElement,
        ).getPropertyValue('--color-main')
    }
    // 记录
    const isDark = mode === 'dark' || mode === 'deeper-dark'
    runtimeData.tags.darkMode = isDark
    runtimeData.tags.deeperDarkMode = mode === 'deeper-dark'
    // 深黑模式：应用主题色色调到背景色
    if (mode === 'deeper-dark') {
        // 等待 CSS 加载后再应用色调
        setTimeout(() => applyDeeperDarkTint(), 50)
    } else {
        // 非深黑模式：清除动态色调覆盖
        clearDeeperDarkTint()
    }
    // Capacitor: 状态栏颜色（Android）
    if(backend.isMobile()) {
        // deeper-dark 也使用 DARK 样式
        const statusStyle = isDark ? 'DARK' : 'LIGHT'
        backend.call('StatusBar', 'setStyle', false, { style: statusStyle })
    }
    // Capacitor: VConsole 颜色
    if(backend.function && 'vConsole' in backend.function && backend.function.vConsole) {
        backend.function.vConsole.setOption('theme', isDark ? 'dark' : 'light')
    }
    // 刷新图标
    refreshFavicon()
}

/**
 * 深黑模式：根据当前主题色色调为背景色施加微弱色调
 * 读取 --color-main 的计算值，提取其色相，然后以极低饱和度应用到 bg/card 变量上
 */
function applyDeeperDarkTint() {
    const mainColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-main').trim()
    if (!mainColor) return

    // 解析主题色为 RGB
    let r = 0, g = 0, b = 0
    if (mainColor.startsWith('#')) {
        const hex = mainColor.replace('#', '')
        r = parseInt(hex.substring(0, 2), 16)
        g = parseInt(hex.substring(2, 4), 16)
        b = parseInt(hex.substring(4, 6), 16)
    } else if (mainColor.startsWith('rgb')) {
        const match = mainColor.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
        if (match) {
            r = parseInt(match[1])
            g = parseInt(match[2])
            b = parseInt(match[3])
        }
    } else {
        return
    }

    const hsl = rgbToHsl(r, g, b)
    const hue = hsl[0] // 色相 [0, 1]

    // 定义各层级的基础亮度和饱和度（极微弱的色调）
    const tintSaturation = 0.15 // 低饱和度
    const layers = [
        { prop: '--color-bg',       lightness: 0.05 },
        { prop: '--color-card',     lightness: 0.08 },
        { prop: '--color-card-1',   lightness: 0.10 },
        { prop: '--color-card-2',   lightness: 0.13 },
    ]

    const style = document.documentElement.style
    layers.forEach(({ prop, lightness }) => {
        const rgb = hslToRgb(hue, tintSaturation, lightness)
        style.setProperty(prop, `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`)
        style.setProperty(prop + '-rgb', `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`)
    })
}

/**
 * 清除深黑模式的动态色调覆盖
 */
function clearDeeperDarkTint() {
    const style = document.documentElement.style
    const props = [
        '--color-bg', '--color-card', '--color-card-1', '--color-card-2',
        '--color-bg-rgb', '--color-card-rgb', '--color-card-1-rgb', '--color-card-2-rgb',
    ]
    props.forEach((prop) => style.removeProperty(prop))
}

/**
 * 设置主题色
 * @param id 主题色编号
 */
function changeTheme(id: number) {
    if(id < 10) {
        document.documentElement.style.setProperty(
            '--color-main',
            'var(--color-main-' + id + ')',
        )
        const meta = document.getElementsByName('theme-color')[0]
        if (meta) {
            (meta as HTMLMetaElement).content = getComputedStyle(
                document.documentElement,
            ).getPropertyValue('--color-main-' + id)
        }
    } else {
        const color = ('000000' + Number(id).toString(16)).slice(-6)
        updateWinColor(color, 'windows')
    }
    // 深黑模式下切换主题色时，重新应用色调
    if (runtimeData.tags.deeperDarkMode) {
        setTimeout(() => applyDeeperDarkTint(), 50)
    }
    // 避免 css 未加载完
    setTimeout(refreshFavicon, 10)
}

/**
 * 切换聊天面板
 * @param name 文件名
 */
function changeChatView(name: string | undefined) {
    const safeName = (name || '').toString().replaceAll(/(^['"])|(['"]$)/g, '').trim()
    if (safeName) {
        runtimeData.pageView.chatView = markRaw(
            defineAsyncComponent(
                () => import(`@renderer/pages/chat-view/${safeName}.vue`),
            ),
        )
    } else {
        runtimeData.pageView.chatView = markRaw(
            defineAsyncComponent(() => import('@renderer/pages/Chat.vue')),
        )
    }
}

// =============== 设置基础功能 ===============

/**
 * 读取并序列化 localStorage 中的设置项（electron 读取 electron-store 存储）
 * @returns 设置项集合
 */
export async function load(): Promise<{ [key: string]: any }> {
    let data = {} as { [key: string]: any }

    if ('electron' == backend.type) {
        data = backend.callSync('opt:getAll')
    } else if('tauri' == backend.type) {
        data = await backend.call(undefined, 'opt:getAll', true)
        // 处理下 json 字符串
        Object.keys(data).forEach((key) => {
            const value = data[key]
            if (typeof value == 'string') {
                try {
                    data[key] = JSON.parse(value)
                } catch (e: unknown) {
                    // ignore
                }
            }
        })
    } else {
        const str = localStorage.getItem('options')
        if (str != null) {
            const list = str.split('&')
            for (let i = 0; i < list.length; i++) {
                if (list[i] !== undefined) {
                    const indexOfColon = list[i].indexOf(':')
                    if (indexOfColon !== -1) {
                        data[list[i].substring(0, indexOfColon)] = list[i].substring(indexOfColon + 1)
                    }
                }
            }
        }
    }
    return loadOptData(data)
}

function loadOptData(data: { [key: string]: any }) {
    const options: { [key: string]: any } = {}
    Object.keys(data).forEach((key) => {
        const value = data[key]
        if (value === 'true' || value === 'false') {
            options[key] = value === 'true'
        } else if (value === 'null') {
            options[key] = null
        } else if (typeof value == 'string') {
            try {
                options[key] = decodeURIComponent(value)
            } catch (e: unknown) {
                // 如果 decodeURIComponent 失败（比如 CSS 内容有特殊字符），直接使用原值
                options[key] = value
            }
            try {
                options[key] = JSON.parse(options[key])
            } catch (e: unknown) {
                // ignore
            }
        } else {
            options[key] = value
        }
        // 执行设置项操作
        run(key, options[key])
    })
    let optChanged = false
    // 初始化不存在的需要进行初始化的值
    Object.keys(optDefault).forEach((key) => {
        if (options[key] === undefined) {
            optChanged = true
            options[key] = optDefault[key]
        }
    })
    // 删除不存在的设置项
	const needless: string[] = []
	for (const key in options) {
		if (optDefault[key] === undefined)
			needless.push(key)
	}
    if (!import.meta.env.DEV){
        for (const key of needless) {
			delete options[key]
		}
    }else if (needless.length > 0) {
		new PopInfo().add(
			PopType.INFO,
			'发现' + needless.length + '条未使用的配置属性',
			false,
		)
	}

    // 保存
    if (optChanged) {
        saveAll(options)
    }
    // 保存返回
    cacheConfigs = options
    return options
}

/**
 * 执行设置项对应的方法
 * @param name 设置项名称
 * @param value 设置项值
 */
export function run(name: string, value: any) {
    if (typeof configFunction[name] === 'function') configFunction[name](value)
}

/**
 * 获取设置项值
 * @param name 设置项名称
 * @returns 设置项值（如果没有则为 null）
 */
export function get(name: string): any {
    if (cacheConfigs) {
        const names = Object.keys(cacheConfigs)
        for (let i = 0; i < names.length; i++) {
            if (names[i] === name) {
                const get = cacheConfigs[names[i]]
                try {
                    return JSON.parse(get)
                } catch (e: unknown) {
                    return get
                }
            }
        }
    }
    return null
}

/**
 * 获取原始设置项值
 * @param name 设置项名称
 * @returns 设置项值（如果没有则为 null）
 * @description <strong>注意：</strong>
 * 此方法获取原始设置项值，不会对值进行 T/F 转换、JSON 解析、URL 解码等操作；
 * 在 Web 端和 Capacitor 端使用时由于存储在 WebStorage 中，需要特别注意预防上述未转换导致的错误。
 */
export function getRaw(name: string) {
    if ('electron' == backend.type) {
        return backend.call('opt:get', name, true)
    } else if('tauri' == backend.type) {
        return backend.call(undefined, 'opt:get', true, name)
    } else {
        // 解析拆分并执行各个设置项的初始化方法
        const str = localStorage.getItem('options')
        if (str != null) {
            const list = str.split('&')
            for (let i = 0; i < list.length; i++) {
                if (list[i] !== undefined) {
                    const indexOfColon = list[i].indexOf(':')
                    if (indexOfColon !== -1) {
                        const optName = list[i].substring(0, indexOfColon)
                        if (name == optName) {
                            return Promise.resolve(list[i].substring(indexOfColon + 1))
                        }
                    }
                }
            }
        }
        return Promise.resolve(null)
    }
}

/**
 * 保存设置项
 * @param name 设置项名称
 * @param value 设置项值
 */
export function save(name: string, value: any) {
    cacheConfigs[name] = value
    saveAll()
}
export function saveAll(config = {} as { [key: string]: any }) {
    if (Object.keys(config).length == 0) {
        Object.assign(config, cacheConfigs)
    }
    let str = ''
    Object.keys(config).forEach((key) => {
        const isObject = typeof config[key] == 'object'
        str +=
            key +
            ':' +
            encodeURIComponent(
                isObject ? JSON.stringify(config[key]) : config[key],
            ) +
            '&'
    })
    str = str.substring(0, str.length - 1)
    localStorage.setItem('options', str)

    // electron：将配置保存
    if (backend.isDesktop()) {
        const saveConfig = config
        Object.keys(config).forEach((key) => {
            const isObject = typeof config[key] == 'object'
            saveConfig[key] = isObject ? JSON.stringify(config[key]): config[key]
        })
        backend.call(undefined, 'opt:saveAll', false,
            backend.type == 'tauri' ? { data: saveConfig } : saveConfig)
    }
}

/**
 * 保存并触发设置项操作
 * @param name 设置项名称
 * @param value 设置项值
 */
export function runAS(name: string, value: any) {
    save(name, value)
    run(name, value)
}

/**
 * 通过 DOM 事件保存并触发设置项操作
 * @param event DOM 事件
 */
export function runASWEvent(event: Event) {
    const sender = event.target as HTMLElement
    if (sender != null) {
        const type = sender.nodeName
        const name = sender.getAttribute('name')
        let value = null as any
        switch (type) {
            case 'SELECT': {
                value = (sender as HTMLSelectElement).options[
                    (sender as HTMLSelectElement).selectedIndex
                ].value
                break
            }
            case 'INPUT': {
                switch ((sender as HTMLInputElement).type) {
                    case 'checkbox': {
                        value = (sender as HTMLInputElement).checked
                        break
                    }
                    case 'radio': {
                        value = sender.dataset.id
                        break
                    }
                    case 'color':
                    case 'range':
                    case 'number':
                    case 'text': {
                        value = (sender as HTMLInputElement).value
                        break
                    }
                }
                break
            }
        }
        if (name !== null) {
            runAS(name, value)
        }
    }
    // 有些设置项需要重启/刷新
    if (sender.dataset.reload == 'true') {
        const { $t } = app.config.globalProperties
        const html =
            '<span>' +
            $t('此操作将在重启应用后生效，现在就要重启吗？') +
            '</span>'

        const popInfo = {
            svg: 'trash-arrow-up',
            html: html,
            title: $t('重启应用'),
            button: [
                {
                    text: app.config.globalProperties.$t('确定'),
                    fun: () => {
                        if (backend.isDesktop()) {
                            backend.call(undefined, 'win:relaunch', false)
                        } else {
                            location.reload()
                        }
                    },
                },
                {
                    text: app.config.globalProperties.$t('取消'),
                    master: true,
                    fun: () => {
                        runtimeData.popBoxList.shift()
                    },
                },
            ],
        }
        runtimeData.popBoxList.push(popInfo)
    }
}

/**
 * 删除设置项
 * @param name 设置项名称
 */
export function remove(name: string) {
    delete cacheConfigs[name]
    saveAll()
}

// ================ 工具方法 ================
export function checkDefault(name: string) {
    return (runtimeData.sysConfig[name] == undefined ||
        runtimeData.sysConfig[name] == optDefault[name]) ? '' : 'changed'
}

export default {
    get,
    getRaw,
    load,
    save,
    run,
    runAS,
    runASWEvent,
    remove,
    checkDefault,
}
