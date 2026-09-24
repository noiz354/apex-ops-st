import { log } from '../log';

export type JobTopic = 'pm_generator' | 'vendor_notification' | 'webhook_fanout' | 'audit_merkle_batch';
export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED_DLQ';

export interface Job {
  id: string;
  topic: JobTopic;
  organizationId: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

const MAX_JOB_HISTORY = 1000;
const jobs: Job[] = [];

export function enqueueJob(topic: JobTopic, orgId: string, payload: Record<string, unknown>, maxAttempts = 3): Job {
  const id = `job_${crypto.randomUUID()}`;
  const job: Job = { id, topic, organizationId: orgId, payload, status: 'PENDING', attempts: 0, maxAttempts, createdAt: new Date().toISOString(), startedAt: null, completedAt: null, error: null };
  jobs.unshift(job);
  if (jobs.length > MAX_JOB_HISTORY) jobs.pop();
  log('info', 'job_enqueued', { jobId: id, topic, orgId });
  return job;
}

export function listJobs(filter?: { orgId?: string; topic?: JobTopic; status?: JobStatus; limit?: number }): Job[] {
  let list = [...jobs];
  if (filter?.orgId) list = list.filter((j) => j.organizationId === filter.orgId);
  if (filter?.topic) list = list.filter((j) => j.topic === filter.topic);
  if (filter?.status) list = list.filter((j) => j.status === filter.status);
  return list.slice(0, filter?.limit ?? 50);
}

export function retryJob(jobId: string): Job | null {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;
  job.status = 'PENDING';
  job.attempts = 0;
  job.error = null;
  job.startedAt = null;
  job.completedAt = null;
  log('info', 'job_retried_from_dlq', { jobId });
  return job;
}

export async function executeQueueCycle(): Promise<{ processed: number; completed: number; failed: number }> {
  const pendingJobs = jobs.filter((j) => j.status === 'PENDING');
  let completed = 0;
  const failed = 0;
  for (const job of pendingJobs) {
    job.status = 'PROCESSING';
    job.startedAt = new Date().toISOString();
    job.attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 50));
    job.status = 'COMPLETED';
    job.completedAt = new Date().toISOString();
    completed++;
  }
  return { processed: pendingJobs.length, completed, failed };
}
