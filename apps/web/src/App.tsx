import { AuthProvider } from "./auth/AuthContext";
import { AppRouter } from "./app/AppRouter";

function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}

export default App;
