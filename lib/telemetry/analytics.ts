import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { auditEvents, organizations, workOrders } from '../../db/schema';
import { log } from '../log';

export type FunnelStage = 'signup_completed' | 'user_invited' | 'asset_registered' | 'work_order_dispatched' | 'inspection_submitted' | 'work_order_closed' | 'subscription_upgraded';

export interface AnalyticsEvent {
  stage: FunnelStage;
  organizationId: string;
  userId?: string | null;
  properties?: Record<string, unknown>;
  timestamp: string;
}

export function trackAnalyticsEvent(event: Omit<AnalyticsEvent, 'timestamp'>): AnalyticsEvent {
  const record: AnalyticsEvent = { ...event, timestamp: new Date().toISOString() };
  log('info', 'product_analytics_event', { stage: record.stage, orgId: record.organizationId, userId: record.userId ?? 'system', properties: record.properties ?? {} });
  return record;
}

export interface FunnelMetricsSummary {
  organizationId: string;
  isActivated: boolean;
  activatedAt: string | null;
  funnelCounts: { totalWorkOrdersCreated: number; totalWorkOrdersClosed: number; totalAuditEventsLogged: number };
  conversionRates: { activationRatePct: number; completionVelocityHours: number };
}

export async function getFunnelMetrics(db: Db, orgId: string): Promise<FunnelMetricsSummary> {
  const [org] = await db.select({ id: organizations.id, activatedAt: organizations.activatedAt }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const [woStats] = await db
    .select({ total: sql<number>`count(*)::int`, closed: sql<number>`count(*) filter (where status = 'COMPLETED')::int` })
    .from(workOrders)
    .where(eq(workOrders.organizationId, orgId));
  const [auditStats] = await db.select({ totalEvents: sql<number>`count(*)::int` }).from(auditEvents).where(eq(auditEvents.organizationId, orgId));
  const total = woStats?.total ?? 0;
  const closed = woStats?.closed ?? 0;
  return {
    organizationId: orgId,
    isActivated: Boolean(org?.activatedAt),
    activatedAt: org?.activatedAt ? org.activatedAt.toISOString() : null,
    funnelCounts: { totalWorkOrdersCreated: total, totalWorkOrdersClosed: closed, totalAuditEventsLogged: auditStats?.totalEvents ?? 0 },
    conversionRates: { activationRatePct: total > 0 ? Number(((closed / total) * 100).toFixed(1)) : 0, completionVelocityHours: 0 },
  };
}
