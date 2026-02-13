export interface VelocityResult {
  starsPerDay: number;
  isNew: boolean;
  repoAgeDays: number;
  currentStars: number;
  previousStars: number;
}

export function calculateVelocity(
  currentStars: number,
  createdAt: string,
  lastSnapshot: { stars: number; timestamp: string } | null,
  now: Date = new Date(),
): VelocityResult {
  const createdDate = new Date(createdAt);
  const repoAgeDays =
    (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

  if (lastSnapshot === null) {
    // First sighting -- cannot calculate velocity without a previous snapshot
    return {
      starsPerDay: 0,
      isNew: true,
      repoAgeDays,
      currentStars,
      previousStars: 0,
    };
  }

  const hoursSinceSnapshot =
    (now.getTime() - new Date(lastSnapshot.timestamp).getTime()) /
    (1000 * 60 * 60);

  // Guard against division by near-zero time intervals
  if (hoursSinceSnapshot < 0.1) {
    return {
      starsPerDay: 0,
      isNew: false,
      repoAgeDays,
      currentStars,
      previousStars: lastSnapshot.stars,
    };
  }

  const starsPerDay =
    ((currentStars - lastSnapshot.stars) / hoursSinceSnapshot) * 24;

  return {
    starsPerDay,
    isNew: false,
    repoAgeDays,
    currentStars,
    previousStars: lastSnapshot.stars,
  };
}
