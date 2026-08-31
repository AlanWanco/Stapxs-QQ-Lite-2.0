/**
 * 本地历史消息工具（Tauri 平台）
 */

import { backend } from '@renderer/runtime/backend'
import { getMsgRawTxt } from './msgUtil'
import { Logger } from '../base'
import { runtimeData } from '../msg'

const logger = new Logger()

function debugLocalHistory(tag: string, extra: Record<string, any> = {}) {
    if (!import.meta.env.DEV || backend.type !== 'tauri') return
    backend.call(undefined, 'sys:debugLog', false, {
        tag: 'LocalHistory',
        message: `${tag} ${JSON.stringify(extra)}`,
    })
}

export interface LocalMsgRecord {
    message_id: string
    chat_id: number
    chat_type: string
    sender_id: number
    sender_name: string | null
    seq: number | null
    time: number
    message: string
    raw_message: string | null
    revoked: boolean
}

export interface MessageImageRecord {
    messageId: string
    segIndex: number
    url: string
    urlHash: string
    cacheStatus: 'pending' | 'success' | 'failed'
    lastError: string | null
}

export interface SaveMessagesResult {
    savedMessages: number
    imageTasks: number
    imageCached: number
    imageFailed: number
}

function isTauriHistoryAvailable(): boolean {
    return backend.type === 'tauri' && runtimeData.sysConfig.enable_local_history === true
}

async function callDbRecordList(
    selfId: string | number,
    command: string,
    payload: Record<string, any>,
    errorTag: string,
): Promise<any[]> {
    if (!isTauriHistoryAvailable()) return []
    try {
        const records: LocalMsgRecord[] = await backend.call(
            undefined,
            command,
            true,
            { selfId: String(selfId), ...payload },
        )
        return (records ?? []).map(deserializeRecord)
    } catch (e) {
        logger.error(e as Error, errorTag)
        return []
    }
}

async function callDb(
    selfId: string | number,
    command: string,
    payload: Record<string, any>,
    fallback: any,
    errorTag: string,
): Promise<any> {
    if (!isTauriHistoryAvailable()) return fallback
    try {
        return await backend.call(
            undefined,
            command,
            true,
            { selfId: String(selfId), ...payload },
        )
    } catch (e) {
        logger.error(e as Error, errorTag)
        return fallback
    }
}

function serializeMsgSegments(segments: any[] | undefined): string {
    try {
        return JSON.stringify(segments ?? [])
    } catch {
        return '[]'
    }
}

function sanitizeSegmentForPersistence(segment: any): any {
    if (!segment || typeof segment !== 'object') return segment
    const next = Array.isArray(segment) ? [...segment] : { ...segment }
    delete next.forward_error_code
    delete next.forward_error_detail
    delete next.record_error
    delete next.record_loading
    delete next.record_retry_loading
    delete next.record_retry_formats
    delete next.record_failed
    delete next.record_url
    if (Array.isArray(next.content)) {
        next.content = next.content.map((item: any) => sanitizeMsgForPersistence(item))
    }
    return next
}

export function sanitizeMsgForPersistence(msg: any): any {
    if (!msg || typeof msg !== 'object') return msg
    const next = typeof structuredClone === 'function'
        ? structuredClone(msg)
        : JSON.parse(JSON.stringify(msg))
    delete next._from_local_db
    delete next.fake_msg
    delete next.fileView
    delete next.originMsg
    if (Array.isArray(next.message)) {
        next.message = next.message.map((seg: any) => sanitizeSegmentForPersistence(seg))
    }
    return next
}

function deserializeMsgSegments(serialized: string): any[] {
    try {
        return JSON.parse(serialized)
    } catch {
        return []
    }
}

function computeRawMessage(msg: any): string | null {
    try {
        return getMsgRawTxt(msg) || msg.raw_message || null
    } catch {
        return msg.raw_message ?? null
    }
}

