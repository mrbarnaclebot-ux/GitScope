import type { GitHubClient } from "./client.js";
import { createLogger } from "../logger.js";

const log = createLogger("github:search");

const QUALIFIERS = "in:name,description,topics,readme";

export function buildSearchQuery(keywords: string[]): string {
  const keywordQuery = keywords
    .map((k) => (k.includes(" ") ? `"${k}"` : k))
    .join(" OR ");
  return `${keywordQuery} ${QUALIFIERS}`;
}

export interface SearchResult {
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  createdAt: string;
  topics: string[];
}

export async function searchRepos(
  client: GitHubClient,
  keywords: string[],
): Promise<SearchResult[]> {
  const query = buildSearchQuery(keywords);

  const { data } = await client.rest.search.repos({
    q: query,
    sort: "updated",
    order: "desc",
    per_page: 100,
  });

  if (data.incomplete_results) {
    log.warn("GitHub search returned incomplete results");
  }

  log.info(
    { totalCount: data.total_count, returnedCount: data.items.length },
    "GitHub search completed",
  );

  return data.items.map((item) => ({
    owner: item.owner?.login ?? "",
    name: item.name,
    fullName: item.full_name,
    description: item.description ?? null,
    stars: item.stargazers_count,
    forks: item.forks_count,
    language: item.language ?? null,
    createdAt: item.created_at,
    topics: item.topics ?? [],
  }));
}
