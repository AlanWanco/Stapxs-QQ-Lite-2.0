import jp from 'jsonpath'
import app from '@renderer/main'
import anime from 'animejs'
import option from '@renderer/function/option'

import { Logger, PopInfo, PopType } from '@renderer/function/base'
import { runtimeData } from '@renderer/function/msg'
import { v4 as uuid } from 'uuid'
import { Connector } from '@renderer/function/connect'
import {
    BotMsgType,
    UserFriendElem,
    UserGroupElem,
} from '../elements/information'
import { sendStatEvent } from './appUtil'
import { backend } from '@renderer/runtime/backend'

const logger = new Logger()

// 历史消息可能保留 OneBot 原始 data 嵌套结构；发送前统一展开，
// 避免文本被包装成 data: { data: { text: '...' } }。
function normalizeOutgoingSegment(segment: any): any | undefined {
    if (typeof segment === 'string') return { type: 'text', text: segment }
    if (!segment || typeof segment !== 'object' || Array.isArray(segment)) return undefined

    const nestedData = segment.data && typeof segment.data === 'object' && !Array.isArray(segment.data)
        ? segment.data
        : undefined
    const type = segment.type ?? segment._type ?? nestedData?.type ?? nestedData?._type
    const normalized = nestedData
        && !['json', 'xml'].includes(String(type))
        ? { ...nestedData, ...segment }
        : { ...segment }

    if (type !== undefined) normalized.type = type
    if (nestedData && !['json', 'xml'].includes(String(type))) delete normalized.data
    delete normalized._type
    return normalized
}

interface PreparedOutgoingMessage {
    preview: any[]
    message: any[]
    plainTextFallback?: string
    error?: string
}

interface PendingOutgoingMessage {
    id: string
    chatId: string | number
    chatType: string
    echo: string
    action: string
    params: { [key: string]: any }
    message: any[] | string
    lastMessage: any[] | string
    plainTextFallback?: string
    fallbackUsed: boolean
    failed: boolean
    draft?: any
}

const pendingOutgoingMessages = new Map<string, PendingOutgoingMessage>()

