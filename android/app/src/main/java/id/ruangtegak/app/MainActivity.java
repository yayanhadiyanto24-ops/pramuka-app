package id.ruangtegak.app;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.graphics.Color;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends Activity {
    private WebView webView;
    private String fcmToken = null;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 4102;
    private static final String APP_URL = "https://yayanhadiyanto24-ops.github.io/pramuka-app/";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(91, 55, 17));
        getWindow().setNavigationBarColor(Color.rgb(91, 55, 17));
        getWindow().getDecorView().setSystemUiVisibility(0);
        createNotificationChannel();
        requestNotificationPermission();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                publishFcmTokenToWeb();
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        setContentView(webView);

        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (task.isSuccessful()) {
                fcmToken = task.getResult();
                publishFcmTokenToWeb();
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                "ruang_tegak_admin",
                "Notifikasi Pangkalan Baru",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Pemberitahuan saat pangkalan baru mendaftar");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 350, 180, 350});
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                NOTIFICATION_PERMISSION_REQUEST
            );
        }
    }

    private void publishFcmTokenToWeb() {
        if (webView == null || fcmToken == null) return;
        String safeToken = fcmToken.replace("\\", "\\\\").replace("'", "\\'");
        webView.post(() -> webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('ruangTegakFcmToken',{detail:'" + safeToken + "'}));",
            null
        ));
    }

    @Override
    protected void onResume() {
        super.onResume();
        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> {
            fcmToken = token;
            publishFcmTokenToWeb();
        });
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
