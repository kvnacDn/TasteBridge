import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Two aggregate counters only. No visitor identifiers or movie preferences.
export const qlooUsage = sqliteTable('qloo_usage', {
  bucket: text('bucket').primaryKey(),
  window: text('window').notNull(),
  used: integer('used').notNull().default(0),
});