function isOutgoingObject(value: any): value is { [key: string]: any } {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cloneOutgoingValue(value: any): any {
    if (Array.isArray(value)) return value.map(cloneOutgoingValue)
    if (isOutgoingObject(value)) {
        const result: { [key: string]: any } = {}
        Object.keys(value).forEach((key) => {
            if (value[key] !== undefined) result[key] = cloneOutgoingValue(value[key])
        })
        return result
    }
    return value
}

function isOutgoingScalar(value: any): boolean {
    return value === null || typeof value === 'string' ||
        (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean'
}

function hasOutgoingValue(data: { [key: string]: any }, keys: string[]) {
    return keys.some((key) => {
        const value = data[key]
        if (typeof value === 'string') return value.trim() !== ''
        return typeof value === 'number' && Number.isFinite(value)
    })
}

function validateOutgoingSegment(segment: any, index: number): string | undefined {
    if (!isOutgoingObject(segment) || typeof segment.type !== 'string' || segment.type.trim() === '') {
        return `segment-${index}-missing-type`
    }
    if (!isOutgoingObject(segment.data)) return `segment-${index}-invalid-data`

    const type = segment.type.trim()
    const data = segment.data
    if (!['node', 'anonymous'].includes(type)) {
        const hasNonScalarValue = Object.entries(data).some(([key, value]) => {
            if (isOutgoingScalar(value)) return false
            return type === 'json' && (key === 'data' || key === 'config') && isOutgoingObject(value)
                ? false
                : true
        })
        if (hasNonScalarValue) return `segment-${index}-non-scalar-data`
    }
    switch (type) {
        case 'text':
            if (typeof data.text !== 'string') return `segment-${index}-text-missing-text`
            break
        case 'face':
            if (!hasOutgoingValue(data, ['id'])) return `segment-${index}-face-missing-id`
            break
        case 'at':
            if (!hasOutgoingValue(data, ['qq'])) return `segment-${index}-at-missing-qq`
            break
        case 'reply':
            if (!hasOutgoingValue(data, ['id'])) return `segment-${index}-reply-missing-id`
            break
        case 'image':
        case 'record':
        case 'video':
        case 'file':
            if (!hasOutgoingValue(data, ['file', 'url', 'path', 'base64', 'id', 'file_id'])) {
                return `segment-${index}-${type}-missing-source`
            }
            break
        case 'json':
            if (!hasOutgoingValue(data, ['data']) && !isOutgoingObject(data.data)) {
                return `segment-${index}-${type}-missing-data`
            }
            break
        case 'xml':
            if (!hasOutgoingValue(data, ['data'])) return `segment-${index}-${type}-missing-data`
            break
        default:
            // 保留适配器自定义消息段，但仍要求其 data 是对象。
            break
    }
    return undefined
}

function prepareOutgoingMessage(msg: string | any[]): PreparedOutgoingMessage {
    const rawSegments = typeof msg === 'string' ? [msg] : msg
    if (!Array.isArray(rawSegments)) {
        return { preview: [], message: [], error: 'message-not-array' }
    }

    const preview: any[] = []
    const message: any[] = []
    for (let index = 0; index < rawSegments.length; index++) {
        const normalized = normalizeOutgoingSegment(rawSegments[index])
        if (!normalized || normalized.type === undefined) {
            return { preview: [], message: [], error: `segment-${index}-invalid` }
        }

        const type = String(normalized.type).trim()
        if (type === '') return { preview: [], message: [], error: `segment-${index}-missing-type` }
        const rawData = normalized.data
        const data = ['json', 'xml'].includes(type)
            ? Object.keys(normalized).reduce((result: { [key: string]: any }, key) => {
                if (key !== 'type' && key !== 'data' && normalized[key] !== undefined) {
                    result[key] = cloneOutgoingValue(normalized[key])
                }
                return result
            }, isOutgoingObject(rawData)
                ? cloneOutgoingValue(rawData)
                : { data: cloneOutgoingValue(rawData) })
            : Object.keys(normalized).reduce((result: { [key: string]: any }, key) => {
                if (key !== 'type' && key !== 'data' && normalized[key] !== undefined) {
                    result[key] = cloneOutgoingValue(normalized[key])
                }
                return result
            }, {})
        const wireSegment = { type, data }
        const validationError = validateOutgoingSegment(wireSegment, index)
        if (validationError) return { preview: [], message: [], error: validationError }
        if (type === 'text' && data.text === '') continue

        message.push(wireSegment)
        preview.push({ type, ...cloneOutgoingValue(data) })
    }

    if (message.length === 0) return { preview: [], message: [], error: 'message-empty' }
    const first = message[0]
    const plainTextFallback = message.length === 1 && first.type === 'text'
        ? first.data.text
        : undefined
    return { preview, message, plainTextFallback }
}

function getOutgoingErrorText(response: any): string {
    const values = [
        response?.message,
        response?.msg,
        response?.wording,
        response?.error,
        response?.data?.message,
        response?.data?.msg,
        response?.data?.error,
    ]
    return values.filter((value) => typeof value === 'string').join(' ')
}

function isOutgoingValidationError(response: any): boolean {
    return /MessageElementValidationError|message\s*element.*validation|message\s+segment.*(field|invalid|must\s+be)|消息段.*(校验|验证)/i.test(
        getOutgoingErrorText(response),
    )
}

function isOutgoingFailedResponse(response: any): boolean {
    if (!response || typeof response !== 'object') return true
    if (response.status === 'failed') return true
    return response.retcode !== undefined && Number(response.retcode) !== 0
}

function findOutgoingMessage(messageId: string) {
    return runtimeData.messageList.find((item: any) => {
        return String(item?.fake_message_id ?? '') === messageId ||
            String(item?.message_id ?? '') === messageId
    })
}

function getComposerDraftKey(chatId: string | number): number | undefined {
    const numericId = Number(chatId)
    return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : undefined
}

function dispatchOutgoingEvent(name: string, detail: { messageId: string; chatId: string | number; chatType: string }) {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(name, { detail }))
}

function markOutgoingFailed(pending: PendingOutgoingMessage) {
    if (pending.failed) return
    pending.failed = true
    const failedMessage = findOutgoingMessage(pending.id)
    if (failedMessage) {
        failedMessage.fake_msg = false
        failedMessage.revoke = false
        failedMessage.send_failed = true
    }
    const draftKey = getComposerDraftKey(pending.chatId)
    if (draftKey !== undefined && pending.draft) {
        runtimeData.composerDrafts.set(draftKey, pending.draft)
    }
    dispatchOutgoingEvent('ssqq-outgoing-failed', {
        messageId: pending.id,
        chatId: pending.chatId,
        chatType: pending.chatType,
    })
    new PopInfo().add(
        PopType.ERR,
        app.config.globalProperties.$t('消息发送失败，点击消息旁的警告图标重试'),
    )
}

function sendPendingOutgoing(pending: PendingOutgoingMessage, message: any[] | string) {
    pending.lastMessage = message
    Connector.send(
        pending.action,
        { ...pending.params, message },
        `${pending.echo}_uuid_${pending.id}`,
    )
}

export function getOutgoingDraft(messageId: string) {
    return pendingOutgoingMessages.get(messageId)?.draft
}

export function getFailedOutgoingMessageId(chatId: string | number, chatType: string): string | undefined {
    for (const pending of pendingOutgoingMessages.values()) {
        if (pending.failed && String(pending.chatId) === String(chatId) && pending.chatType === chatType) {
            return pending.id
        }
    }
    return undefined
}

export function retryOutgoingMessage(messageId: string): boolean {
    const pending = pendingOutgoingMessages.get(messageId)
    if (!pending || !pending.failed) return false
    pending.failed = false
    const failedMessage = findOutgoingMessage(messageId)
    if (failedMessage) {
        failedMessage.send_failed = false
        failedMessage.fake_msg = true
    }
    sendPendingOutgoing(pending, pending.lastMessage)
    return true
}

export function handleOutgoingResponse(messageId: string, response: any): 'none' | 'retrying' | 'failed' | 'success' {
    const pending = pendingOutgoingMessages.get(messageId)
    if (!pending) return 'none'
    if (isOutgoingFailedResponse(response)) {
        if (!pending.fallbackUsed && pending.plainTextFallback !== undefined && isOutgoingValidationError(response)) {
            pending.fallbackUsed = true
            sendPendingOutgoing(pending, pending.plainTextFallback)
            return 'retrying'
        }
        markOutgoingFailed(pending)
        return 'failed'
    }

    pendingOutgoingMessages.delete(messageId)
    const draftKey = getComposerDraftKey(pending.chatId)
    if (draftKey !== undefined && runtimeData.composerDrafts.get(draftKey) === pending.draft) {
        runtimeData.composerDrafts.delete(draftKey)
    }
    dispatchOutgoingEvent('ssqq-outgoing-succeeded', {
        messageId,
        chatId: pending.chatId,
        chatType: pending.chatType,
    })
    return 'success'
}

/**
 * 根据 JSON Path 映射数据返回需要的内容体
 * @param msg
 * @param map
 * @returns
 */
export function getMsgData(
    name: string,
    msg: { [key: string]: any },
    map: string | { [key: string]: any },
) {
    // OneBot 失败响应通常仍是一个完整对象，不能仅靠 data === null
    // 判断；否则映射对象会生成 [{}]，误触发登录/列表处理。
    if (
        msg?.status === 'failed' ||
        (msg?.retcode !== undefined && Number(msg.retcode) !== 0)
    ) return undefined

    let back = undefined as any
    // 解析数据
    if (map != undefined) {
        if (typeof map == 'string' || map.source != undefined) {
            try {
                back = jp.query(
                    msg,
                    replaceJPValue(typeof map == 'string' ? map : map.source),
                )
                if (Array.isArray(back)) {
                    back = back.filter((item) => item && typeof item === 'object')
                }
                if (back && typeof map != 'string' && map.list != undefined) {
                    const backList = [] as any[]
                    back.forEach((item) => {
                        const itemObj = {} as any
                        Object.keys(map.list).forEach((key: string) => {
                            if (map.list[key] && map.list[key] != '') {
                                if (map.list[key].startsWith('/'))
                                    itemObj[key] =
                                        item[map.list[key].substring(1)]
                                else {
                                    let nameKey = map.list[key]
                                    let regexKey = null
                                    if (nameKey.indexOf('@') > -1) {
                                        const [name, key] = nameKey.split('@')
                                        nameKey = name
                                        regexKey = key
                                    }
                                    itemObj[key] = jp.query(
                                        item,
                                        replaceJPValue(nameKey),
                                    )
                                    if (regexKey != null) {
                                        const regex = new RegExp(regexKey)
                                        const match = itemObj[key].match(regex)
                                        if (match != null) {
                                            itemObj[key] = match[0]
                                        }
                                    }
                                }
                            }
                        })
                        backList.push(itemObj)
                    })
                    back = backList
                }
            } catch (ex) {
                logger.error(
                    ex as Error,
                    `解析消息 JSON 错误：${name} -> ${map}`,
                )
            }
        } else {
            const data = {} as { [key: string]: any }
            Object.keys(map).forEach((key) => {
                if (
                    map[key] != undefined &&
                    map[key] !== '' &&
                    !key.startsWith('_')
                )
                    try {
                        data[key] = jp.query(msg, replaceJPValue(map[key]))[0]
                    } catch (ex) {
                        logger.error(
                            ex as Error,
                            `解析 JSON 错误：${name} -> ${map}`,
                        )
                    }
            })
            back = [data]
        }
    }
    return back
}
function replaceJPValue(jpStr: string) {
    return jpStr.replaceAll('<uin>', runtimeData.loginInfo.uin)
}

/**
 * 将一个消息体列表组装为基础消息列表便于解析（message 消息体可能不正确）
 * @param msgList
 * @param map
 * @returns
 */
export function buildMsgList(msgList: { [key: string]: any }): {
    [key: string]: any
} {
    const path = jp.parse(runtimeData.jsonMap.message_list.source)
    const keys = [] as string[]
    path.forEach((item) => {
        if (item.expression.value != '*' && item.expression.value != '$') {
            keys.push(item.expression.value)
        }
    })
    const result = {} as any
    let acc = result
    keys.forEach((key, index) => {
        if (index === keys.length - 1) {
            acc[key] = msgList
        } else {
            acc[key] = {}
        }
        acc = acc[key]
    })
    return result
}

export function parseMsgList(
    list: any,
    map: string,
    valueMap: { [key: string]: any },
): any[] {
    // API 返回空数组或失败响应时不要访问 list[0]。
    if (!Array.isArray(list)) return []
    list = list.filter((item: any) => item && typeof item === 'object')
    if (list.length === 0) return []

    // 判断消息类型
    if (typeof list[0].message == 'string') {
        runtimeData.tags.msgType = BotMsgType.CQCode
    } else {
        runtimeData.tags.msgType = BotMsgType.Array
    }
    // 消息类型的特殊处理
    switch (runtimeData.tags.msgType) {
        case BotMsgType.CQCode: {
            // 这儿会默认处理成 oicq2 的格式，所以 CQCode 消息请使用 oicq2 配置文件修改
            for (let i = 0; i < list.length; i++) {
                if (typeof list[i].message === 'string') {
                    list[i] = parseCQ(list[i])
                } else if (!Array.isArray(list[i].message)) {
                    list[i].message = []
                }
            }
            break
        }
        case BotMsgType.Array: {
            // 非扁平化消息体，这儿会取 _type 后半段的 JSON Path 将结果并入 message
            for (let i = 0; i < list.length; i++) {
                let msgList = list[i].message
                if (msgList == undefined) {
                    msgList = list[i].content
                }
                if (!Array.isArray(msgList)) {
                    list[i].message = []
                    continue
                }
                for (let j = 0; j < msgList.length; j++) {
                    const data = getMsgData(
                        'message_list_message',
                        msgList[j],
                        map,
                    )
                    // 如果 data 里有 type 字段，改成 type_item
                    if (data?.[0] && data[0]['type'] != undefined) {
                        data[0]['type_item'] = data[0]['type']
                        delete data[0]['type']
                    }
                    if (data?.length == 1 && data[0]) {
                        msgList[j] = Object.assign(msgList[j], data[0])
                    }
                }
            }
        }
    }
    // 消息字段的标准化特殊处理
    if (valueMap != undefined) {
        for (let i = 0; i < list.length; i++) {
            let content = list[i].message
            if (content == undefined) {
                content = list[i].content
            }
            if (!Array.isArray(content)) continue
            content.forEach((item: any) => {
                if (!item || typeof item !== 'object') return
                Object.entries(valueMap).forEach(([type, values]) => {
                    if (item.type == type && values && typeof values === 'object') {
                        Object.entries(values as { [key: string]: any }).forEach(([key, value]) => {
                            try {
                                const mappedValue = jp.query(item, value as string)[0]
                                // 映射路径不存在时保留已有字段，避免把 SnowLuma
                                // 的 data.url 等有效值覆盖成 undefined。
                                if (mappedValue !== undefined) item[key] = mappedValue
                            } catch {
                                // 消息段字段异常时保留已有扁平字段，继续解析其他段。
                            }
                        })
                        // 顺便把没用的 data 删了，这边要注意 item.data 必须是个对象
                        // 因为有些消息类型的 data 就叫 data
                        if (typeof item.data == 'object') {
                            delete item.data
                        }
                    }
                })
            })
            // 其他处理
            if (list[i].content != undefined) {
                // 把 content 改成 message
                list[i].message = content
                delete list[i].content
                // 添加一个 sender.user_id 为 user_id
                list[i].sender = {
                    user_id: list[i].user_id,
                    nickname: list[i].nickname,
                }
            }
        }
    }
    return list
}

/**
 * 将消息对象处理为扁平字符串
 * @param message 待处理的消息对象
 * @returns 字符串
 */
export function getMsgRawTxt(data: any, html = true): string {
    const { $t } = app.config.globalProperties

    const message = Array.isArray(data?.message)
        ? data.message as [{ [key: string]: any }]
        : []
    const fromId = data?.group_id ?? data?.user_id
    let back = ''
    for (let i = 0; i < message.length; i++) {
        try {
            switch (message[i].type) {
                case 'at': {
                    let atName = message[i].text
                    if (atName == undefined) {
                        // 群内才可以 at，如果 at 消息中没有 text 字段
                        // 尝试去群成员列表中找到对应的昵称，群成员列表只在当前打开的群才有
                        const groupMembers = runtimeData.chatInfo.show.id == fromId &&
                            Array.isArray(runtimeData.chatInfo.info.group_members)
                            ? runtimeData.chatInfo.info.group_members
                            : []
                        if (groupMembers.length > 0) {
                            const user = groupMembers.find(
                                (item) => item.user_id == message[i].qq,
                            )
                            if (user) {
                                atName = '@' + (user.card && user.card != '' ? user.card : user.nickname)
                            }
                        }
                    }
                    if (atName) {
                        back += html ? `<span class="reply-name">${atName}</span>` : atName
                    } else {
                        // 实在找不到名字，显示 QQ 号
                        const name = `@${message[i].qq}`
                        back += html ? `<span class="reply-name">${name}</span>` : name
                    }
                    break
                }
                // eslint-disable-next-line
                case 'text':
                    back += String(message[i].text ?? '')
                        .replaceAll('\n', ' ')
                        .replaceAll('\r', ' ')
                    break
                case 'forward':
                    if (Array.isArray(message[i].content) && message[i].content.length > 0) {
                        const lines = message[i].content.map((item: any) => {
                            const senderName = item?.sender?.card && item.sender.card !== ''
                                ? item.sender.card
                                : item?.sender?.nickname ?? ''
                            const contentText = getMsgRawTxt(item, false)
                            return senderName ? `${senderName}: ${contentText}` : contentText
                        }).filter((item: string) => item.trim() !== '')
                        back += lines.length > 0 ? lines.join(' | ') : '[' + $t('聊天记录') + ']'
                    } else {
                        back += '[' + $t('聊天记录') + ']'
                    }
                    break
                case 'face':
                    back += '[' + $t('表情') + ']'
                    break
                case 'bface':
                    back += message[i].text
                    break
                case 'image':
                    back +=
                        (!message[i].summary || message[i].summary == '') ? '[' + $t('图片') + ']' : message[i].summary
                    break
                case 'record':
                    back += '[' + $t('语音') + ']'
                    break
                case 'video':
                    back += '[' + $t('视频') + ']'
                    break
                case 'file':
                    back += '[' + $t('文件') + ']'
                    break
                case 'json': {
                    try {
                        const raw = message[i].data
                        const card = typeof raw === 'string' ? JSON.parse(raw) : raw
                        const prompt = card?.prompt
                        back += prompt ? String(prompt) : '[' + $t('卡片消息') + ']'
                    } catch (error) {
                        back += '[' + $t('卡片消息') + ']'
                    }
                    break
                }
                case 'xml': {
                    const xml = typeof message[i].data === 'string' ? message[i].data : ''
                    const marker = '<source name="'
                    const start = xml.indexOf(marker)
                    const end = start >= 0 ? xml.indexOf('"', start + marker.length) : -1
                    const name = start >= 0 && end >= 0 ? xml.substring(start + marker.length, end) : ''
                    back += name ? '[' + name + ']' : '[' + $t('卡片消息') + ']'
                    break
                }
            }
        } catch (error) {
            logger.error(error as Error, '解析消息短格式失败')
        }
    }
    return back
}

/**
 * 将消息对象转换为 CQCode
 * @param data
 * @returns CQCode 字符串
 */
export function parseJSONCQCode(data: any) {
    let back = ''
    data.forEach((item: any) => {
        if (item.type != 'text') {
            let body = '[CQ:' + item.type + ','
            Object.keys(item).forEach((key: any) => {
                body += `${key}=${item[key]},`
            })
            body = body.substring(0, body.length - 1) + ']'
            back += body
        } else {
            back += item.text
        }
    })
    return back
}

/**
 * 将扁平的 CQCode 消息处理成消息对象
 * @param msg CQCode 消息
 * @returns 消息对象
 */
export function parseCQ(data: any) {
    let msg = data.message as string
    // 将纯文本也处理为 CQCode 格式
    // PS：这儿不用担心方括号本身，go-cqhttp 会把它转义掉
    let reg = /^[^\]]+?\[|\].+\[|\][^[]+$|^[^[\]]+$/g
    const textList = msg.match(reg)
    if (textList !== null) {
        textList.forEach((item) => {
            item = item.replace(']', '').replace('[', '')
            msg = msg.replace(item, `[CQ:text,text=${item}]`)
        })
    }
    // 拆分 CQCode
    reg = /\[.+?\]/g
    msg = msg.replaceAll('\n', '\\n')
    const list = msg.match(reg)
    // 处理为 object
    const back: { [ket: string]: any }[] = []
    reg = /\[CQ:([^,]+),(.*)\]/g
    if (list !== null) {
        list.forEach((item) => {
            if (item.match(reg) !== null) {
                const info: { [key: string]: any } = { type: RegExp.$1 }
                RegExp.$2.split(',').forEach((key: string) => {
                    const kv = [] as string[]
                    kv.push(key.substring(0, key.indexOf('=')))
                    // 对 html 转义字符进行反转义
                    const a = document.createElement('a')
                    a.innerHTML = key.substring(key.indexOf('=') + 1)
                    kv.push(a.innerText)
                    info[kv[0]] = kv[1]
                })
                // 对文本消息特殊处理
                if (info.type == 'text') {
                    info.text = RegExp.$2
                        .substring(RegExp.$2.lastIndexOf('=') + 1)
                        .replaceAll('\\n', '\n')
                    // 对 html 转义字符进行反转义
                    const a = document.createElement('a')
                    a.innerHTML = info.text
                    info.text = a.innerText
                }
                // 对回复消息进行特殊处理
                if (info.type == 'reply') {
                    data.source = {
                        user_id: info.user_id,
                        seq: info.seq,
                        message: info.message,
                    }
                } else {
                    back.push(info)
                }
            }
        })
    }
    logger.debug('解析 CQ 消息结果：消息段数量 ' + back.length)
    data.message = back
    return data
}

/**
* 发送消息
* @param id 发送对象的 id
* @param type 发送对象的类型
* @param msg 消息体
* @param preShow 是否消息预显
* @param echo 回显的事件名
* @param draft 发送失败时恢复的输入草稿
*/
export function sendMsgRaw(
    id: string,
    type: string,
    msg: string | any[] | undefined,
    preShow = false,
    echo = 'sendMsgBack',
    draft?: any,
): boolean {
    // 如果消息为空则不发送
    if (msg == undefined || msg == '' || (Array.isArray(msg) && msg.length == 0)) {
        return false
    }

    const messageListMap = runtimeData.jsonMap?.message_list ?? {}
    let action = ''
    let params: { [key: string]: any } = {}
    switch (type) {
        case 'group':
            action = messageListMap.name_group_send ?? 'send_msg'
            params = { group_id: id }
            break
        case 'user':
            if (String(id).indexOf('/') > 1) {
                action = messageListMap.name_temp_send ?? 'send_temp_msg'
                params = {
                    user_id: id.split('/')[0],
                    group_id: id.split('/')[1],
                }
            } else {
                action = messageListMap.name_user_send ?? 'send_msg'
                params = { user_id: id }
            }
            break
        default:
            logger.error(null, `不支持的消息目标类型：${type}`)
            return false
    }

    const shouldNormalize = runtimeData.tags.msgType == BotMsgType.Array || Array.isArray(msg)
    let outgoingMessage: any = msg
    let previewMessage: any[] = typeof msg === 'string'
        ? [{ type: 'text', text: msg }]
        : []
    let plainTextFallback: string | undefined
    if (shouldNormalize) {
        const prepared = prepareOutgoingMessage(msg)
        if (prepared.error) {
            logger.error(null, `发送消息参数校验失败：${prepared.error}`)
            new PopInfo().add(
                PopType.ERR,
                app.config.globalProperties.$t('消息格式无效，已阻止发送'),
            )
            return false
        }
        outgoingMessage = prepared.message
        previewMessage = prepared.preview
        plainTextFallback = prepared.plainTextFallback
    }

    // 预发送消息：必须使用已经校验过的结构，避免显示一个实际不会发送的假消息。
    const msgUUID = uuid()
    if (preShow) {
        const preShowMsg: any[] = previewMessage.map((item) => cloneOutgoingValue(item))
        preShowMsg.forEach((item: any) => {
            // 对 base64 图片做特殊处理
            if (item?.type == 'image') {
                const file = typeof item.file === 'string' ? item.file : ''
                if (file.startsWith('base64://')) {
                    const b64Str = file.substring(9)
                    item.url = 'data:image/png;base64,' + b64Str
                } else if ((!item.url || item.url == '') && file !== '') {
                    item.url = file
                }
            }
        })
        const showMsg = {
            revoke: true,
            fake_msg: true,
            message_id: msgUUID,
            fake_message_id: msgUUID,       // 用来作为这条消息的唯一标识，防止 message_id 刷新导致的闪烁
            message_type: runtimeData.chatInfo.show.type,
            time: parseInt(String(new Date().getTime() / 1000)),
            post_type: 'message',
            sender: {
                user_id: runtimeData.loginInfo.uin,
                nickname: runtimeData.loginInfo.nickname,
            },
            message: preShowMsg,
        } as { [key: string]: any }
        showMsg.raw_message = getMsgRawTxt(showMsg, false)

        if (showMsg.message_type == 'group') {
            showMsg.group_id = runtimeData.chatInfo.show.id
        } else {
            showMsg.user_id = runtimeData.chatInfo.show.id
        }
        runtimeData.messageList = runtimeData.messageList.concat([showMsg])
    }

    if (runtimeData.jsonMap?.name === 'Lagrange.OneBot') {
        lgrSendMsg(id, outgoingMessage, type, echo + '_uuid_' + msgUUID)
        sendStatEvent('send_msg', { type: type })
        return true
    }

    const pending: PendingOutgoingMessage = {
        id: msgUUID,
        chatId: runtimeData.chatInfo.show?.id ?? id,
        chatType: type,
        echo,
        action,
        params,
        message: outgoingMessage,
        lastMessage: outgoingMessage,
        plainTextFallback,
        fallbackUsed: false,
        failed: false,
        draft,
    }
    pendingOutgoingMessages.set(msgUUID, pending)
    sendPendingOutgoing(pending, outgoingMessage)
    sendStatEvent('send_msg', { type: type })
    return true
}

export function updateLastestHistory(item: UserFriendElem & UserGroupElem) {
    // 发起获取历史消息请求
    const type = item.user_id ? 'user' : 'group'
    const id = item.user_id ? item.user_id : item.group_id
    let name
    if (runtimeData.jsonMap.message_list && type != 'group') {
        name = runtimeData.jsonMap.message_list.private_name
    } else {
        name = runtimeData.jsonMap.message_list.name
    }
    Connector.send(
        name ?? 'get_chat_history',
        {
            message_type: runtimeData.jsonMap.message_list.message_type[type],
            group_id: id,
            user_id: id,
            message_id: 0,
            count: 1,
        },
        'getChatHistoryOnMsg_' + id,
    )
}

/**
 * 刷新消息列表排序
 */
export function updateBaseOnMsgList() {
    const allList = [...runtimeData.baseOnMsgList.values()]
    // 先更具 item.always_top 是不是 true 拆为两个数组
    const topList = allList.filter((item) => item.always_top)
    const normalList = allList.filter((item) => !item.always_top)
    // 将两个数组按照 item.time 降序排序
    // item.time 不存在或者相同时按照 item.py_start 降序排序

    const sortFun = (
        a: UserFriendElem & UserGroupElem,
        b: UserFriendElem & UserGroupElem,
    ) => {
        if (a.time == b.time || a.time == undefined || b.time == undefined) {
            if (a.py_start == undefined || b.py_start == undefined) {
                return 0
            }
            return b.py_start.charCodeAt(0) - a.py_start.charCodeAt(0)
        }
        return b.time - a.time
    }
    topList.sort(sortFun)
    normalList.sort(sortFun)

    let onMsgList = [] as any[]
    let groupAssistList = [] as any[]
    if (runtimeData.sysConfig.bubble_sort_user) {
        // 将 normalList 进行拆分
        onMsgList = topList.concat(normalList.filter((item) => {
            return item.group_id && !isInGroupBox(item.group_id) ||
                item.user_id || item.new_msg || item.highlight
        }))
        groupAssistList = normalList.filter((item) => {
            return item.group_id && isInGroupBox(item.group_id)
        })
    } else {
        onMsgList = topList.concat(normalList)
    }

    runtimeData.onMsgList = onMsgList
    runtimeData.groupAssistList = groupAssistList
}

/**
 * 判断当前消息是否可以通知
 * @param id 群号
 * @returns 是否可以通知
 */
export function canGroupNotice(id: number) {
    const noticeInfo = option.get('notice_group') ?? {}
    const list = noticeInfo[runtimeData.loginInfo.uin]
    if (list) {
        return list.indexOf(id) >= 0
    }
    return false
}

/**
 * 判断群组是否应在群收纳盒中
 * 优先检查用户显式覆盖（group_box_override），
 * 无覆盖时回退到默认逻辑：通知关闭的群组归入收纳盒
 * @param id 群号
 * @returns 是否在群收纳盒中
 */
export function isInGroupBox(id: number): boolean {
    const overrideInfo = option.get('group_box_override') ?? {}
    const overrides = overrideInfo[runtimeData.loginInfo.uin] as
        { [key: number]: boolean } | undefined
    if (overrides && overrides[id] !== undefined) {
        return overrides[id]
    }
    // 默认：通知关闭的群组归入收纳盒
    return !canGroupNotice(id)
}

/**
 * 戳一戳触发动画
 * @param animeBody 动画作用的元素
 * @param windowInfo 窗口信息，在 electron 中使用
 */
export function pokeAnime(animeBody: HTMLElement | null, windowInfo = null as {
    x: number
    y: number
    width: number
    height: number
} | null) {
    if (animeBody) {
        const timeLine = anime.timeline({ targets: animeBody })
        // 如果窗口小于 500px 播放完整的动画（手机端样式）
        if (
            (document.getElementById('app')?.offsetWidth ?? 500) <
            500
        ) {
            navigator.vibrate([10, 740, 10])
            timeLine.add({ translateX: 30, duration: 600, easing: 'cubicBezier(.44,.09,.53,1)' })
                .add({ translateX: 0, duration: 150, easing: 'cubicBezier(.44,.09,.53,1)' })
                .add({ translateX: [0, 25, 0], duration: 500, easing: 'cubicBezier(.21,.27,.82,.67)' })
                .add({ targets: {}, duration: 1000 })
                .add({ translateX: 70, duration: 1300, easing: 'cubicBezier(.89,.72,.72,1.13)' })
                .add({ translateX: 0, duration: 100, easing: 'easeOutSine' })
        }
        timeLine.add({ translateX: [-10, 10, -5, 5, 0], duration: 500, easing: 'cubicBezier(.44,.09,.53,1)' })
        timeLine.change = async () => {
            if (animeBody) {
                animeBody.parentElement?.parentElement?.classList.add('poking')
                const teansformX = animeBody.style.transform
                // teansformX 的数字可能是科学计数法，需要转换为普通数字
                let num = Number((teansformX.match(/-?\d+\.?\d*/g) ?? [0])[0])
                // 取整
                num = Math.round(num)
                // 输出 translateX
                if (backend.isDesktop() && windowInfo) {
                    await backend.call(undefined, 'win:move', false, {
                        x: windowInfo.x + num,
                        y: windowInfo.y,
                    })
                }
            }
        }
        timeLine.changeComplete = () => {
            if (animeBody) {
                animeBody.parentElement?.parentElement?.classList.remove('poking')
            }
        }
    }
}

export function sendMsgAppendInfo(msg: any) {
    if (msg.message) {
        msg.message.forEach(() => {
            // TODO: 消息附加功能，暂时没用到
        })
    }
}

/**
 *
 * @param base group_name 或者 nickname
 * @param remark remark
 * @returns 显示的名称
 */
export function getShowName(base: string, remark: string) {
    if (!remark || remark == '' || remark == base) {
        return base.replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    } else {
        return (remark + '（' + base + '）').replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    }
}

/**
 * 判断是否需要显示时间戳（上下超过五分钟的消息）
 * @param timePrv 上条消息的时间戳（10 位）
 * @param timeNow 当前消息的时间戳（10 位）
 */
export function isShowTime(
    timePrv: number | undefined,
    timeNow: number,
    alwaysShow = false,
): boolean {
    if (alwaysShow) return true
    if (timePrv == undefined) return false
    // 五分钟 10 位时间戳相差 300
    return timeNow - timePrv >= 300
}

/**
 * 计算 QQ 等级图标
 * @param level QQ 等级
 * @returns 图标数量
 */
export function qqLevelIcons(level) {
    const result = {
        crown: 0,  // 皇冠
        sun: 0,    // 太阳
        moon: 0,   // 月亮
        star: 0    // 星星
    };

    result.crown = Math.floor(level / 64);
    level %= 64;

    result.sun = Math.floor(level / 16);
    level %= 16;

    result.moon = Math.floor(level / 4);
    level %= 4;

    result.star = level;

    return result;
}

/**
 * 计算 QQ 等级表情
 * @param level QQ 等级
 * @returns 表情字符串
 */
export function qqLevelToEmoji(level) {
    const rawLevel = level
    if (level <= 0) return level

    const crown = Math.floor(level / 64);
    level %= 64;

    const sun = Math.floor(level / 16);
    level %= 16;

    const moon = Math.floor(level / 4);
    level %= 4;

    const star = level;

    return '👑'.repeat(crown) + '☀️'.repeat(sun) + '🌙'.repeat(moon) + '⭐️'.repeat(star) + '（' + rawLevel + '）';
}

/**
 * 将图片 URL 转换为 PNG 格式的 Uint8Array
 * 支持 base64 和 HTTP URL 格式的图片
 * @param imageUrl 图片 URL
 */
export async function getImageUrlData(imageUrl: string): Promise<{ buffer: Uint8Array, blob: Blob }> {
    return new Promise((resolve, reject) => {
        const img = new Image()

        img.onload = () => {
            try {
                // 创建 canvas 并设置尺寸
                const canvas = document.createElement('canvas')
                canvas.width = img.width
                canvas.height = img.height

                // 获取 2D 上下文并绘制图片
                const ctx = canvas.getContext('2d')
                if (!ctx) {
                    reject(new Error('无法获取 Canvas 上下文'))
                    return
                }

                ctx.drawImage(img, 0, 0)

                // 将 canvas 转换为 PNG 格式的 blob
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('图片转换失败'))
                        return
                    }

                    // 读取 blob 为 ArrayBuffer，然后转换为 Uint8Array
                    const reader = new FileReader()
                    reader.onload = () => {
                        const arrayBuffer = reader.result as ArrayBuffer
                        resolve({
                            buffer: new Uint8Array(arrayBuffer),
                            blob: blob
                        }
                        )
                    }
                    reader.onerror = () => {
                        reject(new Error('读取图片数据失败'))
                    }
                    reader.readAsArrayBuffer(blob)
                }, 'image/png') // 强制转换为 PNG 格式
            } catch (error) {
                reject(error)
            }
        }

        img.onerror = () => {
            reject(new Error('图片加载失败'))
        }

        // 处理跨域问题
        img.crossOrigin = 'anonymous'
        img.src = imageUrl
    })
}

