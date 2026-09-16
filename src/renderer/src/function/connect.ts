/*
 * @FileDescription: Websocket 底层模块
 * @Author: Stapxs
 * @Date: 2022/10/20
 * @Version: 1.0
 * @Description: 此模块主要处理 Websocket 交互相关功能
 */

import Option from './option'
import app from '@renderer/main'

import { reactive } from 'vue'
import { LogType, Logger, PopType, PopInfo } from './base'
import { dispatch, runtimeData } from './msg'

import { BotActionElem, LoginCacheElem } from './elements/system'
import { updateMenu } from '@renderer/function/utils/appUtil'

import { v4 as uuid } from 'uuid'
import { getMsgData } from './utils/msgUtil'
import { backend } from '@renderer/runtime/backend'

const logger = new Logger()
const popInfo = new PopInfo()

function isApiResponseFailed(response: any): boolean {
    if (!response || typeof response !== 'object') return true
    if (response.status === 'failed') return true
    return response.retcode !== undefined && Number(response.retcode) !== 0
}

function summarizeWsMessage(data: Record<string, any>): Record<string, any> {
    const summary: Record<string, any> = {
        status: data.status,
        retcode: data.retcode,
        hasEcho: data.echo !== undefined,
        postType: data.post_type,
        noticeType: data.notice_type,
        metaEventType: data.meta_event_type,
        messageType: data.message_type,
        action: data.action,
    }
    if (data.data && typeof data.data === 'object') {
        summary.dataType = Array.isArray(data.data) ? 'array' : 'object'
        if (!Array.isArray(data.data)) summary.dataKeys = Object.keys(data.data)
        if (Array.isArray(data.data.messages)) summary.messageCount = data.data.messages.length
    }
    if (Array.isArray(data.message)) summary.segmentCount = data.message.length
    if (data.params && typeof data.params === 'object') {
        summary.paramKeys = Object.keys(data.params)
        if (Array.isArray(data.params.message)) summary.paramSegmentCount = data.params.message.length
        if (typeof data.params.message === 'string') summary.paramMessageType = 'string'
        if (Array.isArray(data.params.messages)) summary.paramMessageCount = data.params.messages.length
    }
    return Object.fromEntries(
        Object.entries(summary).filter(([, value]) => value !== undefined),
    )
}

let retry = 0

export let websocket: WebSocket | undefined = undefined

class TimeoutError extends Error {
    echo: string
    constructor(echo: string) {
        super()
        this.echo = echo
    }
}

export class Connector {
    /**
     * 创建 Websocket 连接
     * @param address 地址
     * @param token 密钥
     */
    static create(
        address: string,
        token?: string,
        wss: boolean | undefined = undefined,
    ) {
        const { $t } = app.config.globalProperties
        login.creating = true

        // 设置连接超时保护
        window.setTimeout(() => {
            if (login.creating) {
                login.creating = false
            }
        }, 10000)

        logger.add(LogType.WS, '连接诊断日志已启用（仅记录协议元数据）')

        // Electron 和 Capacitor 默认使用后端连接模式（Tauri 暂时走前端 WebSocket）
        if (backend.type === 'electron' || backend.type === 'capacitor') {
            logger.add(LogType.WS, '使用后端连接模式')
            backend.call('Onebot', 'onebot:connect', false,
                backend.isDesktop() ?  { address: address, token: token, } : { url: `${address}?access_token=${token ? encodeURIComponent(token) : ''}` })
            return
        }

        if(import.meta.env.VITE_APP_SSE_MODE == 'true') {
            if(import.meta.env.VITE_APP_SSE_SUPPORT == 'false') {
                // 如果 Bot 不支持 SSE 连接，直接跳过触发连接完成的后续操作
                // PS：在未连接 SSE 的情况下，ssqq 将会缺失一些功能：
                // - 新的消息推送、通知推送
                // - 聊天面板新消息将不会自动更新，但依旧可以通过重新加载面板来获取新消息
                this.onopen(address, token)
                return
            }
            logger.add(LogType.WS, '使用 SSE 连接模式')
            const sse = new EventSource(`${import.meta.env.VITE_APP_SSE_EVENT_ADDRESS}?access_token=${token ? encodeURIComponent(token) : ''}`)
            sse.onopen = () => {
                login.creating = false
                this.onopen(address, token)
            }
            sse.onmessage = (e) => {
                this.onmessage(e.data)
            }
            sse.onerror = () => {
                login.creating = false
                popInfo.add(PopType.ERR, $t('连接不稳定'))
                return
            }
            return
        } else {
            // PS：只有在未设定 wss 类型的情况下才认为是首次连接
            if (wss == undefined) {
                retry = 0
            } else {
                retry++
            }
            // 最多自动重试连接五次
            if (retry > 5) {
                login.creating = false
                return
            }

            let url = `ws://${address}?access_token=${token ? encodeURIComponent(token) : ''}`
            if (address.startsWith('ws://') || address.startsWith('wss://')) {
                url = `${address}?access_token=${token ? encodeURIComponent(token) : ''}`
            } else if (wss == undefined) {
                // 判断连接类型
                if (document.location.protocol == 'https:') {
                    // 判断连接 URL 的协议，https 优先尝试 wss
                    runtimeData.tags.connectSsl = true
                    url = `wss://${address}?access_token=${token ? encodeURIComponent(token) : ''}`
                }
            } else {
                url = `wss://${address}?access_token=${token ? encodeURIComponent(token) : ''}`
            }

            if (!websocket) {
                websocket = new WebSocket(url)
            }

            websocket.onopen = () => {
                login.creating = false
                this.onopen(address, token)
            }
            websocket.onmessage = (e) => {
                this.onmessage(e.data)
            }
            websocket.onclose = (e) => {
                login.creating = false
                this.onclose(e.code, e.reason, address, token)
            }
            websocket.onerror = () => {
                login.creating = false
                popInfo.add(PopType.ERR, $t('连接失败') + ': ' + $t('未知错误'))
            }
        }
    }

