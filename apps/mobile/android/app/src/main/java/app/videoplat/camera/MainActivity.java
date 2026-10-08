package app.videoplat.camera;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NativeMediaPlugin.class);
        super.onCreate(savedInstanceState);
        // WebView transparente para o preview nativo (CameraPreview) aparecer
        // por trás da área central quando o WebView não entrega frames da câmera.
        try {
            android.webkit.WebView wv = getBridge().getWebView();
            if (wv != null) {
                wv.setBackgroundColor(android.graphics.Color.TRANSPARENT);
            }
        } catch (Exception ignored) {
        }
    }
}