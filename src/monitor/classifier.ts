export type SeverityTier = "notable" | "hot" | "viral";

export interface ThresholdConfig {
  youngRepoMaxAgeDays: number;
  youngRepoMinVelocity: number;
  oldRepoMinVelocity: number;
  newRepoMinStars: number;
  hotMultiplier: number;
  viralMultiplier: number;
}

export const THRESHOLD_CONFIG: ThresholdConfig = {
  youngRepoMaxAgeDays: 30,
  youngRepoMinVelocity: 5,
  oldRepoMinVelocity: 10,
  newRepoMinStars: 20,
  hotMultiplier: 3,
  viralMultiplier: 10,
};

export function classifySeverity(
  starsPerDay: number,
  repoAgeDays: number,
  config: ThresholdConfig = THRESHOLD_CONFIG,
): SeverityTier | null {
  const threshold =
    repoAgeDays < config.youngRepoMaxAgeDays
      ? config.youngRepoMinVelocity
      : config.oldRepoMinVelocity;

  if (starsPerDay < threshold) {
    return null;
  }

  if (starsPerDay >= threshold * config.viralMultiplier) {
    return "viral";
  }

  if (starsPerDay >= threshold * config.hotMultiplier) {
    return "hot";
  }

  return "notable";
}

export function shouldAlertNewRepo(
  stars: number,
  config: ThresholdConfig = THRESHOLD_CONFIG,
): boolean {
  return stars >= config.newRepoMinStars;
}
