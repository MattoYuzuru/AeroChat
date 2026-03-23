import { AuthProvider } from "./auth/AuthContext";
import { AppRouter } from "./app/AppRouter";
import { CryptoRuntimeProvider } from "./crypto/context";
import { CryptoRealtimeBridge } from "./crypto/realtime-bridge";
import { DirectCallAwarenessProvider } from "./rtc/context";

function App() {
  return (
    <AuthProvider>
      <DirectCallAwarenessProvider>
        <CryptoRuntimeProvider>
          <CryptoRealtimeBridge />
          <AppRouter />
        </CryptoRuntimeProvider>
      </DirectCallAwarenessProvider>
    </AuthProvider>
  );
}

export default App;
