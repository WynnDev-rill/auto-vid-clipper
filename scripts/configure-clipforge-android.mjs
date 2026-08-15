import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const androidRoot = path.join(root, 'android');
const manifestPath = path.join(androidRoot, 'app/src/main/AndroidManifest.xml');
const activityPath = path.join(androidRoot, 'app/src/main/java/com/wynndev/clipforge/MainActivity.java');
const stylesPath = path.join(androidRoot, 'app/src/main/res/values/styles.xml');
const stylesV35Path = path.join(androidRoot, 'app/src/main/res/values-v35/styles.xml');

if (!fs.existsSync(manifestPath)) throw new Error('AndroidManifest.xml not found; run npx cap add/sync android first.');

let manifest = fs.readFileSync(manifestPath, 'utf8');
manifest = manifest.replace(/<activity([\s\S]*?)android:name="\.MainActivity"([\s\S]*?)>/, (match) => {
  let next = match;
  if (/android:launchMode=/.test(next)) next = next.replace(/android:launchMode="[^"]+"/, 'android:launchMode="singleTask"');
  else next = next.replace('android:name=".MainActivity"', 'android:name=".MainActivity" android:launchMode="singleTask"');
  return next;
});

if (!manifest.includes('android:scheme="com.wynndev.clipforge"')) {
  const marker = '</activity>';
  const filter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="com.wynndev.clipforge" android:host="auth" android:pathPrefix="/callback" />
            </intent-filter>
        `;
  manifest = manifest.replace(marker, `${filter}${marker}`);
}
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
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String SUPABASE_HOST = "fxebamfwewsvtscrbwxk.supabase.co";
    private static final int STATUS_BAR_COLOR = Color.rgb(48, 48, 48);
    private static final int NAVIGATION_BAR_COLOR = Color.rgb(229, 231, 235);
    private View topSystemBarBackground;
    private View bottomSystemBarBackground;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();
        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(Color.parseColor("#071022"));
        applySystemBarInsets(webView);
        String ua = webView.getSettings().getUserAgentString();
        if (ua == null) ua = "";
        if (!ua.contains("ClipForge/")) {
            webView.getSettings().setUserAgentString(ua + " ClipForge/" + BuildConfig.VERSION_NAME);
        }
        webView.addJavascriptInterface(new ClipForgeNativeBridge(), "ClipForgeNative");
        handleAuthIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAuthIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        configureSystemBars();
        ViewCompat.requestApplyInsets(findViewById(android.R.id.content));
    }

    private void configureSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) getWindow().setNavigationBarDividerColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(true);
    }

    private void applySystemBarInsets(WebView webView) {
        FrameLayout content = findViewById(android.R.id.content);
        topSystemBarBackground = new View(this);
        topSystemBarBackground.setBackgroundColor(STATUS_BAR_COLOR);
        bottomSystemBarBackground = new View(this);
        bottomSystemBarBackground.setBackgroundColor(NAVIGATION_BAR_COLOR);
        content.addView(topSystemBarBackground, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.TOP));
        content.addView(bottomSystemBarBackground, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.BOTTOM));

        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets status = windowInsets.getInsets(WindowInsetsCompat.Type.statusBars());
            Insets navigation = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
            Insets system = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            FrameLayout.LayoutParams topParams = (FrameLayout.LayoutParams) topSystemBarBackground.getLayoutParams();
            topParams.height = status.top;
            topParams.gravity = Gravity.TOP;
            topSystemBarBackground.setLayoutParams(topParams);
            FrameLayout.LayoutParams bottomParams = (FrameLayout.LayoutParams) bottomSystemBarBackground.getLayoutParams();
            bottomParams.height = navigation.bottom;
            bottomParams.gravity = Gravity.BOTTOM;
            bottomSystemBarBackground.setLayoutParams(bottomParams);
            ViewGroup.LayoutParams rawParams = webView.getLayoutParams();
            if (rawParams instanceof ViewGroup.MarginLayoutParams) {
                ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) rawParams;
                params.leftMargin = system.left;
                params.topMargin = status.top;
                params.rightMargin = system.right;
                params.bottomMargin = navigation.bottom;
                webView.setLayoutParams(params);
            }
            topSystemBarBackground.bringToFront();
            bottomSystemBarBackground.bringToFront();
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(content);
    }

    private boolean isValidOAuthUrl(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme()) && SUPABASE_HOST.equalsIgnoreCase(uri.getHost())
            && uri.getPath() != null && uri.getPath().startsWith("/auth/v1/authorize");
    }

    private boolean isAllowedExternalUrl(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) return false;
        String host = uri.getHost().toLowerCase();
        return host.equals("github.com") || host.endsWith(".github.com") || host.endsWith(".githubusercontent.com");
    }

    private void handleAuthIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null || !"com.wynndev.clipforge".equalsIgnoreCase(data.getScheme()) || !"auth".equalsIgnoreCase(data.getHost())
            || data.getPath() == null || !data.getPath().startsWith("/callback")) return;
        final String raw = data.toString();
        WebView webView = getBridge().getWebView();
        long[] delays = new long[] { 350L, 1000L, 2000L, 3500L };
        for (long delay : delays) {
            webView.postDelayed(() -> {
                String quoted = JSONObject.quote(raw);
                String js = "(function(u){if(window.__clipforgeNativeAuthDelivered===u)return;" +
                    "if(typeof window.__clipforgeCompleteAuth==='function'){window.__clipforgeNativeAuthDelivered=u;window.__clipforgeCompleteAuth(u);}})(" + quoted + ");";
                webView.evaluateJavascript(js, null);
            }, delay);
        }
    }

    public class ClipForgeNativeBridge {
        @JavascriptInterface
        public String getAppVersion() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public void openExternal(String rawUrl) {
            try {
                Uri uri = Uri.parse(rawUrl);
                if (!isValidOAuthUrl(uri)) return;
                runOnUiThread(() -> {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                });
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void openUpdateUrl(String rawUrl) {
            try {
                Uri uri = Uri.parse(rawUrl);
                if (!isAllowedExternalUrl(uri)) return;
                runOnUiThread(() -> {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                });
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void downloadFile(String rawUrl, String requestedName) {
            try {
                Uri uri = Uri.parse(rawUrl);
                if (!"https".equalsIgnoreCase(uri.getScheme())) return;
                String fileName = requestedName == null || requestedName.trim().isEmpty() ? "ClipForge.mp4" : requestedName.replaceAll("[^A-Za-z0-9._-]", "-");
                DownloadManager.Request request = new DownloadManager.Request(uri)
                    .setTitle(fileName)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                    .setAllowedOverMetered(true)
                    .setAllowedOverRoaming(true);
                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (manager != null) manager.enqueue(request);
            } catch (Exception ignored) {}
        }
    }
}
`);

