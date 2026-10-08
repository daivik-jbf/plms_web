import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function ProtectedRoute() {
  const { state } = useAuth();
  if (state.status === 'loading') return <p role="status">Loading…</p>;
  if (state.status === 'anonymous') return <Navigate to="/login" replace />;
  return <Outlet />;
}
