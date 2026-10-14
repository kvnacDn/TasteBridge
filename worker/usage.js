export const RESERVE_SQL = `INSERT INTO qloo_usage (bucket, window, used) VALUES (?, ?, 1)
ON CONFLICT(bucket) DO UPDATE SET window = excluded.window,
used = CASE WHEN qloo_usage.window = excluded.window THEN qloo_usage.used + 1 ELSE 1 END
WHERE qloo_usage.window <> excluded.window OR qloo_usage.used < ?
RETURNING used`;

export async function reserveQlooRequest(env) {
  if (env.QLOO_USAGE_LIMITS !== 'durable') return;
  if (!env.DB?.prepare || !env.DB?.batch) throw new Error('Usage storage is unavailable.');
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(RESERVE_SQL).bind('day', now.slice(0, 10), 600),
    env.DB.prepare(RESERVE_SQL).bind('minute', now.slice(0, 16), 90)
  ]);
  if (results.some(r => r.success === false)) throw new Error('Usage storage is unavailable.');
  if (results.some(r => !r.results?.length)) {
    const error = new Error('The shared live request budget is temporarily exhausted. Try again later.');
    error.status = 429;
    throw error;
  }
}
