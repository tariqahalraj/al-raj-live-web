package org.tariqahalraj.live;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

public class LiveCheckReceiver extends BroadcastReceiver {
    public static final String ACTION_CHECK_LIVE = "org.tariqahalraj.live.CHECK_LIVE";
    public static final String CHANNEL_ID_ALERTS = "tariqah_live_alerts_channel_v2";
    public static final int NOTIFICATION_ID_LIVE_ALERT = 2002;
    private static final String PREFS_NAME = "tariqah_live_prefs";
    private static final String KEY_LAST_NOTIFIED_ID = "last_notified_session_id";

    private static final String SUPABASE_REST_URL = 
        "https://ahvigqmcpdbyjqcuplhu.supabase.co/rest/v1/live_sessions?state=eq.LIVE&select=id,title,state,created_at&limit=1";
    private static final String SUPABASE_ANON_KEY = 
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFodmlncW1jcGRieWpxY3VwbGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTY3OTgsImV4cCI6MjA4NTUzMjc5OH0.fRGQuX2zc7PnssNa8pufWM7KnCXF80hThAJ45KD6nj0";

    private static final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        // Create high-importance alert notification channel
        createNotificationChannel(context);

        // Always schedule next check (interval 25 seconds)
        scheduleNextCheck(context, 25);

        // Acquire partial wake lock for up to 10s to keep CPU awake during network fetch
        android.os.PowerManager pm = (android.os.PowerManager) context.getSystemService(Context.POWER_SERVICE);
        android.os.PowerManager.WakeLock wakeLock = null;
        if (pm != null) {
            wakeLock = pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "TariqahLive:LiveCheckWakeLock");
            wakeLock.acquire(10000L);
        }

        final android.os.PowerManager.WakeLock finalWakeLock = wakeLock;
        executor.execute(() -> {
            try {
                checkSupabaseLive(context);
            } finally {
                if (finalWakeLock != null && finalWakeLock.isHeld()) {
                    try {
                        finalWakeLock.release();
                    } catch (Exception ignored) {}
                }
            }
        });
    }

    public static void startMonitoring(Context context) {
        createNotificationChannel(context);
        scheduleNextCheck(context, 5); // Start first check in 5 seconds
    }

    public static void scheduleNextCheck(Context context, int delaySeconds) {
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am != null) {
                Intent intent = new Intent(context, LiveCheckReceiver.class);
                intent.setAction(ACTION_CHECK_LIVE);
                PendingIntent pi = PendingIntent.getBroadcast(
                    context,
                    0,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );

                long triggerAt = System.currentTimeMillis() + (delaySeconds * 1000L);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    if (am.canScheduleExactAlarms()) {
                        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                    } else {
                        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                    }
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                } else {
                    am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                }
            }
        } catch (SecurityException se) {
            try {
                AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
                if (am != null) {
                    Intent intent = new Intent(context, LiveCheckReceiver.class);
                    intent.setAction(ACTION_CHECK_LIVE);
                    PendingIntent pi = PendingIntent.getBroadcast(
                        context,
                        0,
                        intent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    );
                    long triggerAt = System.currentTimeMillis() + (delaySeconds * 1000L);
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                }
            } catch (Exception ignored) {}
        } catch (Exception ignored) {}
    }

    private static void checkSupabaseLive(Context context) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(SUPABASE_REST_URL);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("apikey", SUPABASE_ANON_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + SUPABASE_ANON_KEY);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);

            int code = conn.getResponseCode();
            if (code == 200) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }
                reader.close();

                JSONArray array = new JSONArray(response.toString());
                SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

                if (array.length() > 0) {
                    JSONObject liveSession = array.getJSONObject(0);
                    String sessionId = liveSession.optString("id", "");
                    String title = liveSession.optString("title", "Tariqah al-Raj Live");
                    String state = liveSession.optString("state", "");

                    String lastNotifiedId = prefs.getString(KEY_LAST_NOTIFIED_ID, "");

                    if ("LIVE".equals(state) && !sessionId.equals(lastNotifiedId)) {
                        // New live session! Post high-priority system notification outside app
                        prefs.edit().putString(KEY_LAST_NOTIFIED_ID, sessionId).apply();
                        showSystemNotification(context, title, "Our Murshid is LIVE now! Tap to listen to the live Zikr.", sessionId);
                    }
                } else {
                    // No live session currently active; clear last notified ID so next session alerts cleanly
                    prefs.edit().remove(KEY_LAST_NOTIFIED_ID).apply();
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    public static void showSystemNotification(Context context, String title, String body, String sessionId) {
        createNotificationChannel(context);

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("open_live", true);
        if (sessionId != null) {
            intent.putExtra("session_id", sessionId);
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID_LIVE_ALERT,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

        String displayTitle = (title != null && !title.isEmpty()) ? "🔴 " + title : "🔴 Tariqah al-Raj Live Now!";
        String displayBody = (body != null && !body.isEmpty()) ? body : "Our Murshid is live. Tap to listen.";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID_ALERTS)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(displayTitle)
            .setContentText(displayBody)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(displayBody))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setSound(soundUri)
            .setVibrate(new long[]{0, 350, 200, 350})
            .setFullScreenIntent(pendingIntent, false)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID_LIVE_ALERT, builder.build());
        }
    }

    public static void createNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID_ALERTS);
                if (channel == null) {
                    channel = new NotificationChannel(
                        CHANNEL_ID_ALERTS,
                        "Live Broadcast Alerts",
                        NotificationManager.IMPORTANCE_HIGH
                    );
                    channel.setDescription("Alerts when a live broadcast starts");
                    channel.enableLights(true);
                    channel.setLightColor(Color.GREEN);
                    channel.enableVibration(true);
                    channel.setVibrationPattern(new long[]{0, 350, 200, 350});
                    channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);

                    Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                    AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
                        .build();
                    channel.setSound(soundUri, audioAttributes);

                    manager.createNotificationChannel(channel);
                }
            }
        }
    }
}
