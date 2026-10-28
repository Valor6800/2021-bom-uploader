import { Link } from 'react-router-dom';
import Card from '../components/ui/Card.jsx';

export default function NotFoundPage() {
  return (
    <Card title="Page Not Found" icon="🚫">
      <div className="card-body">
        <p className="mb-4 text-light">
          That page doesn&apos;t exist.
        </p>
        <Link to="/" className="link-gold">← Back to Dashboard</Link>
      </div>
    </Card>
  );
}
