/**
 * A teaching empty state: a title, at most two sentences, and an action.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.title
 * @param {import('react').ReactNode} [props.children]  The one or two sentences.
 * @param {import('react').ReactNode} [props.action]    Usually one Button or Link.
 * @param {'h1'|'h2'|'h3'} [props.headingLevel]
 */
export default function EmptyState({ title, children, action, headingLevel = 'h2', className = '' }) {
  const Heading = headingLevel;
  return (
    <section className={`empty-state ${className}`}>
      <Heading className="empty-state-title">{title}</Heading>
      {children && <div className="empty-state-text">{children}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </section>
  );
}
