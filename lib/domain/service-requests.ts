
export const SR_STATES = ['OPEN', 'TRIAGED', 'CONVERTED', 'CLOSED', 'BREACHED'] as const;
export type SrStatus = (typeof SR_STATES)[number];

export const SR_TERMINAL: readonly SrStatus[] = ['CONVERTED', 'CLOSED'];

export function isSrTerminal(status: SrStatus): boolean {
  return SR_TERMINAL.includes(status);
}

export const SR_ACTIONS = ['triage', 'convert', 'close'] as const;
export type SrAction = (typeof SR_ACTIONS)[number];

interface Rule {
  from: readonly SrStatus[];
  to: SrStatus | null;
  requiresReason?: boolean;
}

export const SR_RULES: Record<SrAction, Rule> = {
  triage: { from: ['OPEN', 'BREACHED'], to: 'TRIAGED' },
  convert: { from: ['OPEN', 'TRIAGED', 'BREACHED'], to: 'CONVERTED' },
  close: { from: ['OPEN', 'TRIAGED', 'BREACHED'], to: 'CLOSED', requiresReason: true },
};

export const SR_LABELS: Record<SrStatus, string> = {
  OPEN: 'OPEN',
  TRIAGED: 'TRIAGED',
  CONVERTED: 'CONVERTED',
  CLOSED: 'CLOSED',
  BREACHED: 'BREACHED',
};

export type SrTransitionOk = { ok: true; to: SrStatus | null };
export type SrTransitionErr = { ok: false; code: string; message: string };

export function validateSrTransition(
  current: SrStatus,
  action: SrAction,
  reason?: string | null,
): SrTransitionOk | SrTransitionErr {
  const rule = SR_RULES[action];
  if (!rule) return { ok: false, code: 'SR_UNKNOWN_ACTION', message: `Unknown action '${action}'` };
  if (isSrTerminal(current)) {
    return {
      ok: false,
      code: 'SR_INVALID_TRANSITION',
      message: current === 'CONVERTED'
        ? `Already converted — a service request converts to a work order exactly once`
        : `${current} is terminal — no further actions`,
    };
  }
  if (!rule.from.includes(current)) {
    return {
      ok: false,
      code: 'SR_INVALID_TRANSITION',
      message: `Cannot '${action}' from ${SR_LABELS[current]} (allowed from: ${rule.from.map((s) => SR_LABELS[s]).join(', ')})`,
    };
  }
  if (rule.requiresReason && !reason?.trim()) {
    return { ok: false, code: 'SR_REASON_REQUIRED', message: `A reason is required to '${action}' this service request` };
  }
  return { ok: true, to: rule.to };
}

export const SR_SLA_WINDOW_MS: Record<'P1' | 'P2' | 'P3', number> = {
  P1: 15 * 60_000,
  P2: 45 * 60_000,
  P3: 2 * 3_600_000,
};
