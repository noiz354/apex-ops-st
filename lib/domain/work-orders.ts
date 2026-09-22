export const WO_STATES = [
  'OPEN', 'SCHEDULED', 'DISPATCHED', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED', 'COMPLETED', 'CANCELLED',
] as const;
export type WoStatus = (typeof WO_STATES)[number];

export const WO_TERMINAL: readonly WoStatus[] = ['COMPLETED', 'CANCELLED'];

export function isTerminal(status: WoStatus): boolean {
  return WO_TERMINAL.includes(status);
}

export const WO_ACTIONS = ['hold', 'escalate', 'resume', 'start', 'complete', 'cancel', 'assign'] as const;
export type WoAction = (typeof WO_ACTIONS)[number];

interface Rule {
  from: readonly WoStatus[];
  to: WoStatus | null;
  requiresReason: boolean;
}

const NON_TERMINAL: readonly WoStatus[] = WO_STATES.filter((s) => !isTerminal(s));

export const WO_RULES: Record<WoAction, Rule> = {
  hold: { from: ['OPEN', 'SCHEDULED', 'DISPATCHED', 'IN_PROGRESS', 'ESCALATED'], to: 'ON_HOLD', requiresReason: true },
  escalate: { from: ['OPEN', 'SCHEDULED', 'DISPATCHED', 'IN_PROGRESS', 'ON_HOLD'], to: 'ESCALATED', requiresReason: true },
  resume: { from: ['ON_HOLD', 'ESCALATED'], to: 'IN_PROGRESS', requiresReason: false },
  start: { from: ['OPEN', 'SCHEDULED', 'DISPATCHED'], to: 'IN_PROGRESS', requiresReason: false },
  complete: { from: ['IN_PROGRESS'], to: 'COMPLETED', requiresReason: false },
  cancel: { from: NON_TERMINAL, to: 'CANCELLED', requiresReason: true },
  assign: { from: NON_TERMINAL, to: null, requiresReason: false },
};

export const WO_LABELS: Record<WoStatus, string> = {
  OPEN: 'OPEN',
  SCHEDULED: 'SCHEDULED',
  DISPATCHED: 'DISPATCHED',
  IN_PROGRESS: 'IN PROGRESS',
  ON_HOLD: 'ON HOLD',
  ESCALATED: 'ESCALATED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

export type TransitionOk = { ok: true; to: WoStatus | null };
export type TransitionErr = { ok: false; code: string; message: string };

export function validateTransition(
  current: WoStatus,
  action: WoAction,
  reason?: string | null,
): TransitionOk | TransitionErr {
  const rule = WO_RULES[action];
  if (!rule) return { ok: false, code: 'WO_UNKNOWN_ACTION', message: `Unknown action '${action}'` };
  if (isTerminal(current)) {
    return { ok: false, code: 'WO_INVALID_TRANSITION', message: `${current} is terminal — no further actions` };
  }
  if (!rule.from.includes(current)) {
    return {
      ok: false,
      code: 'WO_INVALID_TRANSITION',
      message: `Cannot '${action}' from ${WO_LABELS[current]} (allowed from: ${rule.from.map((s) => WO_LABELS[s]).join(', ')})`,
    };
  }
  if (rule.requiresReason && !reason?.trim()) {
    return { ok: false, code: 'WO_REASON_REQUIRED', message: `A reason is required to '${action}' this work order` };
  }
  return { ok: true, to: rule.to };
}

export function slaLabel(dueAt: Date | string | null | undefined, now: Date = new Date()): string {
  if (!dueAt) return '—';
  const due = typeof dueAt === 'string' ? new Date(dueAt) : dueAt;
  const diffMs = due.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const h = String(Math.floor(abs / 3_600_000)).padStart(2, '0');
  const m = String(Math.floor((abs % 3_600_000) / 60_000)).padStart(2, '0');
  const s = String(Math.floor((abs % 60_000) / 1000)).padStart(2, '0');
  if (diffMs < 0) return `\u2212${h}:${m}:${s} BREACH`;
  if (abs >= 3_600_000) return `${h}:${m}:${s} LEFT`;
  return `${Math.floor(abs / 60_000)}m left`;
}

export const SLA_WINDOW_MS: Record<'P1' | 'P2' | 'P3', number> = {
  P1: 4 * 3_600_000,
  P2: 8 * 3_600_000,
  P3: 24 * 3_600_000,
};