function deriveChatId(selfId: string | number, msgs: any[]): number | undefined {
    const firstMsg = msgs[0]
    let chatId: number | undefined =
        firstMsg?.infoList?.group_id ??
        firstMsg?.group_id ??
        firstMsg?.infoList?.target_id ??
        firstMsg?.target_id
    if (chatId != null) return Number(chatId)

    for (const item of msgs) {
        const senderId = item?.infoList?.sender ?? item?.sender?.user_id ?? item?.user_id
        if (senderId != null && String(senderId) !== String(selfId)) {
            chatId = Number(senderId)
            break
        }
    }
    return chatId
}

export function ensureChatIdOnMsgs(selfId: string | number, msgs: any[]): any[] {
    const chatId = deriveChatId(selfId, msgs)
    if (chatId == null) return msgs

    return msgs.map((item: any) => {
        const nextInfoList = item?.infoList ?? {}
        if (nextInfoList.group_id != null || nextInfoList.target_id != null || item?.group_id != null || item?.target_id != null) {
            return item
        }
        return {
            ...item,
            infoList: {
                ...nextInfoList,
                target_id: chatId,
            },
        }
    })
}

export function msgToRecord(msg: any): LocalMsgRecord | null {
    const sanitizedMsg = sanitizeMsgForPersistence(msg)
    const messageId = sanitizedMsg.message_id
    if (!messageId) return null

    const chatId: number =
        sanitizedMsg.infoList?.group_id ??
        sanitizedMsg.group_id ??
        sanitizedMsg.infoList?.target_id ??
        sanitizedMsg.target_id
    if (chatId == null) return null

    const chatType: string =
        sanitizedMsg.message_type ?? (sanitizedMsg.group_id != null ? 'group' : 'private')
    const senderId: number =
        sanitizedMsg.infoList?.sender ??
        sanitizedMsg.sender?.user_id ??
        sanitizedMsg.user_id
    if (senderId == null) return null

    const senderName: string | null =
        (sanitizedMsg.sender?.card && sanitizedMsg.sender.card !== '') ? sanitizedMsg.sender.card : (sanitizedMsg.sender?.nickname ?? null)

    return {
        message_id: String(messageId),
        chat_id: Number(chatId),
        chat_type: chatType,
        sender_id: Number(senderId),
        sender_name: senderName,
        seq: sanitizedMsg.seq_id != null ? Number(sanitizedMsg.seq_id) : (sanitizedMsg.message_seq != null ? Number(sanitizedMsg.message_seq) : null),
        time: Number(sanitizedMsg.time),
        message: serializeMsgSegments(sanitizedMsg.message),
        raw_message: computeRawMessage(sanitizedMsg),
        revoked: false,
    }
}

export async function dbSaveMessages(selfId: string | number, msgs: any[]): Promise<number> {
    if (!isTauriHistoryAvailable()) return 0

    const persistableMsgs = ensureChatIdOnMsgs(selfId, msgs)
    const records: LocalMsgRecord[] = persistableMsgs
        .map(msgToRecord)
        .filter((item): item is LocalMsgRecord => item !== null)

    if (records.length === 0) return 0

    try {
        return await backend.call(undefined, 'db:saveMessages', true, {
            selfId: String(selfId),
            messages: records,
        })
    } catch (e) {
        logger.error(e as Error, '[LocalHistory] dbSaveMessages 失败')
        return 0
    }
}

export async function saveMessagesWithSideEffects(selfId: string | number, msgs: any[]): Promise<SaveMessagesResult> {
    const persistableMsgs = ensureChatIdOnMsgs(selfId, msgs)
    const savedMessages = await dbSaveMessages(selfId, persistableMsgs)
    if (runtimeData.sysConfig.disable_local_history_image_cache === true) {
        return {
            savedMessages,
            imageTasks: 0,
            imageCached: 0,
            imageFailed: 0,
        }
    }
    void cacheImagesFromMsgs(selfId, persistableMsgs).then((imageResult) => {
        debugLocalHistory('saveMessagesWithSideEffects', {
            selfId: String(selfId),
            savedMessages,
            ...imageResult,
        })
    }).catch((e) => {
        debugLocalHistory('saveMessagesWithSideEffects:error', {
            selfId: String(selfId),
            savedMessages,
            error: e instanceof Error ? e.message : String(e),
        })
    })
    return {
        savedMessages,
        imageTasks: 0,
        imageCached: 0,
        imageFailed: 0,
    }
}

