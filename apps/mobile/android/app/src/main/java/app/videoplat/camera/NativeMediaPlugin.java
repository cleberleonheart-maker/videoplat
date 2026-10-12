package app.videoplat.camera;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import androidx.core.content.FileProvider;

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

    /**
     * Copia um arquivo (gravado no cache pelo CameraPreview) para o armazenamento
     * interno do app (getFilesDir) para o WebView conseguir lê-lo depois via
     * @capacitor/filesystem (Directory.Data). Retorna o caminho relativo.
     */
    @PluginMethod
    public void copyToData(PluginCall call) {
        String srcPath = call.getString("srcPath");
        String fileName = call.getString("fileName");
        if (srcPath == null || srcPath.isEmpty()) {
            call.reject("srcPath obrigatório");
            return;
        }
        if (fileName == null || fileName.isEmpty()) {
            call.reject("fileName obrigatório");
            return;
        }
        if (srcPath.startsWith("file://")) {
            srcPath = srcPath.substring("file://".length());
        }
        File src = new File(srcPath);
        if (!src.exists() || !src.isFile()) {
            call.reject("Arquivo de origem não encontrado: " + srcPath);
            return;
        }
        File dir = new File(getContext().getFilesDir(), "capturas");
        if (!dir.exists() && !dir.mkdirs()) {
            call.reject("Não foi possível criar a pasta capturas");
            return;
        }
        File dest = new File(dir, fileName);
        try (FileInputStream in = new FileInputStream(src);
             OutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
        } catch (IOException ex) {
            call.reject("Falha ao copiar arquivo: " + ex.getMessage(), ex);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("path", "capturas/" + fileName);
        call.resolve(ret);
    }

    /**
     * Copia um arquivo persistido (Directory.Data) para o cache (Directory.Cache)
     * direto no lado nativo, sem passar o conteúdo pela WebView — evita estourar
     * memória (OOM) ao salvar/compartilhar vídeos grandes.
     */
    @PluginMethod
    public void copyDataToCache(PluginCall call) {
        String path = call.getString("path");
        String fileName = call.getString("fileName");
        if (path == null || path.isEmpty()) {
            call.reject("path obrigatório");
            return;
        }
        File src = new File(getContext().getFilesDir(), path.replaceFirst("^/+", ""));
        if (!src.exists() || !src.isFile()) {
            call.reject("Arquivo não encontrado: " + src.getAbsolutePath());
            return;
        }
        if (fileName == null || fileName.isEmpty()) {
            fileName = src.getName();
        }
        File dir = new File(getContext().getCacheDir(), "capturas");
        if (!dir.exists() && !dir.mkdirs()) {
            call.reject("Não foi possível criar a pasta de cache");
            return;
        }
        File dest = new File(dir, fileName);
        try (FileInputStream in = new FileInputStream(src);
             OutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
        } catch (IOException ex) {
            call.reject("Falha ao copiar para o cache: " + ex.getMessage(), ex);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("path", "capturas/" + fileName);
        call.resolve(ret);
    }

    /**
     * Lê a rotação (metadado do MP4) e as dimensões brutas de um vídeo. A WebView
     * do Android nem sempre aplica essa rotação ao reproduzir, então o app usa o
     * valor para girar o vídeo e a miniatura corretamente.
     */
    @PluginMethod
    public void getVideoRotation(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path obrigatório");
            return;
        }
        File file;
        if (path.startsWith("file://")) {
            file = new File(path.substring("file://".length()));
        } else if (path.startsWith("/")) {
            file = new File(path);
        } else {
            file = new File(getContext().getFilesDir(), path.replaceFirst("^/+", ""));
        }
        if (!file.exists() || !file.isFile()) {
            call.reject("Arquivo não encontrado: " + file.getAbsolutePath());
            return;
        }
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(file.getAbsolutePath());
            String rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
            String width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
            String height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
            JSObject ret = new JSObject();
            ret.put("rotation", rotation == null ? 0 : Integer.parseInt(rotation));
            ret.put("width", width == null ? 0 : Integer.parseInt(width));
            ret.put("height", height == null ? 0 : Integer.parseInt(height));
            call.resolve(ret);
        } catch (Exception ex) {
            call.reject("Falha ao ler rotação: " + ex.getMessage(), ex);
        } finally {
            try {
                retriever.release();
            } catch (Exception ignored) {
            }
        }
    }

    /**
     * Escreve um arquivo de texto em Downloads/ (pasta pública) para diagnóstico.
     * Sobrescreve o arquivo a cada chamada.
     */
    @PluginMethod
    public void writeSharedText(PluginCall call) {
        String name = call.getString("name", "videoplat-diag.txt");
        String content = call.getString("content", "");
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Sem activity");
            return;
        }
        try {
            byte[] bytes = content.getBytes("UTF-8");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Remove versões anteriores (mesmo nome) para poder sobrescrever.
                try {
                    activity.getContentResolver().delete(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                            MediaStore.MediaColumns.DISPLAY_NAME + "=?",
                            new String[] { name });
                } catch (Exception ignored) {
                }
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, "text/plain");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = activity.getContentResolver().insert(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    call.reject("Falha ao criar arquivo em Download");
                    return;
                }
                OutputStream out = activity.getContentResolver().openOutputStream(uri);
                if (out != null) {
                    out.write(bytes);
                    out.close();
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                activity.getContentResolver().update(uri, done, null, null);
                JSObject ret = new JSObject();
                ret.put("uri", uri.toString());
                call.resolve(ret);
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File out = new File(dir, name);
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    fos.write(bytes);
                }
                JSObject ret = new JSObject();
                ret.put("path", out.getAbsolutePath());
                call.resolve(ret);
            }
        } catch (Exception ex) {
            call.reject("Falha ao escrever diagnóstico: " + ex.getMessage(), ex);
        }
    }

    /**
     * Grava um arquivo binário (base64) em Downloads/ sobrescrevendo o nome.
     * Usado para salvar frames de diagnóstico gerados no canvas do app.
     */
    @PluginMethod
    public void writePng(PluginCall call) {
        String name = call.getString("name", "videoplat-frame.png");
        String b64 = call.getString("data", "");
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Sem activity");
            return;
        }
        try {
            byte[] bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    activity.getContentResolver().delete(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                            MediaStore.MediaColumns.DISPLAY_NAME + "=?",
                            new String[] { name });
                } catch (Exception ignored) {
                }
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, "image/png");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = activity.getContentResolver().insert(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    call.reject("Falha ao criar arquivo em Download");
                    return;
                }
                try (OutputStream out = activity.getContentResolver().openOutputStream(uri)) {
                    if (out != null) {
                        out.write(bytes);
                    }
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                activity.getContentResolver().update(uri, done, null, null);
                call.resolve();
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File out = new File(dir, name);
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    fos.write(bytes);
                }
                call.resolve();
            }
        } catch (Exception ex) {
            call.reject("Falha ao escrever PNG: " + ex.getMessage(), ex);
        }
    }

    /**
     * Verifica se o app tem permissão para instalar APKs (Android O+).
     */
    @PluginMethod
    public void canInstallApk(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Activity activity = getActivity();
            boolean ok = activity != null
                    && activity.getPackageManager().canRequestPackageInstalls();
            ret.put("value", ok);
        } else {
            ret.put("value", true);
        }
        call.resolve(ret);
    }

    /**
     * Abre a tela de configuração para permitir instalar apps desconhecidos.
     */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Sem activity");
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + activity.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
            call.resolve();
        } catch (Exception ex) {
            call.reject("Não foi possível abrir as configurações: " + ex.getMessage(), ex);
        }
    }

    /**
     * Baixa um APK (em thread separada) e abre o instalador do sistema via
     * FileProvider — sem passar pelo navegador.
     */
    @PluginMethod
    public void downloadAndInstall(final PluginCall call) {
        final String url = call.getString("url");
        final Activity activity = getActivity();
        if (url == null || url.isEmpty()) {
            call.reject("url obrigatório");
            return;
        }
        if (activity == null) {
            call.reject("Sem activity");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !activity.getPackageManager().canRequestPackageInstalls()) {
            call.reject("PERMISSAO_INSTALAR");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    File dir = new File(activity.getCacheDir(), "update");
                    if (!dir.exists()) {
                        dir.mkdirs();
                    }
                    File out = new File(dir, "videoplat-update.apk");
                    conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(120000);
                    conn.connect();
                    int code = conn.getResponseCode();
                    if (code >= 400) {
                        call.reject("Download falhou: HTTP " + code);
                        return;
                    }
                    InputStream in = conn.getInputStream();
                    FileOutputStream fos = new FileOutputStream(out);
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    long total = 0;
                    while ((n = in.read(buf)) > 0) {
                        fos.write(buf, 0, n);
                        total += n;
                    }
                    fos.close();
                    in.close();
                    final Uri apkUri = FileProvider.getUriForFile(
                            activity, activity.getPackageName() + ".fileprovider", out);
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                            | Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(intent);
                    JSObject ret = new JSObject();
                    ret.put("size", total);
                    call.resolve(ret);
                } catch (final Exception ex) {
                    call.reject("Falha ao baixar/instalar: " + ex.getMessage(), ex);
                } finally {
                    if (conn != null) {
                        conn.disconnect();
                    }
                }
            }
        }).start();
    }

    /**
     * Abre uma URL no navegador externo do aparelho (usado pelo update checker
     * para levar o usuário ao download do novo APK).
     */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url obrigatório");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception ex) {
            call.reject("Não foi possível abrir o link: " + ex.getMessage(), ex);
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