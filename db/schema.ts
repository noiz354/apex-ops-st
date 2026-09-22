import { sql } from 'drizzle-orm';
import {
  pgTable, text, timestamp, integer, bigint, boolean, uuid, jsonb, date,
  uniqueIndex, index, check, primaryKey,
} from 'drizzle-orm/pg-core';


export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  plan: text('plan').notNull().default('ENTERPRISE'),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sequences = pgTable(
  'sequences',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    year: integer('year').notNull(),
    nextVal: integer('next_val').notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.entity, t.year] })],
);


export const ROLES = [
  'Enterprise Admin',
  'Facility Director',
  'Engineering Lead',
  'Senior Field Tech',
  'Vendor Partner Tech',
  'Read-Only Auditor',
] as const;

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name').notNull(),
    initials: text('initials').notNull(),
    title: text('title').notNull().default(''),
    role: text('role').notNull(),
    passwordHash: text('password_hash').notNull(),
    totpSecret: text('totp_secret'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    index('users_org_idx').on(t.organizationId),
    check('users_role_ck', sql`${t.role} IN ('Enterprise Admin','Facility Director','Engineering Lead','Senior Field Tech','Vendor Partner Tech','Read-Only Auditor')`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    idHash: text('id_hash').primaryKey(), // hash only: rows leaked from this table can't be replayed as sessions
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_exp_idx').on(t.expiresAt)],
);

export const mfaChallenges = pgTable(
  'mfa_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [index('mfa_user_idx').on(t.userId)],
);


export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    scope: text('scope').notNull(), // e.g. 'POST /api/work-orders'
    requestHash: text('request_hash').notNull(), // sha256 of canonical request body
    responseStatus: integer('response_status').notNull(),
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.key] })],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    actorName: text('actor_name').notNull().default('system'),
    action: text('action').notNull(), // AUTH_LOGIN, WO_HOLD, WO_CREATE, ...
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    requestId: text('request_id'),
    prevHash: text('prev_hash'),
    entryHash: text('entry_hash'),
  },
  (t) => [index('audit_org_ts_idx').on(t.organizationId, t.ts), index('audit_entity_idx').on(t.organizationId, t.entityType, t.entityId)],
);


export const WO_STATUSES = [
  'OPEN', 'SCHEDULED', 'DISPATCHED', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED', 'COMPLETED', 'CANCELLED',
] as const;
export const WO_PRIORITIES = ['P1', 'P2', 'P3'] as const;

export const assets = pgTable(
  'assets',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    code: text('code').notNull(), // AST-HVAC-004
    name: text('name').notNull(),
    klass: text('klass').notNull(), // HVAC | ELEC | FIRE | ...
    location: text('location').notNull().default(''),
    oem: text('oem').notNull().default(''),
    serial: text('serial').notNull().default(''),
    health: integer('health').notNull().default(100),
    status: text('status').notNull().default('OPERATIONAL'),
    commissionedOn: date('commissioned_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.code] }),
    check('assets_health_ck', sql`${t.health} >= 0 AND ${t.health} <= 100`),
    check('assets_status_ck', sql`${t.status} IN ('OPERATIONAL','DEGRADED','DOWN','RETIRED')`),
  ],
);

export const parts = pgTable(
  'parts',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(), // PART-SEAL-8821
    name: text('name').notNull(),
    unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull(),
    bin: text('bin').notNull().default(''),
    onHand: integer('on_hand').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    minStock: integer('min_stock').notNull().default(0),
    assetCode: text('asset_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.sku] }),
    check('parts_qty_ck', sql`${t.onHand} >= 0 AND ${t.reserved} >= 0 AND ${t.minStock} >= 0`),
  ],
);

export const partMovements = pgTable(
  'part_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    type: text('type').notNull(), // ISSUE | RECEIVE | ADJUST | RESERVE | RELEASE
    qty: integer('qty').notNull(),
    refNumber: text('ref_number'),
    reason: text('reason'),
    actorUserId: uuid('actor_user_id'),
    actorName: text('actor_name').notNull().default('system'),
    stepUpAt: timestamp('step_up_at', { withTimezone: true }),
    requestId: text('request_id'),
    idemHash: text('idem_hash'),
    beforeOnHand: integer('before_on_hand').notNull(),
    afterOnHand: integer('after_on_hand').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('part_movements_type_ck', sql`${t.type} IN ('ISSUE','RECEIVE','ADJUST','RESERVE','RELEASE')`),
    check('part_movements_qty_ck', sql`${t.qty} > 0`),
    index('part_movements_org_ts_idx').on(t.organizationId, t.createdAt),
    index('part_movements_org_sku_idx').on(t.organizationId, t.sku),
  ],
);

