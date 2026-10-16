import Card from "./Card";
import EmptyState from "./EmptyState";
import Skeleton from "./Skeleton";
import { ChartIcon } from "./icons";

/**
 * ChartCard title subtitle [actions] [empty + emptyMessage/emptyDetail] [loading] [height] [footer]
 * Children are rendered inside a fixed-height box so ResponsiveContainer can size itself.
 */
export default function ChartCard({
  title,
  subtitle,
  actions,
  children,
  empty = false,
  emptyMessage = "Nothing to show yet",
  emptyDetail,
  loading = false,
  height = 260,
  footer,
  className = "",
}) {
  return (
    <Card title={title} subtitle={subtitle} actions={actions} className={className}>
      {loading ? (
        <div style={{ height }} role="status" aria-label="Loading chart">
          <Skeleton className="h-full w-full" rounded="rounded-lg" />
        </div>
      ) : empty ? (
        <EmptyState icon={<ChartIcon size={20} />} message={emptyMessage} detail={emptyDetail} compact />
      ) : (
        <div style={{ height }} className="w-full min-w-0">
          {children}
        </div>
      )}
      {footer && !loading && !empty && <div className="mt-3 text-xs text-muted">{footer}</div>}
    </Card>
  );
}
