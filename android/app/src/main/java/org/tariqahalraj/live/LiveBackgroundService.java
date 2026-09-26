package org.tariqahalraj.live;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class LiveBackgroundService extends Service {
    public static final String CHANNEL_ID = "tariqah_live_session_channel";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_START = "org.tariqahalraj.live.START_LIVE";
    public static final String ACTION_STOP = "org.tariqahalraj.live.STOP_LIVE";
    public static final String EXTRA_TITLE = "extra_title";
    public static final String EXTRA_TEXT = "extra_text";
    public static final String EXTRA_IS_HOST = "extra_is_host";

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private boolean isRunning = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_STOP.equals(action)) {
                stopLiveForeground();
                return START_NOT_STICKY;
            }
        }

        String title = (intent != null && intent.hasExtra(EXTRA_TITLE)) 
                ? intent.getStringExtra(EXTRA_TITLE) 
                : "Tariqah al-Raj Live";
        boolean isHost = intent != null && intent.getBooleanExtra(EXTRA_IS_HOST, false);
        String text = (intent != null && intent.hasExtra(EXTRA_TEXT)) 
                ? intent.getStringExtra(EXTRA_TEXT) 
                : (isHost ? "Broadcasting live audio..." : "Listening to live audio...");

        startLiveForeground(title, text, isHost);
        return START_STICKY;
    }

    private void startLiveForeground(String title, String text, boolean isHost) {
        acquireLocks();

        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                notificationIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .build();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
                if (isHost && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                }
                startForeground(NOTIFICATION_ID, notification, type);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            isRunning = true;
        } catch (Exception e) {
            try {
                startForeground(NOTIFICATION_ID, notification);
                isRunning = true;
            } catch (Exception ignored) {}
        }
    }

    private void stopLiveForeground() {
        releaseLocks();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {}
        isRunning = false;
        stopSelf();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Live Audio Service",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Keeps live broadcast and audio playback active in background");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void acquireLocks() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "TariqahLive::BackgroundAudioLock");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(12 * 60 * 60 * 1000L); // Up to 12 hours
            }
        } catch (Exception ignored) {}

        try {
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "TariqahLive::WifiHighPerfLock");
                    wifiLock.setReferenceCounted(false);
                }
            }
            if (wifiLock != null && !wifiLock.isHeld()) {
                wifiLock.acquire();
            }
        } catch (Exception ignored) {}
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {}

        try {
            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopLiveForeground();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
