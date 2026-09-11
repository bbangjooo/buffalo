/** Local leaderboard results are client-reported; these types do not imply anti-cheat. */
export interface LeaderboardSubmission {
  runId: string;
  name: string;
  trackId: string;
  perfect: number;
  great: number;
  good: number;
  misses: number;
  maxCombo: number;
}

export interface LeaderboardEntry extends LeaderboardSubmission {
  id: string;
  score: number;
  accuracy: number;
  totalNotes: number;
  createdAt: string;
}

export interface LeaderboardResponse {
  entry: LeaderboardEntry | null;
  /** One-based position against the retained leaderboard, including this run. */
  rank: number;
  saved: boolean;
  duplicate: boolean;
}

export interface LeaderboardListResponse { entries: LeaderboardEntry[]; }
export interface LeaderboardErrorResponse { error: string; }
