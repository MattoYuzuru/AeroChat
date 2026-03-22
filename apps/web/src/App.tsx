import { AuthProvider } from "./auth/AuthContext";
import { AppRouter } from "./app/AppRouter";
import { CryptoRuntimeProvider } from "./crypto/context";
import { CryptoRealtimeBridge } from "./crypto/realtime-bridge";

function App() {
  return (
    <AuthProvider>
      <CryptoRuntimeProvider>
        <CryptoRealtimeBridge />
        <AppRouter />
      </CryptoRuntimeProvider>
    </AuthProvider>
  );
}

export default App;