export async function dbGetLatest(selfId: string | number, chatId: number, n: number): Promise<any[]> {
    return callDbRecordList(selfId, 'db:getLatest', { chatId, n }, '[LocalHistory] dbGetLatest 失败')
}

export async function dbGetMessage(selfId: string | number, chatId: number, messageId: string): Promise<any | null> {
    if (!isTauriHistoryAvailable()) return null
    try {
        const record: LocalMsgRecord | null = await backend.call(undefined, 'db:getMessage', true, {
            selfId: String(selfId),
            chatId,
            messageId,
        })
        return record ? deserializeRecord(record) : null
    } catch (e) {
        logger.error(e as Error, '[LocalHistory] dbGetMessage 失败')
        return null
    }
}

export async function dbGetBefore(selfId: string | number, chatId: number, messageId: string, n: number): Promise<any[]> {
    return callDbRecordList(selfId, 'db:getBefore', { chatId, messageId, n }, '[LocalHistory] dbGetBefore 失败')
}

export async function dbGetBeforeByTime(selfId: string | number, chatId: number, beforeTime: number, n: number): Promise<any[]> {
    return callDbRecordList(selfId, 'db:getBeforeByTime', { chatId, beforeTime, n }, '[LocalHistory] dbGetBeforeByTime 失败')
}

export async function dbGetAfter(selfId: string | number, chatId: number, messageId: string, n: number): Promise<any[]> {
    return callDbRecordList(selfId, 'db:getAfter', { chatId, messageId, n }, '[LocalHistory] dbGetAfter 失败')
}

export async function dbRevokeMessage(selfId: string | number, messageId: string): Promise<boolean> {
    return callDb(selfId, 'db:revokeMessage', { messageId }, false, '[LocalHistory] dbRevokeMessage 失败')
}

export async function dbDeleteMessage(selfId: string | number, messageId: string): Promise<boolean> {
    return callDb(selfId, 'db:deleteMessage', { messageId }, false, '[LocalHistory] dbDeleteMessage 失败')
}

export async function dbSearchMessages(selfId: string | number, chatId: number, query: string): Promise<any[]> {
    if (!isTauriHistoryAvailable() || !query) return []
    return callDbRecordList(selfId, 'db:searchMessages', { chatId, query }, '[LocalHistory] dbSearchMessages 失败')
}

export async function dbGetStats(selfId: string | number): Promise<{ totalMessages: number; imageCount: number; imageCacheBytes: number; dbSizeBytes: number } | null> {
    return callDb(selfId, 'db:getStats', {}, null, '[LocalHistory] dbGetStats 失败')
}

