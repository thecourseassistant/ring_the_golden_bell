export type StageType = 'team' | 'individual';
export type BoosterType = 'none' | 'lucky_bell' | 'star_of_hope';
export type SyncStatus = 'pending' | 'synced' | 'failed';

export interface CompetitionEvent {
  id: string;
  name: string;
  teamCount: number;
  individualCount: number;
  questionPoints: number[]; // Length 20: score for Q1..Q20
  appsScriptUrl: string;
  createdAt: string;
}

export interface Participant {
  id: string;
  eventId: string;
  stage: StageType;
  participantNumber: number;
  label: string;
  totalScore: number;
  correctCount: number;
  wrongCount: number;
  bannedRound: number | null;
  luckyBellUsedRound: number | null;
  goldenGambleCount: number;
  updatedAt: string;
}

export interface JudgeSession {
  id: string;
  eventId: string;
  stage: StageType;
  roundNumber: number; // Question 1..20
  selectionSize: number;
  rangeStart: number;
  rangeEnd: number;
  currentNumber: number;
  status: 'active' | 'completed';
  createdAt: string;
}

export interface ScoreEvent {
  id: string;
  clientTxId: string;
  eventId: string;
  sessionId: string;
  stage: StageType;
  roundNumber: number;
  participantNumber: number;
  isCorrect: boolean;
  boosterType: BoosterType;
  basePoints: number;
  boosterPoints: number;
  finalDelta: number;
  bannedNextRound: number | null;
  createdAt: string;
}

export interface SyncQueueItem {
  id: string;
  scoreEventId: string;
  eventId: string;
  status: SyncStatus;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
  stage?: StageType;
  roundNumber?: number;
  participantNumber?: number;
  finalDelta?: number;
}

export interface RoundTrendPoint {
  roundNumber: number;
  stage: StageType;
  questionPoints: number;
  totalEvaluated: number;
  correctCount: number;
  wrongCount: number;
  accuracyRate: number;
  avgDelta: number;
  luckyBellCount: number;
  goldenGambleCount: number;
}

export interface BoosterAnalytics {
  luckyBell: {
    usedCount: number;
    totalBonusPoints: number;
    correctWithBell: number;
    wrongWithBell: number;
  };
  goldenGamble: {
    usedCount: number;
    wins: number;
    losses: number;
    netImpactPoints: number;
  };
}

export interface ParticipantProgression {
  participantNumber: number;
  label: string;
  stage: StageType;
  finalScore: number;
  rounds: { roundNumber: number; cumulativeScore: number; delta: number; isCorrect: boolean }[];
}

export interface EventAnalytics {
  summary: {
    totalEvaluations: number;
    overallAccuracy: number;
    avgScoreTeam: number;
    avgScoreIndividual: number;
    peakRound: number | null;
    totalBoostersApplied: number;
  };
  roundTrends: RoundTrendPoint[];
  boosterAnalytics: BoosterAnalytics;
  topTeamProgressions: ParticipantProgression[];
  topIndividualProgressions: ParticipantProgression[];
}

export interface AppStateSnapshot {
  event: CompetitionEvent;
  activeSession: JudgeSession;
  participants: Participant[];
  recentScores: ScoreEvent[];
  syncStats: {
    pending: number;
    synced: number;
    failed: number;
  };
}
