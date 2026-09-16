/*
 * @FileDescription: 基础功能模块
 * @Author: Stapxs
 * @Date: 2022/10/20
 * @Version: 1.0
 * @Description: 此模块主要为程序相关的基础功能
 */

import Option from './option'
import { reactive } from 'vue'
import { PopInfoElem } from './elements/system'

// =============== 日志 ===============

export enum LogType {
    WS,
    UI,
    ERR,
    INFO,
    DEBUG,
    SYSTEM
}

const sensitiveLogKeyPattern = /(?:token|password|passwd|secret|cookie|authorization|credential|api[_-]?key|private[_-]?key|access[_-]?key)/i
const privateLogKeyPattern = /(?:message|chat|user|group|sender|receiver|target|operator|self|contact|file|url|path|base64|avatar|prompt|content|text|nickname|card|remark|echo|res|forward|data|address|host|endpoint|uin|id)(?:id|name|url|hash|data)?$/i

function isPrivateLogKey(key: string): boolean {
    const normalized = key.replaceAll('_', '').replaceAll('-', '')
    return sensitiveLogKeyPattern.test(key) || privateLogKeyPattern.test(normalized)
}

function sanitizeLogString(value: unknown): string {
    const text = typeof value === 'string' ? value : String(value ?? '')
    return text
        .replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[URL已隐藏]')
        .replace(/file:\/\/\/(?:Users|home|private|var|tmp)\/[^\s"'<>]+/gi, '[路径已隐藏]')
        .replace(/\/(?:Users|home|private|var|tmp)\/[^\s"'<>]+/gi, '[路径已隐藏]')
        .replace(/[A-Za-z]:\\[^\s"'<>]+/g, '[路径已隐藏]')
        .replace(/(\b(?:bearer|authorization|token|password|secret|cookie|api[_-]?key)\s*[:=]\s*)[^\s,;&]+/gi, '$1[已隐藏]')
}

function sanitizeLogValue(value: any, key = '', depth = 0, seen = new WeakSet<object>()): any {
    if (isPrivateLogKey(key)) return '[已隐藏]'
    if (value === null || value === undefined) return value
    if (typeof value === 'string') return sanitizeLogString(value)
    if (typeof value !== 'object') return value
    if (value instanceof Error) {
        return {
            name: value.name,
            message: '[错误详情已隐藏]',
        }
    }
    if (depth >= 3) return '[内容已省略]'
    if (seen.has(value)) return '[循环引用]'
    seen.add(value)
    try {
        if (Array.isArray(value)) {
            return value.slice(0, 20).map((item) => sanitizeLogValue(item, '', depth + 1, seen))
        }
        const result: { [key: string]: any } = {}
        Object.keys(value).slice(0, 50).forEach((childKey) => {
            result[childKey] = sanitizeLogValue(value[childKey], childKey, depth + 1, seen)
        })
        return result
    } catch {
        return '[内容无法记录]'
    }
}

export class Logger {
    private logTypeInfo: [string, string][]

    constructor() {
        // 日志类型输出文本前缀样式，顺序对应 LogType
        this.logTypeInfo = [
            ['7abb7e', 'fff'],
            ['b573f7', 'fff'],
            ['ff5370', 'fff'],
            ['99b3db', 'fff'],
            ['677480', 'fff'],
            ['e5a5a9', 'fff'],
        ]
    }

    /**
     * 输出一条日志
     * @param mode 日志类型
     * @param args 日志内容
     */
    add(type: LogType, args: string, data = '' as any, hidden = false) {
        const logLevel = Option.get('log_level')
        const safeArgs = sanitizeLogString(args)
        const safeData = sanitizeLogValue(data)
        // PS：WS, UI, ERR, INFO, DEBUG
        // all 将会输出以上全部类型，debug 将会输出 DEBUG、UI，info 将会输出 INFO，err 将会输出 ERR
        if(import.meta.env.DEV && type === LogType.SYSTEM) {
            this.print(type, safeArgs, safeData, hidden)
        } else if (logLevel === 'all') {
            this.print(type, safeArgs, safeData, hidden)
        } else if (
            logLevel === 'debug' &&
            (type === LogType.DEBUG || type === LogType.UI)
        ) {
            this.print(type, safeArgs, safeData, hidden)
        } else if (logLevel === 'info' && type === LogType.INFO) {
            this.print(type, safeArgs, safeData, hidden)
        } else if (logLevel === 'err' && type === LogType.ERR) {
            this.print(type, safeArgs, safeData, hidden)
        }
    }
    info(args: string, hidden = false) {
        this.add(LogType.INFO, args, undefined, hidden)
    }
    error(e: Error | null, args: string, hidden = false) {
        if (e) {
            // 错误对象只保留类型，避免异常详情、响应正文和路径进入日志。
            const errorType = e instanceof Error ? e.name : typeof e
            this.add(LogType.ERR, args + '\n', {
                name: errorType,
                message: '[错误详情已隐藏]',
            }, hidden)
        } else {
            this.add(LogType.ERR, args, undefined, hidden)
        }
    }
    debug(args: string, hidden = false) {
        this.add(LogType.DEBUG, args, undefined, hidden)
    }
    system(args: string) {
        this.add(LogType.SYSTEM, args, undefined, true)
    }
    /**
     * 打印一条日志
     * @param type 日志类型
     * @param args 日志内容
     */
    private print(type: LogType, args: string, data: any, hidden: boolean) {
        const error = new Error()
        // 浏览器类型，用于判断是不是 webkit
        let isWebkit = /webkit/i.test(navigator.userAgent)
        if(window.electron != undefined) {
            // electron 是 chrome，但是 userAgent 里面含有 webkit 字样
            isWebkit = false
        }
        // 从调用栈中获取调用者信息
        let from = undefined as string | undefined
        const stack = error.stack
        if (stack) {
            const stackArr = stack.split('\n')
            // 找到第一个不是 at Logger 开头的调用者信息（WebKit 为第一个 @ 开头）
            for (let i = 1; i < stackArr.length; i++) {
                if (isWebkit ? stackArr[i].startsWith('@') : !stackArr[i].includes('at Logger')) {
                    // 取出链接部分，去除括号
                    from = stackArr[i].replace(/\(|\)/g, '').split(' ').pop() || ''
                    from = from.replace(
                        'webpack-internal:///./',
                        'webpack-internal:///',
                    )
                    if(from.startsWith('@')) {
                        from = from.substring(1)
                    }
                    if (from.startsWith('webpack-internal:///node_modules')) {
                        from = undefined
                    }
                    break
                }
            }
        }
        // 打印日志
        let typeStr = LogType[type]
        if (typeStr === 'WS') {
            if (args.startsWith('GET')) {
                args = args.substring(4)
                typeStr = '<<<'
            } else if (args.startsWith('PUT')) {
                args = args.substring(4)
                typeStr = '>>>'
            }
        }

        // 如果存在 vconsole 就不打印带 css 样式的日志（它不支持）
        // 因为在 capturer 下 from 是无意义的，所以也不显示
        const safeFrom = from ? sanitizeLogString(from) : from
        if (document.getElementById('__vconsole')) {
            const { message } = this.buildLogParams(typeStr, args, hidden, type)
            this.logOutput(message.replaceAll('%c', ' | '), [], data, false)
        } else {
            const { message, styles } = this.buildLogParams(typeStr, args, hidden, type, safeFrom)
            this.logOutput(message, styles, data)
        }
    }

    private buildLogParams(
        typeStr: string,
        args: string,
        hidden: boolean,
        type: LogType,
        from?: string
    ): { message: string; styles: string[] } {
        const hasFrom = !hidden && from;
        if (hasFrom) {
            return {
                message: `%c${typeStr}%c${from}%c\n${args}`,
                styles: [
                    `background:#${this.logTypeInfo[type][0]};color:#${this.logTypeInfo[type][1]};border-radius:7px 0 0 7px;padding:2px 4px 2px 7px;margin-bottom:7px;`,
                    'background:#e3e8ec;color:#000;padding:2px 7px 4px 4px;border-radius:0 7px 7px 0;margin-bottom:7px;',
                    ''
                ]
            }
        } else {
            return {
                message: `%c${typeStr}%c ${args}`,
                styles: [
                    `background:#${this.logTypeInfo[type][0]};color:#${this.logTypeInfo[type][1]};border-radius:7px;padding:2px 4px 2px 7px;margin-bottom:7px;`,
                    '',
                    ''
                ]
            }
        }
    }

    private logOutput(message: string, styles: string[], data: any, useStyles = true) {
        if (useStyles) {
            // eslint-disable-next-line no-console
            console.log(message, ...styles, data)
        } else {
            // eslint-disable-next-line no-console
            console.log(message, data)
        }
    }
}

// =============== 系统消息 ===============

export enum PopType {
    INFO = 'circle-info',
    ERR = 'circle-exclamation',
}

export class PopInfo {
    /**
     *
     * @param typeInfo 消息类型
     * @param args 消息内容
     * @param isAutoClose 是否自动关闭（默认为 true）
     */
    add(icon: PopType, args: string, isAutoClose = true) {
        const data: PopInfoElem = {
            id: popList.length,
            svg: icon,
            text: args,
            autoClose: isAutoClose,
        }
        popList.splice(popList.length, 0, data)
        // 创建定时器
        if (data.autoClose) {
            setTimeout(() => {
                this.remove(data.id)
            }, 5000)
        }
    }

    /**
     * 移除一条消息
     * @param id 消息编号
     */
    remove(id: number) {
        const index = popList.findIndex((item) => {
            return item.id === id
        })
        if (index !== -1) {
            popList.splice(index, 1)
        }
    }

    /**
     * 清空所有消息
     */
    clear() {
        // 因为消息是有动画的，所以需要延迟清空
        setTimeout(() => {
            popList.splice(0, popList.length)
        }, 300)
    }
}

export const popList: PopInfoElem[] = reactive([])
