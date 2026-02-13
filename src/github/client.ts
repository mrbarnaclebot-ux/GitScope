import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import { createLogger } from "../logger.js";

const log = createLogger("github");

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const ThrottledOctokit: typeof Octokit = Octokit.plugin(throttling) as never;

export type GitHubClient = InstanceType<typeof Octokit>;

export function createGitHubClient(token: string): GitHubClient {
  return new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        log.warn(
          {
            method: options.method,
            url: options.url,
            retryAfter,
            retryCount,
          },
          "GitHub rate limit hit",
        );
        if (retryCount < 1) {
          log.info({ retryAfter }, "Retrying after rate limit");
          return true;
        }
        return false;
      },
      onSecondaryRateLimit: (retryAfter, options) => {
        log.warn(
          { method: options.method, url: options.url, retryAfter },
          "GitHub secondary rate limit hit",
        );
        return false;
      },
    },
  });
}
