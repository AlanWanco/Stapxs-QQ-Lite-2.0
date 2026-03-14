<!--
 * @FileDescription: 卡片消息消息组件
 * @Author: Stapxs
 * @Date: 2023/05/23
 * @Version: 1.0 - 初始版本
 * @Description: 卡片消息的单独组件，由于卡片消息的类型过于复杂越写越乱，所以单独写一个组件
                 同时也是为了优化消息刷新机制的性能，可以对不同的卡片类型设置 v-once。
-->

<!--
    附加补充：
        这儿主要针对更复杂的 json 卡片消息 …… xml 类型的卡片消息因为自定义性比 json 低
        其实已经被官方放弃了，除了比较旧的一些卡片消息，现在基本上都是 json 类型的卡片消息。
-->

<template>
    <div>
        <div v-if="item.type == 'xml'"
            @click="View.cardClick('xml-' + id)"
            v-html="View.buildXML(item.data, item.id, id)" />
        <div v-else>
            <div v-if="info?.type == 'default'"
                style="cursor: pointer;"
                @click="View.cardClick('json-' + id)"
                v-html="buildJSON(info, id)" />
            <div v-else-if="info?.type == 'tencent.map'"
                v-once
                class="msg-comp-map"
                @click="View.cardClick('map-' + id)">
                <p>{{ info.app.title }}</p>
                <span>{{ info.app.desc }}</span>
                <div :id="'map-' + id"
                    class="map"
                    :data-url="createMap()"
                    data-urlOpenType="_self" />
            </div>
        </div>
    </div>
</template>

<script lang="ts">
    import app from '@renderer/main'
    import Option from '@renderer/function/option'

    import { defineComponent } from 'vue'
    import { MsgBodyFuns as ViewFuns } from '@renderer/function/model/msg-body'

    export default defineComponent({
        name: 'CardMessage',
        components: {},
        props: ['item', 'id'],
        emits: ['page-view'],
        data() {
            return {
                View: ViewFuns,
                info: ViewFuns.getJSONType(this),
            }
        },
        methods: {
            /**
             * 构建基础 JSON 消息
             * @param info 卡片信息
             * @param id 消息 ID
             */
            buildJSON(data: any, id: string) {
                try {
                    const info = data.app
                    
                    // 构建简化后的 HTML: [Card] + 预览名 + 描述 + 源地址 + 图片
                    const html = '<span>[Card] ' + info.title + '</span><br>' +
                        '<span>' + info.desc + '</span><br>' +
                        '<span>' + info.url + '</span>' +
                        (info.preview ? '<br><img src="' + info.preview + '" style="max-width: 100%; border-radius: 7px; margin-top: 5px;">' : '')
                    
                    const div = document.createElement('div')
                    div.id = 'json-' + id
                    div.innerHTML = html
                    // 存储链接信息供 cardClick 使用
                    if (info.url) {
                        div.dataset.url = info.url
                    }
                    if (info.urlOpenType) {
                        div.dataset.urlOpenType = info.urlOpenType
                    }

                    // 附加信息
                    if (Object.keys(data.append).length > 0) {
                        for (const key in data.append) {
                            div.dataset[key] = data.append[key]
                        }
                    }
                    return div.outerHTML
                } catch (ex) {
                    return ('<span class="msg-unknown">( ' + app.config.globalProperties.$t('解析消息错误') + ': json )</span>')
                }
            },

            /**
             * 创建高德地图模块
             */
            createMap() {
                const json = JSON.parse(this.item.data)
                window.createMap(import.meta.env.VITE_APP_AMAP_KEY, this.id, {
                    lat: json.meta['Location.Search'].lat,
                    lng: json.meta['Location.Search'].lng,
                })
                return this.info?.app.url
            },
        },
    })
</script>

<style scoped>
    .msg-comp-map {
        cursor: pointer;
    }
    .msg-comp-map > p {
        font-weight: bold;
        margin-bottom: 0;
    }
    .msg-comp-map > span {
        font-size: 0.9rem;
        opacity: 0.7;
    }
    .msg-comp-map > div.map {
        height: 200px;
        border-radius: 7px;
        margin-top: 10px;
        width: 400px;
        max-width: calc(100vw - 150px);
        pointer-events: none;
    }
</style>