function addItemsToStyles(stylesInput, items) {
  let styles = stylesInput;
  const addItems = (name) => {
    const re = new RegExp(`(<style\\s+name="${name}"[^>]*>)([\\s\\S]*?)(</style>)`);
    styles = styles.replace(re, (_all, open, body, close) => {
      let next = body;
      for (const [key, value] of items) {
        const escaped = key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
        const itemRe = new RegExp(`<item\\s+name="${escaped}"[^>]*>[\\s\\S]*?<\\/item>`);
        if (itemRe.test(next)) next = next.replace(itemRe, `<item name="${key}">${value}</item>`);
        else next += `\n        <item name="${key}">${value}</item>`;
      }
      return `${open}${next}${close}`;
    });
  };
  addItems('AppTheme.NoActionBar');
  addItems('AppTheme.NoActionBarLaunch');
  return styles;
}

if (fs.existsSync(stylesPath)) {
  const barItems = [
    ['android:windowBackground', '#071022'],
    ['android:statusBarColor', '#303030'],
    ['android:navigationBarColor', '#E5E7EB'],
    ['android:windowLightStatusBar', 'false'],
    ['android:windowLightNavigationBar', 'true'],
  ];
  const styles = addItemsToStyles(fs.readFileSync(stylesPath, 'utf8'), barItems);
  fs.writeFileSync(stylesPath, styles);
  fs.mkdirSync(path.dirname(stylesV35Path), { recursive: true });
  const v35 = addItemsToStyles(styles, [['android:windowOptOutEdgeToEdgeEnforcement', 'true']]);
  fs.writeFileSync(stylesV35Path, v35);
}

console.log('Configured ClipForge Android: OAuth, safe system bars, downloads, and version bridge.');
