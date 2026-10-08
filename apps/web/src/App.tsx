import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <main>
          <h1>JBF Learning Management System</h1>
        </main>
      </AuthProvider>
    </BrowserRouter>
  );
}