export async function hashUrl(url: string): Promise<string> {
    const data = new TextEncoder().encode(url)
    const buf = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function dbCacheImage(selfId: string | number, urlHash: string, mimeType: string, data: string): Promise<void> {
    if (!isTauriHistoryAvailable()) return
    try {
        await backend.call(undefined, 'db:cacheImage', true, {
            selfId: String(selfId),
            urlHash,
            mimeType,
            data,
        })
    } catch (e) {
        logger.error(e as Error, '[LocalHistory] dbCacheImage 失败')
    }
}

export async function dbGetImage(selfId: string | number, urlHash: string): Promise<{ mimeType: string; data: string } | null> {
    return callDb(selfId, 'db:getImage', { urlHash }, null, '[LocalHistory] dbGetImage 失败')
}

export async function dbSaveMessageImages(selfId: string | number, images: MessageImageRecord[]): Promise<number> {
    if (!isTauriHistoryAvailable() || images.length === 0) return 0
    try {
        return await backend.call(undefined, 'db:saveMessageImages', true, {
            selfId: String(selfId),
            images,
        })
    } catch (e) {
        logger.error(e as Error, '[LocalHistory] dbSaveMessageImages 失败')
        return 0
    }
}

export async function dbClearAll(selfId: string | number): Promise<boolean> {
    return callDb(selfId, 'db:clearAll', {}, false, '[LocalHistory] dbClearAll 失败')
}

export interface DbClearImagesProgress {
    selfId: string
    total: number
    deleted: number
    batchDeleted: number
    progress: number
    done: boolean
}

export interface DbClearImagesResult {
    total: number
    deleted: number
    batches: number
}

export interface DbExportBackupResult {
    dbPath: string
    deltaMessages: number
    deltaImages: number
    totalMessages: number
    totalImages: number
}

export interface DbImportBackupResult {
    dbPath: string
    importedMessages: number
    importedImages: number
    totalMessages: number
    totalImages: number
}

export async function dbClearImages(
    selfId: string | number,
    onProgress?: (progress: DbClearImagesProgress) => void,
): Promise<DbClearImagesResult> {
    if (!isTauriHistoryAvailable()) {
        return { total: 0, deleted: 0, batches: 0 }
    }

    let unlisten: undefined | (() => void | Promise<void>)
    if (onProgress && backend.type === 'tauri') {
        const { listen } = await import('@tauri-apps/api/event')
        unlisten = await listen<DbClearImagesProgress>('db:clearImagesProgress', (event) => {
            const payload = event.payload
            if (!payload) return
            if (String(payload.selfId) !== String(selfId)) return
            onProgress(payload)
        })
    }

    try {
        const result = await callDb(
            selfId,
            'db:clearImages',
            {},
            { total: 0, deleted: 0, batches: 0 },
            '[LocalHistory] dbClearImages 失败',
        )
        return {
            total: Number(result?.total ?? 0),
            deleted: Number(result?.deleted ?? 0),
            batches: Number(result?.batches ?? 0),
        }
    } finally {
        if (unlisten) await unlisten()
    }
}

export async function dbExportBackup(selfId: string | number, backupDir: string): Promise<DbExportBackupResult | null> {
    if (!isTauriHistoryAvailable() || !backupDir) return null
    return callDb(
        selfId,
        'db:exportBackup',
        { backupDir },
        null,
        '[LocalHistory] dbExportBackup 失败',
    )
}

export async function dbImportBackup(selfId: string | number, backupDbPath: string): Promise<DbImportBackupResult | null> {
    if (!isTauriHistoryAvailable() || !backupDbPath) return null
    return callDb(
        selfId,
        'db:importBackup',
        { backupDbPath },
        null,
        '[LocalHistory] dbImportBackup 失败',
    )
}

async function cacheImagesFromMsgs(selfId: string | number, msgs: any[]): Promise<{ imageTasks: number; imageCached: number; imageFailed: number }> {
    if (!isTauriHistoryAvailable()) {
        return { imageTasks: 0, imageCached: 0, imageFailed: 0 }
    }
    const refs = await extractImageRefsFromMsgs(msgs)
    await dbSaveMessageImages(selfId, refs.map((item) => ({
        messageId: item.messageId,
        segIndex: item.segIndex,
        url: item.url,
        urlHash: item.urlHash,
        cacheStatus: 'pending',
        lastError: null,
    })))
    let imageCached = 0
    let imageFailed = 0
    for (const ref of refs) {
        try {
            const status = await cacheSingleImage(selfId, ref.url)
            await dbSaveMessageImages(selfId, [{
                messageId: ref.messageId,
                segIndex: ref.segIndex,
                url: ref.url,
                urlHash: ref.urlHash,
                cacheStatus: status === 'success' ? 'success' : 'failed',
                lastError: status === 'success' ? null : status,
            }])
            if (status === 'success') imageCached++
            else imageFailed++
        } catch (e) {
            imageFailed++
            await dbSaveMessageImages(selfId, [{
                messageId: ref.messageId,
                segIndex: ref.segIndex,
                url: ref.url,
                urlHash: ref.urlHash,
                cacheStatus: 'failed',
                lastError: e instanceof Error ? e.message : String(e),
            }])
        }
    }
    return {
        imageTasks: refs.length,
        imageCached,
        imageFailed,
    }
}

async function extractImageRefsFromMsgs(msgs: any[]): Promise<Array<{ messageId: string; segIndex: number; url: string; urlHash: string }>> {
    const refs: Array<{ messageId: string; segIndex: number; url: string; urlHash: string }> = []
    for (const msg of msgs) {
        refs.push(...await extractImageRefsFromSegments(String(msg?.message_id ?? ''), msg?.message, 'top'))
    }
    return refs
}

async function extractImageRefsFromSegments(
    messageId: string,
    segments: any[] | undefined,
    prefix: string,
): Promise<Array<{ messageId: string; segIndex: number; url: string; urlHash: string }>> {
    const refs: Array<{ messageId: string; segIndex: number; url: string; urlHash: string }> = []
    if (!messageId || !Array.isArray(segments)) return refs

    for (const [segIndex, seg] of segments.entries()) {
        const currentKey = `${prefix}-${segIndex}`
        if (seg?.type === 'image' && seg.url && seg.url.startsWith('http')) {
            refs.push({
                messageId,
                segIndex: hashSegIndex(currentKey),
                url: seg.url,
                urlHash: await hashUrl(seg.url),
            })
        }
        if (Array.isArray(seg?.content)) {
            for (const [childIndex, childMsg] of seg.content.entries()) {
                refs.push(...await extractImageRefsFromSegments(
                    messageId,
                    childMsg?.message,
                    `${currentKey}-forward-${childIndex}`,
                ))
            }
        }
    }

    return refs
}

function hashSegIndex(value: string): number {
    let hash = 0
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i)
        hash |= 0
    }
    return Math.abs(hash)
}

