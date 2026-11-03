package app.stockmock.android;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 앱 안에 있는 플러그인은 super.onCreate 전에 등록
        registerPlugin(FcmSetupPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
