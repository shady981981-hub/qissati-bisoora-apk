package ps.khanyounis.qissati;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.ValueCallback;
import android.webkit.WebViewClient;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {
    private static final int REQ_RECORD_AUDIO = 101;
    private static final int REQ_STUDIO_IMAGE = 102;
    private ValueCallback<Uri[]> filePathCallback;
    private WebView webView;
    private TextToSpeech tts;
    private volatile boolean arabicTtsReady = false;
    private volatile String currentUtteranceId = null;
    private int utteranceSequence = 0;
    private SpeechRecognizer speechRecognizer;
    private boolean keepListening = false;
    private boolean chatVoiceMode = false;
    private boolean pendingChatVoice = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                Intent pickImage = new Intent(Intent.ACTION_GET_CONTENT);
                pickImage.addCategory(Intent.CATEGORY_OPENABLE);
                pickImage.setType("image/*");
                try {
                    startActivityForResult(Intent.createChooser(pickImage, "اختر صورة"), REQ_STUDIO_IMAGE);
                    return true;
                } catch (Exception e) {
                    filePathCallback.onReceiveValue(null);
                    filePathCallback = null;
                    return false;
                }
            }
        });
        webView.addJavascriptInterface(new QissatiBridge(), "QissatiAndroid");

        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS || tts == null) {
                evalJs("nativeSpeechStatus('⚠️ تَعَذَّرَ تَشْغِيلُ مُحَرِّكِ النُّطْقِ الْعَرَبِيِّ.');");
                return;
            }
            Locale fusha = new Locale("ar", "JO");
            int result = tts.setLanguage(fusha);
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                fusha = new Locale("ar", "SA");
                result = tts.setLanguage(fusha);
            }
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                arabicTtsReady = false;
                evalJs("nativeSpeechStatus('⚠️ بَيَانَاتُ الصَّوْتِ الْعَرَبِيِّ غَيْرُ مُتَوَفِّرَةٍ عَلَى الْجِهَازِ.');");
                return;
            }
            if (tts.getVoices() != null) {
                tts.getVoices().stream()
                    .filter(v -> "ar".equalsIgnoreCase(v.getLocale().getLanguage()))
                    .max(Comparator.comparingInt(v -> {
                        String country = v.getLocale().getCountry();
                        int regional = "JO".equalsIgnoreCase(country) || "LB".equalsIgnoreCase(country) ? 20
                            : "SA".equalsIgnoreCase(country) || "AE".equalsIgnoreCase(country) ? 10 : 0;
                        int offline = v.isNetworkConnectionRequired() ? 0 : 5;
                        return v.getQuality() + regional + offline;
                    }))
                    .ifPresent(tts::setVoice);
            }
            arabicTtsReady = true;
            tts.setSpeechRate(0.80f);
            tts.setPitch(1.0f);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String utteranceId) {
                    if (!utteranceId.equals(currentUtteranceId)) return;
                    evalJs("nativeSpeechStatus('🔊 تَجْرِي الْقِرَاءَةُ الْآنَ.');");
                }
                @Override public void onDone(String utteranceId) {
                    if (!utteranceId.equals(currentUtteranceId)) return;
                    currentUtteranceId = null;
                    evalJs("nativeSpeechFinished();");
                }
                @Override public void onError(String utteranceId) {
                    if (!utteranceId.equals(currentUtteranceId)) return;
                    currentUtteranceId = null;
                    evalJs("nativeSpeechStatus('⚠️ حَدَثَ خَطَأٌ أَثْنَاءَ النُّطْقِ.');");
                }
            });
        });

        webView.loadUrl("file:///android_asset/index.html");
    }

    private void evalJs(String script) {
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript(script, null);
            }
        });
    }

    private String escapeJs(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\n", " ")
                .replace("\r", " ");
    }

    private void initAndStartRecognizer() {
        runOnUiThread(() -> {
            if (!SpeechRecognizer.isRecognitionAvailable(this)) {
                evalJs("voiceNativeError('خدمة التعرف على الصوت غير متوفرة على هذا الجهاز.');");
                return;
            }
            if (speechRecognizer != null) {
                speechRecognizer.destroy();
            }
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
            speechRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {
                    if (chatVoiceMode) {
                        evalJs("chatNativeStatus('🎤 تَحَدَّثْ بِعَرَبِيَّةٍ وَاضِحَةٍ...');");
                    } else {
                        evalJs("voiceNativeStatus('🎤 تَحَدَّثْ الْآنَ بِالْعَرَبِيَّةِ الْفُصْحَى...');");
                    }
                }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onError(int error) {
                    if (chatVoiceMode) {
                        chatVoiceMode = false;
                        keepListening = false;
                        evalJs("chatNativeError('لَمْ أَفْهَمِ الْكَلَامَ؛ حَاوِلْ مَرَّةً أُخْرَى.');");
                        return;
                    }
                    if (keepListening && (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)) {
                        restartListeningLoop();
                    } else {
                        keepListening = false;
                        evalJs("voiceNativeError('تَعَذَّرَ الْتِقَاطُ الصَّوْتِ، حَاوِلْ مَرَّةً أُخْرَى.');");
                    }
                }
                @Override public void onResults(Bundle results) {
                    ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (matches != null && !matches.isEmpty()) {
                        if (chatVoiceMode) {
                            chatVoiceMode = false;
                            keepListening = false;
                            evalJs("chatNativeResult('" + escapeJs(matches.get(0)) + "');");
                        } else {
                            evalJs("voiceNativeResult('" + escapeJs(matches.get(0)) + "');");
                        }
                    }
                    if (keepListening) {
                        restartListeningLoop();
                    }
                }
                @Override public void onPartialResults(Bundle partialResults) {}
                @Override public void onEvent(int eventType, Bundle params) {}
            });
            restartListeningLoop();
        });
    }

    private void restartListeningLoop() {
        if (!keepListening || speechRecognizer == null) return;
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ar-SA");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "ar-SA");
        intent.putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, "ar-SA");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        speechRecognizer.startListening(intent);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_STUDIO_IMAGE) {
            if (filePathCallback != null) {
                Uri[] results = resultCode == RESULT_OK && data != null && data.getData() != null
                    ? new Uri[]{data.getData()} : null;
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_RECORD_AUDIO && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            chatVoiceMode = pendingChatVoice;
            pendingChatVoice = false;
            keepListening = true;
            initAndStartRecognizer();
        } else {
            boolean wasChatRequest = pendingChatVoice;
            pendingChatVoice = false;
            chatVoiceMode = false;
            if (wasChatRequest) {
                evalJs("chatNativeError('يُرْجَى السَّمَاحُ بِإِذْنِ الْمِيكْرُوفُونِ لِلْمُحَادَثَةِ.');");
            } else {
                evalJs("voiceNativeError('يُرْجَى السَّمَاحُ بِإِذْنِ الْمِيكْرُوفُونِ لِلتَّسْجِيلِ الصَّوْتِيِّ.');");
            }
        }
    }

    public class QissatiBridge {
        @JavascriptInterface
        public void speakArabic(String text) {
            runOnUiThread(() -> {
                if (!arabicTtsReady || tts == null) {
                    evalJs("nativeSpeechStatus('⚠️ لَا يَتَوَفَّرُ مُحَرِّكُ نُطْقٍ عَرَبِيٍّ جَاهِزٌ.');");
                    return;
                }
                if (text == null || text.trim().isEmpty()) return;
                String id = "qissati-reader-" + (++utteranceSequence);
                currentUtteranceId = id;
                int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
                if (result == TextToSpeech.ERROR) {
                    currentUtteranceId = null;
                    evalJs("nativeSpeechStatus('⚠️ تَعَذَّرَ بَدْءُ النُّطْقِ الْعَرَبِيِّ.');");
                }
            });
        }

        @JavascriptInterface
        public void stopSpeaking() {
            runOnUiThread(() -> {
                currentUtteranceId = null;
                if (tts != null) tts.stop();
            });
        }

        @JavascriptInterface
        public void startChatVoice() {
            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                pendingChatVoice = true;
                ActivityCompat.requestPermissions(MainActivity.this, new String[]{Manifest.permission.RECORD_AUDIO}, REQ_RECORD_AUDIO);
                return;
            }
            pendingChatVoice = false;
            chatVoiceMode = true;
            keepListening = true;
            initAndStartRecognizer();
        }

        @JavascriptInterface
        public void startVoiceStory() {
            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(MainActivity.this, new String[]{Manifest.permission.RECORD_AUDIO}, REQ_RECORD_AUDIO);
                return;
            }
            keepListening = true;
            initAndStartRecognizer();
        }

        @JavascriptInterface
        public void stopVoiceStory() {
            keepListening = false;
            chatVoiceMode = false;
            pendingChatVoice = false;
            runOnUiThread(() -> {
                if (speechRecognizer != null) {
                    speechRecognizer.stopListening();
                }
                evalJs("voiceNativeStatus('✓ تَمَّ إِيقَافُ التَّسْجِيلِ.');");
            });
        }

        @JavascriptInterface
        public void fetchStoryCatalog(String urlStr) {
            new Thread(() -> {
                try {
                    URL url = new URL(urlStr);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(8000);
                    conn.setReadTimeout(8000);
                    BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                    br.close();
                    evalJs("remoteCatalogResult('" + escapeJs(sb.toString()) + "');");
                } catch (Exception e) {
                    evalJs("remoteCatalogError('تَعَذَّرَ جَلْبُ الْمَكْتَبَةِ السَّحَابِيَّةِ.');");
                }
            }).start();
        }

        @JavascriptInterface
        public void printStory() {
            runOnUiThread(() -> {
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                if (pm != null && webView != null) {
                    PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter("Qissati-Story");
                    pm.print("Qissati-Story", adapter, new PrintAttributes.Builder().build());
                }
            });
        }
    }

    @Override
    protected void onDestroy() {
        keepListening = false;
        if (filePathCallback != null) { filePathCallback.onReceiveValue(null); filePathCallback = null; }
        if (speechRecognizer != null) speechRecognizer.destroy();
        if (tts != null) { tts.stop(); tts.shutdown(); }
        super.onDestroy();
    }
}