/**
 * 判断这个消息是不是[已删除]
 * @param msg
 */
export function isDeleteMsg(msg: any): boolean {
    if (!msg || !['message', 'message_sent'].includes(msg.post_type)) return false
    if (msg.sender?.user_id !== runtimeData.loginInfo.uin) return false
    if (msg.raw_message !== '&#91;已删除&#93;') return false
    return true
}

/**
 * 获取两个字符串之间的差异
 * @param a 原字符串
 * @param b 新字符串
 * @returns 差异列表，包含差异的起始位置、结束位置和差异内容
 */
export function getDifferencesWithRanges(a: string, b: string) {
    let i = 0; // a 的指针
    let j = 0; // b 的指针
    const diffs = [] as { start: number; end: number; str: string }[]
    let currentDiffStart = null as number | null
    let currentDiffStr = ''

    while (j < b.length) {
        if (i < a.length && a[i] === b[j]) {
            // 遇到匹配字符，先保存上一个差异块
            if (currentDiffStr) {
                diffs.push({
                    start: currentDiffStart!,
                    end: j - 1,
                    str: currentDiffStr
                })
                currentDiffStr = ''
                currentDiffStart = null
            }
            i++;
        } else {
            // 遇到差异字符，记录
            if (currentDiffStart === null) currentDiffStart = j;
            currentDiffStr += b[j];
        }
        j++;
    }

    // 遍历结束，如果还有未保存的差异块
    if (currentDiffStr) {
        diffs.push({
            start: currentDiffStart!,
            end: j - 1,
            str: currentDiffStr
        });
    }

    return diffs;
}

