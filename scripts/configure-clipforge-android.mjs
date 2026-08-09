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
  if (/android:launchMode=/.test(next)) {
    next = next.replace(/android:launchMode="[^"]+"/, 'android:launchMode="singleTask"');
  } else {
    next = next.replace('android:name=".MainActivity"', 'android:name=".MainActivity" android:launchMode="singleTask"');
  }
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

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.view.Window;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String SUPABASE_HOST = "fxebamfwewsvtscrbwxk.supabase.co";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();
        WebView webView = getBridge().getWebView();
        applySystemBarInsets(webView);
        String ua = webView.getSettings().getUserAgentString();
        if (ua == null) ua = "";
        if (!ua.contains("ClipForge/")) {
            webView.getSettings().setUserAgentString(ua + " ClipForge/1.1.2");
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
    }

    private void configureSystemBars() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, true);
        window.setStatusBarColor(Color.parseColor("#303030"));
        window.setNavigationBarColor(Color.parseColor("#E5E7EB"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.setNavigationBarDividerColor(Color.parseColor("#C8CDD5"));
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(true);
            window.setNavigationBarContrastEnforced(true);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(true);
    }

    private void applySystemBarInsets(WebView webView) {
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(webView);
    }

    private boolean isValidOAuthUrl(Uri uri) {
        return uri != null
            && "https".equalsIgnoreCase(uri.getScheme())
            && SUPABASE_HOST.equalsIgnoreCase(uri.getHost())
            && uri.getPath() != null
            && uri.getPath().startsWith("/auth/v1/authorize");
    }

    private void handleAuthIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null
            || !"com.wynndev.clipforge".equalsIgnoreCase(data.getScheme())
            || !"auth".equalsIgnoreCase(data.getHost())
            || data.getPath() == null
            || !data.getPath().startsWith("/callback")) return;

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
        public void openExternal(String rawUrl) {
            try {
                Uri uri = Uri.parse(rawUrl);
                if (!isValidOAuthUrl(uri)) return;
                runOnUiThread(() -> {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) {}
                });
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
    ['android:windowBackground', '#303030'],
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

console.log('Configured ClipForge Android: native OAuth, persistent app shell, and isolated system bars.');
