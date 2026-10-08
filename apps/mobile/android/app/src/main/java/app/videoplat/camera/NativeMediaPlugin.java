package app.videoplat.camera;

import android.app.Activity;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * Salva arquivos que já estão no cache do app (gravados via @capacitor/filesystem)
 * na galeria de mídia do aparelho, usando MediaStore. Funciona para fotos e vídeos.
 */
@CapacitorPlugin(name = "NativeMedia")
public class NativeMediaPlugin extends Plugin {

    private static final String STORAGE_PERMISSION = "android.permission.WRITE_EXTERNAL_STORAGE";

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        String filePath = call.getString("filePath");
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "image/jpeg");

        File src;
        String pathLabel;
        if (filePath != null && filePath.startsWith("/")) {
            // caminho absoluto (ex.: vídeo gravado pelo CameraPreview)
            src = new File(filePath);
            pathLabel = filePath;
        } else {
            String relativePath = filePath == null || filePath.isEmpty()
                    ? "capturas/" + fileName
                    : filePath.replaceFirst("^/+", "");
            src = new File(getContext().getCacheDir(), relativePath);
            pathLabel = relativePath;
        }
        if (!src.exists() || !src.isFile()) {
            call.reject("Arquivo não encontrado no cache: " + src.getAbsolutePath());
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Sem activity");
            return;
        }

        // No Android 9 (API 28) ou anterior, publicar mídia exige permissão de armazenamento.
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            boolean granted = activity.checkSelfPermission(STORAGE_PERMISSION)
                    == android.content.pm.PackageManager.PERMISSION_GRANTED;
            if (!granted) {
                call.reject("Permissão de armazenamento negada (necessária no Android 9 ou anterior)");
                return;
            }
        }

        try {
            Uri uri = insertIntoMediaStore(activity, src, fileName, mimeType);
            copyFile(src, uri, activity);
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            ret.put("path", pathLabel);
            call.resolve(ret);
        } catch (IOException ex) {
            call.reject("Falha ao salvar na galeria: " + ex.getMessage(), ex);
        }
    }

    private Uri insertIntoMediaStore(Activity activity, File src, String fileName, String mimeType)
            throws IOException {
        boolean isVideo = mimeType != null && mimeType.startsWith("video/");
        Uri collection;
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        // API 29+: RELATIVE_PATH permite inserir direto na pasta pública de câmera.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                    Environment.DIRECTORY_DCIM + "/Camera");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            collection = isVideo ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        } else {
            collection = isVideo ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                    : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        }
        return activity.getContentResolver().insert(collection, values);
    }

    private void copyFile(File src, Uri dest, Activity activity) throws IOException {
        OutputStream out = activity.getContentResolver().openOutputStream(dest);
        if (out == null) {
            throw new IOException("Não foi possível abrir o destino do MediaStore");
        }
        try (FileInputStream in = new FileInputStream(src)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
        } catch (IOException e) {
            // Em caso de falha, removemos o registro órfão do MediaStore.
            try {
                activity.getContentResolver().delete(dest, null, null);
            } catch (Exception ignored) {
            }
            throw e;
        } finally {
            try {
                out.close();
            } catch (IOException ignored) {
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues pending = new ContentValues();
            pending.put(MediaStore.MediaColumns.IS_PENDING, 0);
            activity.getContentResolver().update(dest, pending, null, null);
        }
    }
}