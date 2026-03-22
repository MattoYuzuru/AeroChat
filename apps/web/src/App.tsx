import { AuthProvider } from "./auth/AuthContext";
import { AppRouter } from "./app/AppRouter";
import { CryptoRuntimeProvider } from "./crypto/context";

function App() {
  return (
    <AuthProvider>
      <CryptoRuntimeProvider>
        <AppRouter />
      </CryptoRuntimeProvider>
    </AuthProvider>
  );
}

export default App;