export const workOrders = pgTable(
  'work_orders',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    number: text('number').notNull(), // WO-2026-0894
    title: text('title').notNull(),
    assetCode: text('asset_code'), // soft ref to assets.code (same org)
    location: text('location').notNull().default(''),
    priority: text('priority').notNull(),
    status: text('status').notNull().default('OPEN'),
    holdReason: text('hold_reason'),
    slaDueAt: timestamp('sla_due_at', { withTimezone: true }),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    description: text('description'), // free-text scope, typed in on the work-orders/new form
    lotoRequired: boolean('loto_required').notNull().default(false), // false = normal job, no lock-out/tag-out needed
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.number] }),
    index('wo_org_status_idx').on(t.organizationId, t.status),
    index('wo_org_pri_due_idx').on(t.organizationId, t.priority, t.slaDueAt),
    check('wo_priority_ck', sql`${t.priority} IN ('P1','P2','P3')`),
    check('wo_status_ck', sql`${t.status} IN ('OPEN','SCHEDULED','DISPATCHED','IN_PROGRESS','ON_HOLD','ESCALATED','COMPLETED','CANCELLED')`),
    check('wo_number_ck', sql`${t.number} ~ '^WO-[0-9]{4}-[0-9]{4}$'`),
  ],
);

export const workOrderEvents = pgTable(
  'work_order_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    workOrderNumber: text('work_order_number').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    actorName: text('actor_name').notNull().default('system'),
    action: text('action').notNull(), // CREATE | HOLD | ESCALATE | RESUME | START | COMPLETE | CANCEL | ASSIGN
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    reason: text('reason'),
    requestId: text('request_id'),
  },
  (t) => [index('wo_events_org_wo_idx').on(t.organizationId, t.workOrderNumber)],
);

export const SR_STATUSES = ['OPEN', 'TRIAGED', 'CONVERTED', 'CLOSED', 'BREACHED'] as const;

export const serviceRequests = pgTable(
  'service_requests',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    number: text('number').notNull(), // SR-2026-0894
    title: text('title').notNull(),
    requesterName: text('requester_name').notNull().default(''),
    priority: text('priority').notNull().default('P3'),
    status: text('status').notNull().default('OPEN'),
    assetCode: text('asset_code'),
    slaDueAt: timestamp('sla_due_at', { withTimezone: true }),
    convertedWoNumber: text('converted_wo_number'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.number] }),
    check('sr_status_ck', sql`${t.status} IN ('OPEN','TRIAGED','CONVERTED','CLOSED','BREACHED')`),
    check('sr_number_ck', sql`${t.number} ~ '^SR-[0-9]{4}-[0-9]{4}$'`),
  ],
);

export const inspections = pgTable(
  'inspections',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    number: text('number').notNull(), // INS-2026-0412
    title: text('title').notNull(),
    auditorName: text('auditor_name').notNull().default(''),
    progressPct: integer('progress_pct').notNull().default(0),
    status: text('status').notNull().default('IN_PROGRESS'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.number] }),
    check('ins_progress_ck', sql`${t.progressPct} >= 0 AND ${t.progressPct} <= 100`),
    check('ins_number_ck', sql`${t.number} ~ '^INS-[0-9]{4}-[0-9]{4}$'`),
  ],
);

export const findings = pgTable(
  'findings',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    number: text('number').notNull(), // FND-2026-0188
    title: text('title').notNull(),
    severity: text('severity').notNull().default('MAJOR'),
    status: text('status').notNull().default('OPEN'),
    inspectionNumber: text('inspection_number'),
    assetCode: text('asset_code'),
    convertedWoNumber: text('converted_wo_number'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.number] }),
    check('fnd_status_ck', sql`${t.status} IN ('OPEN','CONVERTED','DISMISSED')`),
    check('fnd_number_ck', sql`${t.number} ~ '^FND-[0-9]{4}-[0-9]{4}$'`),
  ],
);


export const vendors = pgTable(
  'vendors',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(), // trane-technologies
    name: text('name').notNull(),
    tier: text('tier').notNull().default('TIER-2'),
    msaNumber: text('msa_number'),
    msaExpiresOn: date('msa_expires_on'),
    onTimePct: integer('on_time_pct'), // basis: 0..100 integer percent
    scope: text('scope'), // which line of business this request belongs to
    contact: text('contact'), // display contact person / desk
    phone: text('phone'), // dispatch line (display only — no telephony)
    duns: text('duns'), // D&B format ##-###-#### (format-checked only)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.slug] })],
);


