// The commit a static export was built from, for out/mimt-release.json: GITHUB_SHA in GitHub Actions,
// SOURCE_COMMIT in Coolify builds (the mimt-web app has "include source commit in build" on).
// Anything that is not a full 40-character SHA is ignored, so the file never claims a wrong revision.
export function releaseCommit(env: Record<string, string | undefined>): string | null {
  for (const value of [env.GITHUB_SHA, env.SOURCE_COMMIT]) {
    const sha = value?.trim().toLowerCase();
    if (sha && /^[0-9a-f]{40}$/.test(sha)) return sha;
  }
  return null;
}
