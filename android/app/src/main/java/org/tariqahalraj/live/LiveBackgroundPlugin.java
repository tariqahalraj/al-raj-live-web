package org.tariqahalraj.live;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LiveBackgroundService")
public class LiveBackgroundPlugin extends Plugin {

    @PluginMethod
    public void startLiveService(PluginCall call) {
        try {
            Context context = getContext();
            String title = call.getString("title", "Tariqah al-Raj Live");
            String text = call.getString("text", "Live audio stream is active");
            boolean isHost = Boolean.TRUE.equals(call.getBoolean("isHost", false));

            Intent serviceIntent = new Intent(context, LiveBackgroundService.class);
            serviceIntent.setAction(LiveBackgroundService.ACTION_START);
            serviceIntent.putExtra(LiveBackgroundService.EXTRA_TITLE, title);
            serviceIntent.putExtra(LiveBackgroundService.EXTRA_TEXT, text);
            serviceIntent.putExtra(LiveBackgroundService.EXTRA_IS_HOST, isHost);

            ContextCompat.startForegroundService(context, serviceIntent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to start live background service: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stopLiveService(PluginCall call) {
        try {
            Context context = getContext();
            Intent serviceIntent = new Intent(context, LiveBackgroundService.class);
            serviceIntent.setAction(LiveBackgroundService.ACTION_STOP);
            context.stopService(serviceIntent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to stop live background service: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void triggerLiveAlert(PluginCall call) {
        try {
            Context context = getContext();
            String title = call.getString("title", "🔴 Tariqah al-Raj Live Now!");
            String body = call.getString("body", "Our Murshid is live. Tap to listen.");
            String sessionId = call.getString("sessionId", null);

            LiveCheckReceiver.showSystemNotification(context, title, body, sessionId);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to trigger live alert: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void startLiveMonitoring(PluginCall call) {
        try {
            Context context = getContext();
            LiveCheckReceiver.startMonitoring(context);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to start live monitoring: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void saveAudioRecording(PluginCall call) {
        try {
            Context context = getContext();
            String base64Data = call.getString("base64Data");
            String filename = call.getString("filename", "Tariqah_Live_Recording.webm");
            String mimeType = call.getString("mimeType", "audio/webm");

            if (base64Data == null || base64Data.isEmpty()) {
                call.reject("Missing base64Data");
                return;
            }

            byte[] audioBytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                android.content.ContentValues values = new android.content.ContentValues();
                values.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, filename);
                values.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mimeType);
                values.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS + "/TariqahLive");

                android.net.Uri uri = context.getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri != null) {
                    java.io.OutputStream os = context.getContentResolver().openOutputStream(uri);
                    if (os != null) {
                        os.write(audioBytes);
                        os.flush();
                        os.close();
                    }
                }
            } else {
                java.io.File downloadsDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
                java.io.File targetDir = new java.io.File(downloadsDir, "TariqahLive");
                if (!targetDir.exists()) {
                    targetDir.mkdirs();
                }
                java.io.File targetFile = new java.io.File(targetDir, filename);
                java.io.FileOutputStream fos = new java.io.FileOutputStream(targetFile);
                fos.write(audioBytes);
                fos.flush();
                fos.close();

                android.media.MediaScannerConnection.scanFile(
                    context,
                    new String[]{targetFile.getAbsolutePath()},
                    new String[]{mimeType},
                    null
                );
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("path", "Downloads/TariqahLive/" + filename);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to save recording: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void listSavedRecordings(PluginCall call) {
        try {
            Context context = getContext();
            com.getcapacitor.JSArray recordingsArray = new com.getcapacitor.JSArray();
            java.util.Set<String> seenFilenames = new java.util.HashSet<>();

            // 1. MediaStore check for Downloads/TariqahLive on Android 10+ (Authoritative Scoped Storage registry)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    String[] projection = new String[]{
                        android.provider.MediaStore.MediaColumns._ID,
                        android.provider.MediaStore.MediaColumns.DISPLAY_NAME,
                        android.provider.MediaStore.MediaColumns.SIZE,
                        android.provider.MediaStore.MediaColumns.DATE_MODIFIED,
                        android.provider.MediaStore.MediaColumns.MIME_TYPE,
                        android.provider.MediaStore.MediaColumns.RELATIVE_PATH
                    };
                    String selection = android.provider.MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ?";
                    String[] selectionArgs = new String[]{"%TariqahLive%"};

                    android.database.Cursor cursor = context.getContentResolver().query(
                        android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                        projection,
                        selection,
                        selectionArgs,
                        android.provider.MediaStore.MediaColumns.DATE_MODIFIED + " DESC"
                    );

                    if (cursor != null) {
                        int idCol = cursor.getColumnIndex(android.provider.MediaStore.MediaColumns._ID);
                        int nameCol = cursor.getColumnIndex(android.provider.MediaStore.MediaColumns.DISPLAY_NAME);
                        int sizeCol = cursor.getColumnIndex(android.provider.MediaStore.MediaColumns.SIZE);
                        int dateCol = cursor.getColumnIndex(android.provider.MediaStore.MediaColumns.DATE_MODIFIED);
                        int mimeCol = cursor.getColumnIndex(android.provider.MediaStore.MediaColumns.MIME_TYPE);

                        while (cursor.moveToNext()) {
                            String name = cursor.getString(nameCol);
                            long size = cursor.getLong(sizeCol);

                            // Strict filter: Discard any 0-byte, negative, or duplicate files
                            if (name == null || size <= 0 || seenFilenames.contains(name)) {
                                continue;
                            }

                            long id = cursor.getLong(idCol);
                            long modifiedSec = cursor.getLong(dateCol);
                            String mime = cursor.getString(mimeCol);

                            android.net.Uri contentUri = android.content.ContentUris.withAppendedId(
                                android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                                id
                            );

                            JSObject item = new JSObject();
                            item.put("filename", name);
                            item.put("contentUri", contentUri.toString());
                            item.put("sizeBytes", size);
                            item.put("createdAt", new java.util.Date(modifiedSec * 1000).toString());
                            item.put("timestamp", modifiedSec * 1000);
                            item.put("mimeType", mime != null ? mime : (name.endsWith(".m4a") ? "audio/mp4" : "audio/webm"));
                            recordingsArray.put(item);
                            seenFilenames.add(name);
                        }
                        cursor.close();
                    }
                } catch (Exception msEx) {
                    android.util.Log.w("LiveBackgroundPlugin", "MediaStore query exception: " + msEx.getMessage());
                }
            }

            // 2. Direct File System check in Downloads/TariqahLive (for pre-Q or non-indexed files)
            java.io.File downloadsDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
            java.io.File targetDir = new java.io.File(downloadsDir, "TariqahLive");

            if (targetDir.exists() && targetDir.isDirectory()) {
                java.io.File[] files = targetDir.listFiles();
                if (files != null) {
                    for (java.io.File file : files) {
                        String name = file.getName();
                        long fileSize = file.length();
                        // Never include 0-byte or unreadable files
                        if (file.isFile() && fileSize > 0 && !seenFilenames.contains(name) &&
                            (name.endsWith(".webm") || name.endsWith(".m4a") || name.endsWith(".mp4") || name.endsWith(".wav") || name.endsWith(".aac"))) {
                            seenFilenames.add(name);
                            JSObject item = new JSObject();
                            item.put("filename", name);
                            item.put("path", file.getAbsolutePath());
                            item.put("sizeBytes", fileSize);
                            item.put("createdAt", new java.util.Date(file.lastModified()).toString());
                            item.put("timestamp", file.lastModified());
                            item.put("mimeType", name.endsWith(".m4a") ? "audio/mp4" : "audio/webm");
                            recordingsArray.put(item);
                        }
                    }
                }
            }

            JSObject ret = new JSObject();
            ret.put("recordings", recordingsArray);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to list recordings: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void getRecordingData(PluginCall call) {
        try {
            Context context = getContext();
            String filename = call.getString("filename");
            String path = call.getString("path");
            String contentUriStr = call.getString("contentUri");

            java.io.InputStream is = null;

            if (contentUriStr != null && !contentUriStr.isEmpty()) {
                try {
                    android.net.Uri uri = android.net.Uri.parse(contentUriStr);
                    is = context.getContentResolver().openInputStream(uri);
                } catch (Exception ignored) {}
            }

            if (is == null && path != null && !path.isEmpty()) {
                java.io.File file = new java.io.File(path);
                if (file.exists() && file.canRead()) {
                    is = new java.io.FileInputStream(file);
                }
            }

            if (is == null && filename != null && !filename.isEmpty()) {
                java.io.File downloadsDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
                java.io.File file = new java.io.File(new java.io.File(downloadsDir, "TariqahLive"), filename);
                if (file.exists() && file.canRead()) {
                    is = new java.io.FileInputStream(file);
                }
            }

            if (is == null) {
                call.reject("Recording file could not be opened");
                return;
            }

            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int read;
            while ((read = is.read(buf)) != -1) {
                baos.write(buf, 0, read);
            }
            is.close();

            byte[] bytes = baos.toByteArray();
            String base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
            String mimeType = (filename != null && filename.endsWith(".m4a")) ? "audio/mp4" : "audio/webm";

            JSObject ret = new JSObject();
            ret.put("base64Data", base64);
            ret.put("mimeType", mimeType);
            ret.put("sizeBytes", bytes.length);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read recording: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void deleteRecordingFile(PluginCall call) {
        try {
            Context context = getContext();
            String filename = call.getString("filename");
            String path = call.getString("path");
            String contentUriStr = call.getString("contentUri");
            boolean deleted = false;

            if (contentUriStr != null && !contentUriStr.isEmpty()) {
                try {
                    android.net.Uri uri = android.net.Uri.parse(contentUriStr);
                    deleted = context.getContentResolver().delete(uri, null, null) > 0;
                } catch (Exception ignored) {}
            }

            if (!deleted && path != null && !path.isEmpty()) {
                java.io.File file = new java.io.File(path);
                if (file.exists()) {
                    deleted = file.delete();
                }
            }

            if (!deleted && filename != null && !filename.isEmpty()) {
                java.io.File downloadsDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
                java.io.File file = new java.io.File(new java.io.File(downloadsDir, "TariqahLive"), filename);
                if (file.exists()) {
                    deleted = file.delete();
                }
            }

            JSObject ret = new JSObject();
            ret.put("success", deleted);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to delete recording: " + e.getMessage(), e);
        }
    }
}

