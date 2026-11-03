package app.stockmock.android;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * google-services.json을 넣고 빌드했는지 알려줌.
 * 없이 푸시 등록을 부르면 앱이 꺼져서, 웹 쪽(lib/native.ts)이 먼저 확인함.
 */
@CapacitorPlugin(name = "FcmSetup")
public class FcmSetupPlugin extends Plugin {

    @PluginMethod
    public void available(PluginCall call) {
        // google-services 플러그인이 google_app_id 문자열 리소스를 만들어 줌
        int id = getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName());
        JSObject ret = new JSObject();
        ret.put("available", id != 0);
        call.resolve(ret);
    }
}
