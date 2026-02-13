import { readFile, writeFile, rename } from "node:fs/promises";
import type pino from "pino";
import type { AppState } from "./schema.js";
import { EMPTY_STATE, stateSchema } from "./schema.js";

export class StateStore {
  private state: AppState;
  private filePath: string;
  private log: pino.Logger;

  constructor(filePath: string, logger: pino.Logger) {
    this.filePath = filePath;
    this.log = logger;
    this.state = { ...EMPTY_STATE, meta: { ...EMPTY_STATE.meta }, repos: {}, notifications: {} };
  }

  async load(): Promise<void> {
    try {
      const content = await readFile(this.filePath, "utf-8");
      const parsed: unknown = JSON.parse(content);
      const result = stateSchema.safeParse(parsed);

      if (result.success) {
        this.state = result.data;
        this.log.info({ filePath: this.filePath }, "State loaded successfully");
      } else {
        this.log.warn(
          { filePath: this.filePath, issues: result.error.issues },
          "State file has invalid schema, starting with empty state"
        );
        this.state = { ...EMPTY_STATE, meta: { ...EMPTY_STATE.meta }, repos: {}, notifications: {} };
      }
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;

      if (error.code === "ENOENT") {
        this.log.warn(
          { filePath: this.filePath },
          "State file not found, starting with empty state"
        );
      } else {
        this.log.warn(
          { filePath: this.filePath, error: error.message },
          "State file corrupt or unreadable, starting with empty state"
        );
      }

      this.state = { ...EMPTY_STATE, meta: { ...EMPTY_STATE.meta }, repos: {}, notifications: {} };
    }
  }

  async save(): Promise<void> {
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    const content = JSON.stringify(this.state, null, 2);
    await writeFile(tempPath, content, "utf-8");
    await rename(tempPath, this.filePath);
    this.log.debug({ filePath: this.filePath }, "State saved atomically");
  }

  getState(): AppState {
    return this.state;
  }

  updateState(updater: (state: AppState) => void): void {
    updater(this.state);
  }
}
