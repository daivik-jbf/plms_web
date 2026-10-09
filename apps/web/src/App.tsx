import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AdminRoute } from './components/AdminRoute';
import { AppShell } from './components/AppShell';
import { CATEGORIES } from './media/categories';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { DashboardPage } from './pages/DashboardPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { AccountPage } from './pages/account/AccountPage';
import { AuditPage } from './pages/audit/AuditPage';
import { CategoryPage } from './pages/media/CategoryPage';
import { FolderPage } from './pages/media/FolderPage';
import { StaffPage } from './pages/staff/StaffPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          {/* The key gives each category its own page state when moving between, say, Videos and Songs. */}
          {CATEGORIES.map((category) => (
            <Route key={category.slug} path={`/${category.slug}`} element={<CategoryPage key={category.slug} category={category} />} />
          ))}
          {CATEGORIES.map((category) => (
            <Route
              key={`${category.slug}/folder`}
              path={`/${category.slug}/:folderId`}
              element={<FolderPage key={category.slug} category={category} />}
            />
          ))}
          <Route path="/account" element={<AccountPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/audit" element={<AuditPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
