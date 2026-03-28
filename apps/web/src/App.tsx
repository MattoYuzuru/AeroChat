import { AuthProvider } from "./auth/AuthContext";
import { AppRouter } from "./app/AppRouter";
import { CryptoRuntimeProvider } from "./crypto/context";
import { CryptoRealtimeBridge } from "./crypto/realtime-bridge";
import { WebNotificationsProvider } from "./notifications/context";
import { DirectCallAwarenessProvider } from "./rtc/context";

function App() {
  return (
    <AuthProvider>
      <WebNotificationsProvider>
        <DirectCallAwarenessProvider>
          <CryptoRuntimeProvider>
            <CryptoRealtimeBridge />
            <AppRouter />
          </CryptoRuntimeProvider>
        </DirectCallAwarenessProvider>
      </WebNotificationsProvider>
    </AuthProvider>
  );
}

export default App;
