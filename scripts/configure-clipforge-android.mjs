import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const androidRoot = path.join(root, "android");
const manifestPath = path.join(androidRoot, "app/src/main/AndroidManifest.xml");
const activityPath = path.join(androidRoot, "app/src/main/java/com/wynndev/clipforge/MainActivity.java");
const stylesPath = path.join(androidRoot, "app/src/main/res/values/styles.xml");
const stylesV35Path = path.join(androidRoot, "app/src/main/res/values-v35/styles.xml");
if (!fs.existsSync(manifestPath)) throw new Error("AndroidManifest.xml not found; run Capacitor sync first.");

let manifest = fs.readFileSync(manifestPath, "utf8");
manifest = manifest.replace(/<activity([\s\S]*?)android:name="\.MainActivity"([\s\S]*?)>/, (match) => {
  if (/android:launchMode=/.test(match)) return match.replace(/android:launchMode="[^"]+"/, 'android:launchMode="singleTask"');
  return match.replace('android:name=".MainActivity"', 'android:name=".MainActivity" android:launchMode="singleTask"');
});
fs.writeFileSync(manifestPath, manifest);

fs.mkdirSync(path.dirname(activityPath), { recursive: true });
fs.writeFileSync(activityPath, `package com.wynndev.clipforge;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int STATUS_BAR_COLOR = Color.rgb(7, 16, 34);
    private static final int NAVIGATION_BAR_COLOR = Color.rgb(229, 231, 235);
    private View topSystemBarBackground;
    private View bottomSystemBarBackground;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();
        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(STATUS_BAR_COLOR);
        applySystemBarInsets(webView);
        String ua = webView.getSettings().getUserAgentString();
        if (ua == null) ua = "";
        if (!ua.contains("ClipForge/")) webView.getSettings().setUserAgentString(ua + " ClipForge/" + appVersion());
        webView.addJavascriptInterface(new ClipForgeNativeBridge(), "ClipForgeNative");
    }

    @Override public void onResume() {
        super.onResume();
        configureSystemBars();
        ViewCompat.requestApplyInsets(findViewById(android.R.id.content));
    }

    private String appVersion() {
        try { String version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; return version == null || version.trim().isEmpty() ? "unknown" : version; }
        catch (Exception ignored) { return "unknown"; }
    }

    private void configureSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) getWindow().setNavigationBarDividerColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) { getWindow().setStatusBarContrastEnforced(false); getWindow().setNavigationBarContrastEnforced(false); }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(true);
    }

    private void applySystemBarInsets(WebView webView) {
        FrameLayout content = findViewById(android.R.id.content);
        topSystemBarBackground = new View(this); topSystemBarBackground.setBackgroundColor(STATUS_BAR_COLOR);
        bottomSystemBarBackground = new View(this); bottomSystemBarBackground.setBackgroundColor(NAVIGATION_BAR_COLOR);
        content.addView(topSystemBarBackground, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.TOP));
        content.addView(bottomSystemBarBackground, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.BOTTOM));
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets status = windowInsets.getInsets(WindowInsetsCompat.Type.statusBars());
            Insets navigation = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
            Insets system = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            FrameLayout.LayoutParams top = (FrameLayout.LayoutParams) topSystemBarBackground.getLayoutParams(); top.height = status.top; top.gravity = Gravity.TOP; topSystemBarBackground.setLayoutParams(top);
            FrameLayout.LayoutParams bottom = (FrameLayout.LayoutParams) bottomSystemBarBackground.getLayoutParams(); bottom.height = navigation.bottom; bottom.gravity = Gravity.BOTTOM; bottomSystemBarBackground.setLayoutParams(bottom);
            ViewGroup.LayoutParams raw = webView.getLayoutParams();
            if (raw instanceof ViewGroup.MarginLayoutParams) { ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) raw; params.leftMargin = system.left; params.topMargin = status.top; params.rightMargin = system.right; params.bottomMargin = navigation.bottom; webView.setLayoutParams(params); }
            topSystemBarBackground.bringToFront(); bottomSystemBarBackground.bringToFront();
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(content);
    }

    private boolean isAllowedExternalUrl(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) return false;
        String host = uri.getHost().toLowerCase();
        return host.equals("github.com") || host.endsWith(".github.com") || host.endsWith(".githubusercontent.com");
    }

    public class ClipForgeNativeBridge {
        @JavascriptInterface public String getAppVersion() { return appVersion(); }
        @JavascriptInterface public void openUpdateUrl(String rawUrl) {
            try { Uri uri = Uri.parse(rawUrl); if (!isAllowedExternalUrl(uri)) return; runOnUiThread(() -> { try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {} }); } catch (Exception ignored) {}
        }
        @JavascriptInterface public void downloadFile(String rawUrl, String requestedName) {
            try {
                Uri uri = Uri.parse(rawUrl); if (!"https".equalsIgnoreCase(uri.getScheme())) return;
                String fileName = requestedName == null || requestedName.trim().isEmpty() ? "ClipForge.mp4" : requestedName.replaceAll("[^A-Za-z0-9._-]", "-");
                DownloadManager.Request request = new DownloadManager.Request(uri).setTitle(fileName).setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED).setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName).setAllowedOverMetered(true).setAllowedOverRoaming(true);
                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE); if (manager != null) manager.enqueue(request);
            } catch (Exception ignored) {}
        }
    }
}
`);

function addItemsToStyles(input, items) {
  let styles = input;
  for (const name of ["AppTheme.NoActionBar", "AppTheme.NoActionBarLaunch"]) {
    const re = new RegExp(`(<style\\s+name="${name}"[^>]*>)([\\s\\S]*?)(</style>)`);
    styles = styles.replace(re, (_all, open, body, close) => {
      let next = body;
      for (const [key, value] of items) {
        const escaped = key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
        const itemRe = new RegExp(`<item\\s+name="${escaped}"[^>]*>[\\s\\S]*?<\\/item>`);
        if (itemRe.test(next)) next = next.replace(itemRe, `<item name="${key}">${value}</item>`); else next += `\n        <item name="${key}">${value}</item>`;
      }
      return `${open}${next}${close}`;
    });
  }
  return styles;
}
if (fs.existsSync(stylesPath)) {
  const items = [["android:windowBackground", "#071022"], ["android:statusBarColor", "#071022"], ["android:navigationBarColor", "#E5E7EB"], ["android:windowLightStatusBar", "false"], ["android:windowLightNavigationBar", "true"]];
  const styles = addItemsToStyles(fs.readFileSync(stylesPath, "utf8"), items); fs.writeFileSync(stylesPath, styles);
  fs.mkdirSync(path.dirname(stylesV35Path), { recursive: true }); fs.writeFileSync(stylesV35Path, addItemsToStyles(styles, [["android:windowOptOutEdgeToEdgeEnforcement", "true"]]));
}
console.log("Configured ClipForge Android: native system bars, downloads, and update bridge.");
