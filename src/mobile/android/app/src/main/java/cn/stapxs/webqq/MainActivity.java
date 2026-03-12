package cn.stapxs.webqq;

import android.os.Bundle;
import android.webkit.WebView;
import android.os.Build;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstance) {
        super.onCreate(savedInstance);
        Bridge bridge = getBridge();
        WebView webView = bridge.getWebView();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        webView.getSettings().setUseWideViewPort(true);
        webView.getSettings().setLoadWithOverviewMode(true);
        webView.getSettings().setSupportZoom(false);
        webView.getSettings().setBuiltInZoomControls(false);
    }
}