async function downloadImageViaProxy(url: string): Promise<{ mimeType: string; base64: string } | null> {
    const fetchUrl = backend.proxy ? `http://localhost:${backend.proxy}/proxy?url=${encodeURIComponent(url)}` : url
    const resp = await fetch(fetchUrl)
    if (!resp.ok) {
        debugLocalHistory('cacheImage:downloadFailed', {
            url,
            fetchUrl,
            status: resp.status,
            statusText: resp.statusText,
        })
        return null
    }

    const mimeType = resp.headers.get('Content-Type')?.split(';')[0]?.trim() ?? 'image/jpeg'
    const buffer = await resp.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
    return { mimeType, base64: btoa(binary) }
}

async function cacheSingleImage(selfId: string | number, url: string): Promise<'success' | string> {
    const urlHash = await hashUrl(url)
    const existing = await dbGetImage(selfId, urlHash)
    if (existing) return 'success'

    const downloaded = await downloadImageViaProxy(url)
    if (!downloaded) {
        debugLocalHistory('cacheImage:miss', {
            selfId: String(selfId),
            url,
            urlHash,
        })
        return 'download-miss'
    }
    await dbCacheImage(selfId, urlHash, downloaded.mimeType, downloaded.base64)
    return 'success'
}

function deserializeRecord(record: LocalMsgRecord): any {
    const message = deserializeMsgSegments(record.message)
    const isSelf = record.sender_id === Number(runtimeData.loginInfo.uin)
    const postType = isSelf ? 'message_sent' : 'message'
    const isGroup = record.chat_type === 'group'
    const sender = isGroup
        ? { user_id: record.sender_id, card: record.sender_name ?? '', nickname: record.sender_name ?? '' }
        : { user_id: record.sender_id, card: '', nickname: record.sender_name ?? '' }
    const infoList = {
        message_id: record.message_id,
        private_id: isGroup ? undefined : record.chat_id,
        group_id: isGroup ? record.chat_id : undefined,
        target_id: isGroup ? undefined : record.chat_id,
        sender: record.sender_id,
    }

    return {
        post_type: postType,
        message_id: record.message_id,
        message_type: record.chat_type,
        ...(isGroup ? { group_id: record.chat_id } : { user_id: record.chat_id }),
        sender,
        time: record.time,
        message,
        infoList,
        raw_message: record.raw_message ?? '',
        revoke: record.revoked,
        ...(record.seq != null ? { message_seq: record.seq, seq_id: record.seq } : {}),
        _from_local_db: true,
    }
}
