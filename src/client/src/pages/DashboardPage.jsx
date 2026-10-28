import { Link } from 'react-router-dom';
import Card from '../components/ui/Card.jsx';

/**
 * Portal landing page. As new management surfaces are added (parts, exports,
 * OnShape writes), list them here as entry points.
 */
export default function DashboardPage() {
  return (
    <Card title="BOM Portal" icon="⚙">
      <div className="card-body">
        <p className="mb-4 text-light">
          Manage bills of materials across OnShape and Jira — read and write on
          both sides.
        </p>
        <ul className="portal-links">
          <li>
            <Link to="/assembly" className="link-gold">
              Assembly BOM →
            </Link>
            <span className="text-dim"> Sync an OnShape assembly with Jira parts.</span>
          </li>
          <li>
            <Link to="/purchasing" className="link-gold">
              Parts Order →
            </Link>
            <span className="text-dim">
              {' '}Review mentor-approved part orders and hand them to the purchaser.
            </span>
          </li>
          <li>
            <Link to="/receiving" className="link-gold">
              Parts Check-in →
            </Link>
            <span className="text-dim">
              {' '}Receive deliveries and keep Jira in step with the purchaser.
            </span>
          </li>
        </ul>
      </div>
    </Card>
  );
}
