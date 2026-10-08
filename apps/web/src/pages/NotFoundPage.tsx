import { Link } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';

export function NotFoundPage() {
  return (
    <AuthLayout title="Page not found">
      <p>We could not find that page. It may have moved, or the link may be wrong.</p>
      <p>
        <Link to="/">Go to the home page</Link>
      </p>
    </AuthLayout>
  );
}
