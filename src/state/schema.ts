import { z } from "zod";

const repoSnapshotSchema = z.object({
  owner: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  topics: z.array(z.string()),
  addedAt: z.string(),
  snapshots: z.array(
    z.object({
      timestamp: z.string(),
      stars: z.number(),
      forks: z.number(),
    })
  ),
});

const notificationRecordSchema = z.object({
  lastAlertAt: z.string(),
});

export const stateSchema = z.object({
  meta: z.object({
    version: z.number(),
    lastCycleAt: z.string().nullable(),
  }),
  repos: z.record(z.string(), repoSnapshotSchema),
  notifications: z.record(z.string(), notificationRecordSchema),
});

export type AppState = z.infer<typeof stateSchema>;

export const EMPTY_STATE: AppState = {
  meta: { version: 1, lastCycleAt: null },
  repos: {},
  notifications: {},
};
