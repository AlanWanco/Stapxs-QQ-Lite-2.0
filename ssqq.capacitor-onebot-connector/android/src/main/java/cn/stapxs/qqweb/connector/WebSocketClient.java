package cn.stapxs.qqweb.connector;

import android.util.Log;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;

import java.net.URL;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public class WebSocketClient {
    private final OkHttpClient client;
    private WebSocket webSocket;

    private final OnebotPlugin plugin;
    private boolean isDeactivated = false;

    private String address;
    private String token;

    public WebSocketClient(OnebotPlugin plugin) {
        this.plugin = plugin;
        client = new OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS) // 保持连接
            .build();
    }

    public void connect(String serverUrl) {
        Request request;
        try {
            request = new Request.Builder()
                .url(serverUrl)
                .build();
        } catch (Exception ex) {
            Log.e("Onebot", "连接失败：" + ex.getMessage());
            closeBack(-1, "连接失败：" + ex.getMessage());
            return;
        }

        try {
            String baseUrl = serverUrl;
            baseUrl = serverUrl.replaceFirst("wss", "https");
            baseUrl = serverUrl.replaceFirst("ws", "http");
            URL url = new URL(baseUrl);
            String query = url.getQuery();
            address = serverUrl.split("\\?")[0];
            if (query != null) {
                String[] params = query.split("&");
                for (String param : params) {
                    String[] keyValue = param.split("=");
                    if (keyValue.length == 2 && keyValue[0].equals("token")) {
                        token = keyValue[1];
                        break;
                    }
                }
            }
        } catch (Exception ex) {
            Log.e("Onebot", "URL 解析失败：" + ex.getMessage());
            closeBack(-1, "URL 解析失败：" + ex.getMessage());
            return;
        }

        webSocket = client.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(
                @NonNull WebSocket webSocket,
                @NonNull Response response) {
                if (isDeactivated) return;
                JSObject ret = new JSObject();
                ret.put("address", address);
                ret.put("token", token);
                plugin.sendNotify("onopen", ret.toString());
            }

            @Override
            public void onMessage(
                @NonNull WebSocket webSocket,
                @NonNull String text) {
                if (isDeactivated) return;
                plugin.sendNotify("onmessage", text);
            }

            @Override
            public void onClosed(
                @NonNull WebSocket webSocket,
                int code, @NonNull String reason) {
                if (isDeactivated) return;
                Log.d("Onebot", "WebSocket已关闭: " + code + " / " + reason);
                closeBack(code, "WebSocket已关闭: " + code + " / " + reason);
            }

            @Override
            public void onFailure(
                @NonNull WebSocket webSocket,
                @NonNull Throwable t, Response response) {
                if (isDeactivated) return;
                Log.d("Onebot", "WebSocket连接失败: " + t.getMessage());
                closeBack(-1, "WebSocket连接失败: " + t.getMessage());
            }
        });
    }

    public void sendMessage(String message) {
        if (webSocket != null) {
            webSocket.send(message);
        } else {
            Log.d("Onebot", "WebSocket未连接，无法发送消息");
        }
    }

    public void close() {
        if (webSocket != null) {
            webSocket.close(1000, "客户端关闭连接");
        }
    }

    public void deactivate() {
        isDeactivated = true;
        close();
    }

    private void closeBack(int code, String error) {
        JSObject ret = new JSObject();
        ret.put("code", code);
        ret.put("message", error);
        ret.put("address", address);
        ret.put("token", token);
        plugin.sendNotify("onclose", ret.toString());
    }
}