    // 连接事件 =====================================================

    static onopen(address: string, token: string | undefined) {
        logger.add(LogType.WS, '连接成功')
        // 保存登录信息
        Option.save('address', address)
        // 保存密钥
        if (
            runtimeData.sysConfig.save_password &&
            runtimeData.sysConfig.save_password != ''
        ) {
            Option.save('save_password', token)
        }
        // 清空应用通知
        popInfo.clear()
        // 加载初始化数据
        // PS：标记登陆成功在获取用户信息的回调位置，防止无法获取到内容
        Connector.send('get_version_info', {}, 'getVersionInfo')
        // 更新菜单
        updateMenu({
            parent: 'account',
            id: 'logout',
            action: 'visible',
            value: 'true',
        })
    }

    static onmessage(message: string) {
        let data: any
        try {
            data = JSON.parse(message)
        } catch {
            logger.add(LogType.WS, 'GET：收到非 JSON 消息')
            return
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return

        // 仅记录协议元数据和数量，避免把消息、联系人、Cookie 原文写入日志。
        logger.add(LogType.WS, 'GET：', summarizeWsMessage(data))
        const rawEcho = data.echo
        if (rawEcho === undefined) {
            dispatch(data)
            return
        }
        if (rawEcho === null || rawEcho === '') {
            logger.debug('忽略空 echo')
            return
        }
        if (typeof rawEcho !== 'string') {
            logger.debug('忽略非字符串 echo')
            return
        }

        const echo = rawEcho
        delete data.echo
        // 旧回调系统处理
        if (echo.startsWith('send_')) {
            dispatch(data, echo.slice(5))
            return
        }
        this.ReMap.set(echo, data)
    }

    /**
     * 返回值Map
     */
    private static ReMap: Map<string, any> = new Map()

    static waitReturn(echo: string, timeout: number=5000): Promise<any> {
        return new Promise((resolve, reject) => {
            const startTime = Date.now()

            const check = () => {
                if (this.ReMap.has(echo)) {
                    const re = this.ReMap.get(echo)
                    this.ReMap.delete(echo)
                    resolve(re)
                    return
                }

                if (Date.now() - startTime > timeout) {
                    reject(new TimeoutError(echo))
                    return
                }

                setTimeout(check, 20)
            }

            check()
        })
    }

    static onclose(
        code: number,
        _msg: string | undefined,
        address: string,
        token: string | undefined,
    ) {
        const { $t } = app.config.globalProperties

        websocket = undefined
        updateMenu({ parent: 'account', id: 'logout', action: 'visible', value: 'false' })
        updateMenu({ parent: 'account', id: 'userName', action: 'label', value: $t('连接') })

        switch (Number(code)) {
            case 1000:
                popInfo.add(PopType.INFO, $t('连接已断开'), false)
                break // 正常关闭
            default: {
                // 默认尝试重连（排除 1000 正常关闭）
                if (login.status) {
                    // 如果是登录状态下的断开，尝试静默重连，只在控制台输出日志
                    logger.add(LogType.WS, $t('连接异常关闭') + '，正在尝试自动重连...')
                    setTimeout(() => {
                        this.create(address, token, undefined)
                    }, 2000)
                } else {
                    // 初始连接失败，弹出错误提示
                    popInfo.add(PopType.ERR, $t('连接异常关闭'), false)
                    login.creating = false
                }
                break
            }
        }

        logger.error(null, $t('连接失败') + ': ' + code)
        login.creating = false
        login.status = false
    }

    // 连接器操作 =====================================================

    /**
     * 正常断开 Websocket 连接
     */
    static close() {
        if(backend.type === 'electron' || backend.type === 'capacitor') {
            backend.call('Onebot', 'onebot:close', false)
        } else {
            popInfo.add(
                PopType.INFO,
                app.config.globalProperties.$t('正在断开链接……'),
            )
            if (websocket) websocket.close(1000)
        }
    }

    /**
     * 调用 api
     * TODO 标准API适配
     * @param api  api名称,该api应该为映射Map里存在的键
     * @param args 参数
     * @returns undefined 表示无此API, null表示调用失败, 其余为经getMsgData过滤的返回值
     */
    /**
     * 调用 api（支持自定义超时）
     * @param api     api名称
     * @param args    参数
     * @param timeout 超时毫秒数（默认 5000ms）
     */
    static async callApiWithTimeout(api: string, args: {[key: string]: any}, timeout: number): Promise<any|undefined|null>{
        const echo = uuid()
        const apiMap = runtimeData.jsonMap[api]
        if (!apiMap) {
            logger.debug(`${runtimeData.jsonMap.name} 未适配 API ${api}`)
            return undefined
        }
        if (typeof apiMap.name !== 'string' || apiMap.name.trim() === '') {
            logger.error(null, `API ${api} 缺少有效的请求名称`)
            return null
        }

        if(import.meta.env.VITE_APP_SSE_MODE == 'true') {
            this.sendSeeMod(apiMap.name, args, echo)
        } else {
            this.sendRaw(apiMap.name, args, echo)
        }

        try{
            const re = await this.waitReturn(echo, timeout)
            if (isApiResponseFailed(re)) {
                logger.error(null, `API ${api} 返回失败：${String(re?.retcode ?? 'unknown')}`)
                return null
            }
            return getMsgData(api, re, apiMap)
        }catch (e) {
            if (e instanceof TimeoutError) {
                logger.error(e, `API ${api} 请求超时`)
            }else {
                logger.error(e as Error, `API ${api} 请求失败`)
            }
        }
        return null
    }

    static async callApi(api: string, args: {[key: string]: any}): Promise<any|undefined|null>{
        // 组建信息
        const echo = uuid()
        const apiMap = runtimeData.jsonMap[api]
        if (!apiMap) {
            logger.debug(`${runtimeData.jsonMap.name} 未适配 API ${api}`)
            return undefined
        }
        if (typeof apiMap.name !== 'string' || apiMap.name.trim() === '') {
            logger.error(null, `API ${api} 缺少有效的请求名称`)
            return null
        }

        // 发送信息
        if(import.meta.env.VITE_APP_SSE_MODE == 'true') {
            // 使用 http POST 请求 /api/$name,body 为 json
            this.sendSeeMod(apiMap.name, args, echo)
        } else {
            this.sendRaw(apiMap.name, args, echo)
        }

        // 处理响应
        try{
            const re = await this.waitReturn(echo)
            if (isApiResponseFailed(re)) {
                logger.error(null, `API ${api} 返回失败：${String(re?.retcode ?? 'unknown')}`)
                return null
            }
            return getMsgData(api, re, apiMap)
        }catch (e) {
            if (e instanceof TimeoutError) {
                logger.error(e, `API ${api} 请求超时`)
            }else {
                logger.error(e as Error, `API ${api} 请求失败`)
            }
        }
        return null
    }

    /**
     * 发送 Websocket 消息
     * @param name 事件名
     * @param value 参数
     * @param echo 回调名
     * @deprecated 该函数看似在掉api,其实还有去指定对象调用回调函数,无法拿到api返回值
     */
    static send(
        name: string,
        value: { [key: string]: any },
        echo: string = name,
    ) {
        echo = 'send_' + echo
        if(import.meta.env.VITE_APP_SSE_MODE == 'true') {
            // 使用 http POST 请求 /api/$name,body 为 json
            this.sendSeeMod(name,value,echo)
        } else {
            this.sendRaw(name, value, echo)
        }
    }
    /**
     * 使用 see 模式发请求，请求结果会一并送到onmessage方法上
     * @param name api名称
     * @param args 参数
     * @param echo 回调标识
     */
    static sendSeeMod(
        name: string,
        args: { [key: string]: any },
        echo: string = name,
    ) {
        if (typeof name !== 'string' || name.trim() === '') {
            logger.error(null, '未找到有效的 API 名称，取消发送')
            return
        }
        let body: string
        try {
            body = JSON.stringify(args ?? {})
        } catch (error) {
            logger.error(error as Error, `API ${name} 请求参数无法序列化`)
            this.onmessage(JSON.stringify({
                status: 'failed',
                retcode: -1,
                data: null,
                echo,
            }))
            return
        }
        fetch(`${import.meta.env.VITE_APP_SSE_HTTP_ADDRESS}/${name}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': login.token,
            },
            body,
        }).then(async (response) => {
            let data: any
            try {
                data = await response.json()
            } catch {
                logger.error(null, `API ${name} 返回非 JSON 数据`)
                this.onmessage(JSON.stringify({
                    status: 'failed',
                    retcode: -1,
                    data: null,
                    echo,
                }))
                return
            }
            if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)) {
                logger.error(null, `API ${name} HTTP 响应失败：${response.status}`)
                this.onmessage(JSON.stringify({
                    status: 'failed',
                    retcode: response.status || -1,
                    data: null,
                    echo,
                }))
                return
            }
            data.echo = echo
            this.onmessage(JSON.stringify(data))
        }).catch((error) => {
            logger.error(error, ` 请求 API ${name} 失败`)
            this.onmessage(JSON.stringify({
                status: 'failed',
                retcode: -1,
                data: null,
                echo,
            }))
        })
    }
    /**
     * 使用 ws 模式发请求，请求结果会送到onmessage方法上
     * @param name api名称
     * @param args 参数
     * @param echo 回调标识
     */
    static sendRaw(
        name: string,
        args: { [key: string]: any },
        echo: string = name,
    ) {
        if (typeof name !== 'string' || name.trim() === '') {
            logger.error(null, '未找到有效的 API 名称，取消发送')
            return
        }
        let json: string
        try {
            json = JSON.stringify({
                action: name,
                params: args ?? {},
                echo: echo,
            } as BotActionElem)
        } catch (error) {
            logger.error(error as Error, `API ${name} 请求参数无法序列化`)
            return
        }

        try {
            // 发送
            if (backend.type === 'electron' || backend.type === 'capacitor') {
                void backend.call('Onebot', 'onebot:send', false, json)
            } else if (websocket) {
                websocket.send(json)
            }
        } catch (error) {
            logger.error(error as Error, `API ${name} 发送失败`)
            return
        }

        const summary = summarizeWsMessage(JSON.parse(json))
        if (Option.get('log_level') === 'debug') {
            logger.add(LogType.DEBUG, 'PUT：', summary)
        } else {
            logger.add(LogType.WS, 'PUT：', summary)
        }
    }
    static sendRawJson(str: string) {
        try {
            const json = JSON.parse(str)
            if (!json || typeof json !== 'object' || Array.isArray(json) || typeof json.action !== 'string') {
                logger.error(null, '收到无效的 API 请求，已忽略')
                return
            }
            this.sendRaw(
                json.action,
                json.params && typeof json.params === 'object' && !Array.isArray(json.params)
                    ? json.params
                    : {},
                typeof json.echo === 'string' ? json.echo : undefined,
            )
        } catch (error) {
            logger.error(error as Error, '解析 API 请求失败')
        }
    }
}

export const login: LoginCacheElem = reactive({
    quickLogin: [],
    status: false,
    address: '',
    token: '',
    creating: false,
})