export const facilities = pgTable(
  'facilities',
  {
    id: uuid('id').notNull().defaultRandom(), // opaque server id
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    code: text('code').notNull(), // org-unique: B2-MECH-204
    name: text('name').notNull(),
    geojson: text('geojson'), // raw GeoJSON geometry/feature JSON; null = unmapped
    meta: text('meta'), // JSON blob: staged defects/transfers (see comment above)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.code] }),
    uniqueIndex('facilities_id_uq').on(t.id),
  ],
);


export const settingsKv = pgTable(
  'settings_kv',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(), // dot-hierarchy: general.profile, integrations.broker, ops.maint_mode
    kind: text('kind').notNull().default('value'), // value | secret
    value: text('value').notNull(), // JSON-encoded value | sha256 hash (secret)
    last4: text('last4'), // secret display hint only
    updatedBy: text('updated_by').notNull(), // actor display name
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.key] })],
);


export const HANDOVER_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];

export const handovers = pgTable(
  'handovers',
  {
    id: uuid('id').notNull().defaultRandom(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    shiftFrom: text('shift_from').notNull(),
    shiftTo: text('shift_to').notNull(),
    leadFrom: text('lead_from').notNull(),
    leadTo: text('lead_to').notNull(),
    woRef: text('wo_ref'), // bound WO when initiated from a WO context (e.g. canonical seal WO)
    items: text('items').notNull().default(''),
    notes: text('notes').notNull().default(''),
    status: text('status').notNull().default('PENDING'), // HANDOVER_STATUSES
    rejectReason: text('reject_reason'), // REQUIRED when status=REJECTED; cleared/null otherwise
    decidedBy: text('decided_by'), // actor who made the terminal decision
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    index('handovers_org_status_idx').on(t.organizationId, t.status),
  ],
);

export const PO_STATUSES = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'DISPATCHED', 'PARTIAL', 'RECEIVED', 'REJECTED', 'CLOSED',
] as const;

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    number: text('number').notNull(), // PO-2026-0298 | PR-2026-0314
    kind: text('kind').notNull().default('PO'), // PO | PR
    title: text('title').notNull(),
    vendorSlug: text('vendor_slug'),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull().default(0),
    status: text('status').notNull().default('DRAFT'),
    slaDueAt: timestamp('sla_due_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.number] }),
    check('po_kind_ck', sql`${t.kind} IN ('PO','PR')`),
    check('po_status_ck', sql`${t.status} IN ('DRAFT','PENDING_APPROVAL','APPROVED','CONVERTED','DISPATCHED','PARTIAL','RECEIVED','REJECTED','CLOSED')`),
    check('po_number_ck', sql`${t.number} ~ '^(PO|PR)-[0-9]{4}-[0-9]{4}$'`),
  ],
);

export const WO_TASK_STATUSES = ['LOCKED', 'PENDING', 'IN_PROGRESS', 'DONE'] as const;

export const woTasks = pgTable(
  'wo_tasks',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    workOrderNumber: text('work_order_number').notNull(),
    stepOrder: integer('step_order').notNull(),
    title: text('title').notNull(),
    instruction: text('instruction').notNull().default(''),
    status: text('status').notNull().default('PENDING'),
    requiresPhoto: boolean('requires_photo').notNull().default(false),
    verifiedBy: text('verified_by'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    index('wo_tasks_wo_idx').on(t.organizationId, t.workOrderNumber),
    check('wo_tasks_status_ck', sql`${t.status} IN ('LOCKED','PENDING','IN_PROGRESS','DONE')`),
  ],
);

export const evidence = pgTable(
  'evidence',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    workOrderNumber: text('work_order_number').notNull(),
    taskId: text('task_id'),
    fileName: text('file_name').notNull(),
    filePath: text('file_path').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull(),
    sha256Hash: text('sha256_hash').notNull(),
    uploadedBy: text('uploaded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    index('evidence_wo_idx').on(t.organizationId, t.workOrderNumber),
  ],
);

export const poLineItems = pgTable(
  'po_line_items',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    documentNumber: text('document_number').notNull(), // PO-2026-0298 or PR-2026-0314
    sku: text('sku').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    index('po_lines_doc_idx').on(t.organizationId, t.documentNumber),
    check('po_line_qty_ck', sql`${t.quantity} > 0`),
  ],
);