/**
 * lgr专用发送消息，懒得写了，不做通用适配，胡乱应付下吧
 * @param msg 消息内容
 */
function lgrSendMsg(id: string, msg: any, type: string, cb: string) {
    if (msg[0].type === 'node') {
        const sendMsgs = [] as any[]
        msg.forEach((item) => {
            const msg = {
                type: item.type,
                data: {
                    user_id: item.data.user_id.toString(),
                    nickname: item.data.nickname,
                    content: item.data.content.map((item) => {
                        const copy = { ...item }
                        delete copy.type
                        return {
                            type: item.type,
                            data: { ...copy }
                        }
                    }),
                },
            }
            sendMsgs.push(msg)
        })
        if (type === 'group') {
            Connector.send(
                'send_group_forward_msg',
                { group_id: id, messages: sendMsgs },
                cb,
            )
        } else if (type === 'user') {
            Connector.send(
                'send_private_forward_msg',
                { user_id: id, messages: sendMsgs },
                cb,
            )
        } else {
            new PopInfo().add(PopType.ERR, 'lgr不支持匿名聊天')
        }
    } else {
        if (type === 'group') {
            Connector.send(
                'send_group_msg',
                { group_id: id, message: msg },
                cb,
            )
        } else if (type === 'user') {
            Connector.send(
                'send_private_msg',
                { user_id: id, message: msg },
                cb,
            )
        } else {
            new PopInfo().add(PopType.ERR, 'lgr不支持匿名聊天')
        }
    }
}
