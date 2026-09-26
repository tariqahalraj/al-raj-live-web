package org.tariqahalraj.live;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQUEST_ALL = 101;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(LiveBackgroundPlugin.class);
        super.onCreate(savedInstanceState);
        
        // Ensure hardware volume keys control media volume stream (STREAM_MUSIC)
        // so pressing volume up/down adjusts media volume and shows the media slider
        setVolumeControlStream(AudioManager.STREAM_MUSIC);

        // Request runtime permissions: RECORD_AUDIO (all Android versions), BLUETOOTH_CONNECT (Android 12+), POST_NOTIFICATIONS (Android 13+)
        List<String> permissionsNeeded = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            permissionsNeeded.add(Manifest.permission.RECORD_AUDIO);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT)
                    != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }
        if (!permissionsNeeded.isEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                permissionsNeeded.toArray(new String[0]),
                PERMISSION_REQUEST_ALL
            );
        }

        // Start background live monitor so listeners receive system alerts outside the app even when closed
        LiveCheckReceiver.startMonitoring(this);
        
        try {
            WebView webView = this.getBridge().getWebView();
            if (webView != null) {
                WebSettings settings = webView.getSettings();
                // Allow media playback without requiring initial touch gesture
                settings.setMediaPlaybackRequiresUserGesture(false);

                // Auto-grant WebRTC microphone permission inside the WebView on UI thread
                webView.setWebChromeClient(new BridgeWebChromeClient(this.getBridge()) {
                    @Override
                    public void onPermissionRequest(final PermissionRequest request) {
                        MainActivity.this.runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                request.grant(request.getResources());
                            }
                        });
                    }
                });
            }
        } catch (Exception ignored) {}
    }
}