export const goodsReceiptNotes = pgTable(
  'goods_receipt_notes',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    number: text('number').notNull(), // GRN-9941
    poNumber: text('po_number').notNull(),
    waybill: text('waybill').notNull().default(''),
    dockLocation: text('dock_location').notNull().default('Dock Bay 02'),
    skuReceived: text('sku_received'), // nullable: GRNs recorded before we started capturing quantities
    qtyReceived: integer('qty_received'), // nullable: GRNs recorded before we started capturing quantities
    status: text('status').notNull().default('RECEIVED'),
    verifiedBy: text('verified_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.number] }),
    index('grn_po_idx').on(t.organizationId, t.poNumber),
    check('grn_status_ck', sql`${t.status} IN ('RECEIVED','DISPUTED')`),
    check('grn_qty_ck', sql`${t.qtyReceived} IS NULL OR ${t.qtyReceived} > 0`),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    number: text('number').notNull(), // INV-2026-1188
    poNumber: text('po_number').notNull(),
    vendorSlug: text('vendor_slug').notNull().default(''),
    invoiceDate: date('invoice_date').notNull(),
    dueDate: date('due_date'),
    paymentTerms: text('payment_terms').notNull().default('NET_30'),
    status: text('status').notNull().default('PENDING'), // PENDING | MATCHED | DISPUTED
    paymentHold: boolean('payment_hold').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.number] }),
    index('invoices_po_idx').on(t.organizationId, t.poNumber),
    check('inv_number_ck', sql`${t.number} ~ '^INV-[0-9]{4}-[0-9]{4}$'`),
    check('inv_status_ck', sql`${t.status} IN ('PENDING','MATCHED','DISPUTED')`),
  ],
);

export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    id: text('id').notNull(), // `${invoiceNumber}-L${n}`
    invoiceNumber: text('invoice_number').notNull(),
    sku: text('sku').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    index('inv_lines_inv_idx').on(t.organizationId, t.invoiceNumber),
    check('inv_line_qty_ck', sql`${t.quantity} > 0`),
  ],
);

export const pmRules = pgTable(
  'pm_rules',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    id: text('id').notNull(), // PM-CHL-001
    title: text('title').notNull(),
    assetCode: text('asset_code').notNull(),
    intervalDays: integer('interval_days').notNull().default(90),
    priority: text('priority').notNull().default('P2'),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | PAUSED
    lastGeneratedAt: timestamp('last_generated_at', { withTimezone: true }),
    nextDueAt: timestamp('next_due_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    index('pm_rules_asset_idx').on(t.organizationId, t.assetCode),
    check('pm_rules_status_ck', sql`${t.status} IN ('ACTIVE','PAUSED')`),
    check('pm_rules_priority_ck', sql`${t.priority} IN ('P1','P2','P3')`),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    organizationId: text('organization_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    plan: text('plan').notNull().default('COMMUNITY'), // COMMUNITY | GROWTH | ENTERPRISE — new orgs start free, upgrades only via billing webhook
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | TRIALING | PAST_DUE | CANCELED
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('sub_plan_ck', sql`${t.plan} IN ('COMMUNITY','GROWTH','ENTERPRISE')`),
    check('sub_status_ck', sql`${t.status} IN ('ACTIVE','TRIALING','PAST_DUE','CANCELED')`),
  ],
);

export const sensorReadings = pgTable(
  'sensor_readings',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    assetCode: text('asset_code').notNull(),
    sensorType: text('sensor_type').notNull(), // VIBRATION | TEMPERATURE | REFRIGERANT_PPM | VOLTAGE_KV | PRESSURE_PSI
    value: text('value').notNull(),
    unit: text('unit').notNull(),
    status: text('status').notNull().default('NORMAL'), // NORMAL | WARNING | CRITICAL
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sensor_readings_asset_idx').on(t.organizationId, t.assetCode, t.recordedAt),
    check('sensor_status_ck', sql`${t.status} IN ('NORMAL','WARNING','CRITICAL')`),
  ],
);

export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull().default(1),
    resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
  },
);


export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('push_sub_endpoint_uq').on(t.endpoint),
    index('push_sub_user_idx').on(t.userId, t.organizationId),
  ],
);

export const webauthnCredentials = pgTable(
  'webauthn_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull(),
    publicKey: text('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: text('transports'), // comma-separated: 'internal', 'usb', 'nfc'...
    aaguid: text('aaguid'),
    friendlyName: text('friendly_name').notNull().default('Passkey'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('webauthn_cred_id_uq').on(t.credentialId),
    index('webauthn_user_idx').on(t.userId, t.organizationId),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    id: text('id').notNull(), // AK-2026-0001…
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    last4: text('last4').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    uniqueIndex('api_keys_hash_uq').on(t.keyHash),
    index('api_keys_org_idx').on(t.organizationId, t.createdAt),
  ],
);






