import type { GitHubClient } from "./client.js";
import { createLogger } from "../logger.js";

const log = createLogger("github:search");

const QUALIFIERS = "in:name,description,topics,readme";
const MAX_OR_OPERATORS = 5; // GitHub Search API limit
const MAX_KEYWORDS_PER_QUERY = MAX_OR_OPERATORS + 1; // 6 keywords = 5 ORs

export function buildSearchQuery(keywords: string[]): string {
  const keywordQuery = keywords
    .map((k) => (k.includes(" ") ? `"${k}"` : k))
    .join(" OR ");
  return `${keywordQuery} ${QUALIFIERS}`;
}

function chunkKeywords(keywords: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < keywords.length; i += MAX_KEYWORDS_PER_QUERY) {
    chunks.push(keywords.slice(i, i + MAX_KEYWORDS_PER_QUERY));
  }
  return chunks;
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
  const chunks = chunkKeywords(keywords);
  const seen = new Set<string>();
  const allResults: SearchResult[] = [];

  for (const chunk of chunks) {
    const query = buildSearchQuery(chunk);

    const { data } = await client.rest.search.repos({
      q: query,
      sort: "updated",
      order: "desc",
      per_page: 100,
    });

    if (data.incomplete_results) {
      log.warn({ chunk }, "GitHub search returned incomplete results");
    }

    log.info(
      { totalCount: data.total_count, returnedCount: data.items.length, chunk },
      "GitHub search batch completed",
    );

    for (const item of data.items) {
      if (!seen.has(item.full_name)) {
        seen.add(item.full_name);
        allResults.push({
          owner: item.owner?.login ?? "",
          name: item.name,
          fullName: item.full_name,
          description: item.description ?? null,
          stars: item.stargazers_count,
          forks: item.forks_count,
          language: item.language ?? null,
          createdAt: item.created_at,
          topics: item.topics ?? [],
        });
      }
    }
  }

  log.info(
    { totalUnique: allResults.length, batches: chunks.length },
    "GitHub search completed",
  );

  return allResults;
}
