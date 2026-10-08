import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

// The server enforces Admin-only access on every request; this keeps Staff out of pages they cannot use.
export function AdminRoute() {
  const { state } = useAuth();
  if (state.status === 'authenticated' && state.user.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}
