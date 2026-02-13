import type { SeverityTier } from "../monitor/classifier.js";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface AlertData {
  owner: string;
  name: string;
  description: string | null;
  stars: number;
  starsPerDay: number;
  language: string | null;
  repoAgeDays: number;
  tier: SeverityTier;
}

const TIER_EMOJI: Record<SeverityTier, string> = {
  notable: "\u2b50",
  hot: "\ud83d\udd25",
  viral: "\ud83d\ude80",
};

function formatAge(repoAgeDays: number): string {
  if (repoAgeDays < 1) return "< 1 day";
  if (repoAgeDays < 30) return `${Math.floor(repoAgeDays)} days`;
  return `${Math.floor(repoAgeDays / 30)} months`;
}

export function formatAlert(data: AlertData): string {
  const emoji = TIER_EMOJI[data.tier];
  const url = `https://github.com/${data.owner}/${data.name}`;
  const safeOwner = escapeHtml(data.owner);
  const safeName = escapeHtml(data.name);
  const description = data.description
    ? escapeHtml(data.description)
    : "<i>No description</i>";
  const language = data.language ? escapeHtml(data.language) : "N/A";
  const age = formatAge(data.repoAgeDays);

  const lines = [
    `${emoji} <b>[${data.tier.toUpperCase()}]</b> <a href="${url}">${safeOwner}/${safeName}</a>`,
    `Stars: <b>${data.stars}</b> (+${data.starsPerDay.toFixed(1)}/day)`,
    description,
    `Language: ${language} | Age: ${age}`,
  ];

  return lines.join("\n");
}

export function formatNewRepoAlert(
  data: Omit<AlertData, "starsPerDay" | "tier">,
): string {
  const emoji = "\u2728";
  const url = `https://github.com/${data.owner}/${data.name}`;
  const safeOwner = escapeHtml(data.owner);
  const safeName = escapeHtml(data.name);
  const description = data.description
    ? escapeHtml(data.description)
    : "<i>No description</i>";
  const language = data.language ? escapeHtml(data.language) : "N/A";
  const age = formatAge(data.repoAgeDays);

  const lines = [
    `${emoji} <b>[NEW]</b> <a href="${url}">${safeOwner}/${safeName}</a>`,
    `Stars: <b>${data.stars}</b>`,
    description,
    `Language: ${language} | Age: ${age}`,
  ];

  return lines.join("\n");
}
