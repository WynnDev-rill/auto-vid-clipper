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
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
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
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class MainActivity extends BridgeActivity {
    private static final int STATUS_BAR_COLOR = Color.rgb(7, 16, 34);
    private static final int NAVIGATION_BAR_COLOR = Color.rgb(229, 231, 235);
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String SECRET_ALIAS = "clipforge-personal-ai-v4";
    private static final String SECRET_PREFS = "clipforge-secure";
    private View topSystemBarBackground;
    private View bottomSystemBarBackground;
    private final Map<String, File> sourceFiles = new ConcurrentHashMap<>();
    private final Map<String, String> sourceStates = new ConcurrentHashMap<>();
    private final Map<String, OutputStream> outputStreams = new ConcurrentHashMap<>();

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

    private SecretKey secretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE); keyStore.load(null);
        if (keyStore.containsAlias(SECRET_ALIAS)) return (SecretKey) keyStore.getKey(SECRET_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(SECRET_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }

    private boolean storeSecretValue(String name, String value) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, secretKey());
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String payload = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP);
            getSharedPreferences(SECRET_PREFS, MODE_PRIVATE).edit().putString(name, payload).apply(); return true;
        } catch (Exception ignored) { return false; }
    }

    private String readSecretValue(String name) {
        try {
            String payload = getSharedPreferences(SECRET_PREFS, MODE_PRIVATE).getString(name, ""); if (payload == null || !payload.contains(":")) return "";
            String[] parts = payload.split(":", 2); byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP), encrypted = Base64.decode(parts[1], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (Exception ignored) { return ""; }
    }

    private String safeFileName(String requestedName) {
        String value = requestedName == null || requestedName.trim().isEmpty() ? "ClipForge.mp4" : requestedName;
        return value.replaceAll("[^A-Za-z0-9._-]", "-");
    }

    private void downloadSourceAsync(String id, String rawUrl) {
        sourceStates.put(id, "{\\\"status\\\":\\\"downloading\\\"}");
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(rawUrl); if (!"https".equalsIgnoreCase(url.getProtocol())) throw new Exception("Only HTTPS video sources are allowed");
                File target = new File(getCacheDir(), "clipforge-" + id.replaceAll("[^A-Za-z0-9_-]", "") + ".media");
                connection = (HttpURLConnection) url.openConnection(); connection.setInstanceFollowRedirects(true); connection.setConnectTimeout(15000); connection.setReadTimeout(30000); connection.setRequestProperty("User-Agent", "Mozilla/5.0 ClipForge/" + appVersion());
                connection.connect(); int code = connection.getResponseCode(); if (code < 200 || code >= 300) throw new Exception("Video host returned " + code);
                try (java.io.InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(target)) { byte[] buffer = new byte[128 * 1024]; int read; while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read); }
                sourceFiles.put(id, target); sourceStates.put(id, "{\\\"status\\\":\\\"done\\\",\\\"size\\\":" + target.length() + "}");
            } catch (Exception error) { String message = String.valueOf(error.getMessage()).replace("\\", "").replace("\"", "'"); sourceStates.put(id, "{\\\"status\\\":\\\"error\\\",\\\"error\\\":\\\"" + message + "\\\"}"); }
            finally { if (connection != null) connection.disconnect(); }
        }, "ClipForgeSource").start();
    }

    private String beginOutput(String requestedName, String mime) {
        try {
            String token = UUID.randomUUID().toString(), name = safeFileName(requestedName); OutputStream stream;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues(); values.put(MediaStore.Downloads.DISPLAY_NAME, name); values.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime); values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values); if (uri == null) return ""; stream = getContentResolver().openOutputStream(uri); if (stream == null) return ""; outputStreams.put(token, new PendingMediaOutput(stream, uri));
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS); if (!dir.exists()) dir.mkdirs(); stream = new FileOutputStream(new File(dir, name)); outputStreams.put(token, stream);
            }
            return token;
        } catch (Exception ignored) { return ""; }
    }

    private class PendingMediaOutput extends OutputStream {
        final OutputStream inner; final Uri uri; PendingMediaOutput(OutputStream inner, Uri uri) { this.inner = inner; this.uri = uri; }
        @Override public void write(int b) throws java.io.IOException { inner.write(b); }
        @Override public void write(byte[] b, int off, int len) throws java.io.IOException { inner.write(b, off, len); }
        @Override public void close() throws java.io.IOException { inner.close(); if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) { ContentValues values = new ContentValues(); values.put(MediaStore.Downloads.IS_PENDING, 0); getContentResolver().update(uri, values, null, null); } }
    }

    public class ClipForgeNativeBridge {
        @JavascriptInterface public String getAppVersion() { return appVersion(); }
        @JavascriptInterface public boolean storeSecret(String name, String value) { return name != null && value != null && storeSecretValue(name, value); }
        @JavascriptInterface public String getSecret(String name) { return name == null ? "" : readSecretValue(name); }
        @JavascriptInterface public boolean deleteSecret(String name) { if (name == null) return false; getSharedPreferences(SECRET_PREFS, MODE_PRIVATE).edit().remove(name).apply(); return true; }
        @JavascriptInterface public void openUpdateUrl(String rawUrl) {
            try { Uri uri = Uri.parse(rawUrl); if (!isAllowedExternalUrl(uri)) return; runOnUiThread(() -> { try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {} }); } catch (Exception ignored) {}
        }
        @JavascriptInterface public void downloadFile(String rawUrl, String requestedName) {
            try {
                Uri uri = Uri.parse(rawUrl); if (!"https".equalsIgnoreCase(uri.getScheme())) return;
                String fileName = safeFileName(requestedName);
                DownloadManager.Request request = new DownloadManager.Request(uri).setTitle(fileName).setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED).setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName).setAllowedOverMetered(true).setAllowedOverRoaming(true);
                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE); if (manager != null) manager.enqueue(request);
            } catch (Exception ignored) {}
        }
        @JavascriptInterface public boolean downloadSource(String id, String rawUrl) { try { if (id == null || rawUrl == null) return false; downloadSourceAsync(id, rawUrl); return true; } catch (Exception ignored) { return false; } }
        @JavascriptInterface public String getSourceDownloadStatus(String id) { return sourceStates.getOrDefault(id, "{\\\"status\\\":\\\"missing\\\"}"); }
        @JavascriptInterface public String readSourceChunk(String id, int offset, int length) {
            File file = sourceFiles.get(id); if (file == null || !file.exists() || offset < 0 || length <= 0) return "";
            try (RandomAccessFile input = new RandomAccessFile(file, "r")) { input.seek(offset); int count = (int) Math.min(Math.min((long) length, 1024L * 1024L), Math.max(0L, file.length() - offset)); if (count <= 0) return ""; byte[] buffer = new byte[count]; int read = input.read(buffer); return read <= 0 ? "" : Base64.encodeToString(read == buffer.length ? buffer : java.util.Arrays.copyOf(buffer, read), Base64.NO_WRAP); } catch (Exception ignored) { return ""; }
        }
        @JavascriptInterface public boolean cleanupSource(String id) { try { File file = sourceFiles.remove(id); sourceStates.remove(id); return file == null || !file.exists() || file.delete(); } catch (Exception ignored) { return false; } }
        @JavascriptInterface public String beginDownload(String name, String mime) { return beginOutput(name, mime); }
        @JavascriptInterface public boolean appendDownloadChunk(String token, String base64) { OutputStream out = outputStreams.get(token); if (out == null || base64 == null) return false; try { byte[] bytes = Base64.decode(base64, Base64.NO_WRAP); out.write(bytes); return true; } catch (Exception ignored) { return false; } }
        @JavascriptInterface public boolean finishDownload(String token) { OutputStream out = outputStreams.remove(token); if (out == null) return false; try { out.flush(); out.close(); return true; } catch (Exception ignored) { return false; } }
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
console.log("Configured ClipForge Android: native system bars, encrypted AI fallback key, local source transfer, downloads, and update bridge.");
