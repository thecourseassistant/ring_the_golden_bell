import type {
  AppStateSnapshot,
  BoosterAnalytics,
  BoosterType,
  CompetitionEvent,
  EventAnalytics,
  JudgeSession,
  Participant,
  ParticipantProgression,
  RoundTrendPoint,
  ScoreEvent,
  StageType,
} from '../types.ts';

export const DEFAULT_QUESTION_POINTS = [
  1, 1, 1, 1, 1,
  2, 2, 2, 2, 2,
  3, 3, 3, 3, 3,
  4, 4, 4, 4, 5,
];

export function createDefaultEvent(appsScriptUrl = ''): CompetitionEvent {
  return {
    id: 'evt_sheets',
    name: 'Golden Bell Championship 2026',
    teamCount: 15,
    individualCount: 30,
    questionPoints: [...DEFAULT_QUESTION_POINTS],
    appsScriptUrl,
    createdAt: new Date().toISOString(),
  };
}

export function createDefaultSession(teamCount = 15): JudgeSession {
  return {
    id: `sess_${crypto.randomUUID().slice(0, 10)}`,
    eventId: 'evt_sheets',
    stage: 'team',
    roundNumber: 1,
    selectionSize: teamCount,
    rangeStart: 1,
    rangeEnd: teamCount,
    currentNumber: 1,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
}

export function mergeAllScores(
  syncedScores: ScoreEvent[],
  pendingScores: ScoreEvent[],
  failedScores: ScoreEvent[]
): ScoreEvent[] {
  const byTx = new Map<string, ScoreEvent>();
  for (const s of [...syncedScores, ...failedScores, ...pendingScores]) {
    byTx.set(s.clientTxId, s);
  }
  return Array.from(byTx.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function buildParticipantsFromScores(
  event: CompetitionEvent,
  scores: ScoreEvent[]
): Participant[] {
  const map = new Map<string, Participant>();
  const now = new Date().toISOString();

  for (let i = 1; i <= event.teamCount; i++) {
    map.set(`team:${i}`, {
      id: `p_team_${i}`,
      eventId: event.id,
      stage: 'team',
      participantNumber: i,
      label: `Team ${String(i).padStart(2, '0')}`,
      totalScore: 0,
      correctCount: 0,
      wrongCount: 0,
      bannedRound: null,
      luckyBellUsedRound: null,
      goldenGambleCount: 0,
      updatedAt: now,
    });
  }

  for (let i = 1; i <= event.individualCount; i++) {
    map.set(`individual:${i}`, {
      id: `p_ind_${i}`,
      eventId: event.id,
      stage: 'individual',
      participantNumber: i,
      label: `Player ${String(i).padStart(2, '0')}`,
      totalScore: 0,
      correctCount: 0,
      wrongCount: 0,
      bannedRound: null,
      luckyBellUsedRound: null,
      goldenGambleCount: 0,
      updatedAt: now,
    });
  }

  const ordered = [...scores].sort((a, b) => a.roundNumber - b.roundNumber);
  for (const s of ordered) {
    const p = map.get(`${s.stage}:${s.participantNumber}`);
    if (!p) continue;
    p.totalScore += s.finalDelta;
    if (s.isCorrect) {
      p.correctCount += 1;
      p.bannedRound = null;
    } else {
      p.wrongCount += 1;
      p.bannedRound = s.roundNumber + 1;
    }
    if (s.boosterType === 'lucky_bell') {
      p.luckyBellUsedRound = s.roundNumber;
    }
    if (s.boosterType === 'star_of_hope') {
      p.goldenGambleCount += 1;
    }
    p.updatedAt = s.createdAt || now;
  }

  return Array.from(map.values()).sort(
    (a, b) => a.stage.localeCompare(b.stage) || a.participantNumber - b.participantNumber
  );
}

export function buildAppSnapshot(
  event: CompetitionEvent,
  session: JudgeSession,
  syncedScores: ScoreEvent[],
  pendingScores: ScoreEvent[],
  failedScores: ScoreEvent[]
): AppStateSnapshot {
  const allScores = mergeAllScores(syncedScores, pendingScores, failedScores);
  const participants = buildParticipantsFromScores(event, allScores);
  return {
    event,
    activeSession: session,
    participants,
    recentScores: allScores,
    syncStats: {
      pending: pendingScores.length,
      synced: syncedScores.length,
      failed: failedScores.length,
    },
  };
}

export function validateAndCreateLocalScore(input: {
  event: CompetitionEvent;
  session: JudgeSession;
  participants: Participant[];
  allScores: ScoreEvent[];
  stage: StageType;
  roundNumber: number;
  participantNumber: number;
  isCorrect: boolean;
  useLuckyBell: boolean;
  useGoldenGamble: boolean;
}): ScoreEvent {
  const roundNumber = Math.max(1, Math.min(20, Math.floor(input.roundNumber)));
  const participantNumber = Math.max(1, Math.floor(input.participantNumber));

  const participant = input.participants.find(
    (p) => p.stage === input.stage && p.participantNumber === participantNumber
  );
  if (!participant) {
    throw new Error(`INVALID_PARTICIPANT: #${participantNumber} not found in ${input.stage} stage`);
  }

  if (participant.bannedRound === roundNumber) {
    throw new Error(`BAN_ENFORCED: #${participantNumber} is banned from Question ${roundNumber}`);
  }

  const alreadyScored = input.allScores.some(
    (s) =>
      s.stage === input.stage &&
      s.roundNumber === roundNumber &&
      s.participantNumber === participantNumber
  );
  if (alreadyScored) {
    throw new Error(
      `ALREADY_SCORED: ${input.stage === 'team' ? 'Team' : 'Player'} #${participantNumber} is already scored for Question ${roundNumber}.`
    );
  }

  if (input.useLuckyBell && (roundNumber < 11 || roundNumber > 15)) {
    throw new Error('TAMPER_BLOCKED: Lucky Bell booster is only available in Questions 11–15');
  }
  if (input.useLuckyBell && participant.luckyBellUsedRound !== null) {
    throw new Error('TAMPER_BLOCKED: Lucky Bell can only be applied once per participant');
  }
  if (input.useGoldenGamble && roundNumber < 16) {
    throw new Error('TAMPER_BLOCKED: Star of Hope booster unlocks at Question 16');
  }

  let boosterType: BoosterType = 'none';
  if (input.useGoldenGamble) boosterType = 'star_of_hope';
  else if (input.useLuckyBell) boosterType = 'lucky_bell';

  const qPts = input.event.questionPoints[roundNumber - 1] ?? 1;
  const basePoints = input.isCorrect ? qPts : 0;
  let boosterPoints = 0;
  if (boosterType === 'lucky_bell') boosterPoints = 3;
  else if (boosterType === 'star_of_hope') boosterPoints = input.isCorrect ? 5 : -3;

  const finalDelta = basePoints + boosterPoints;
  const txId = `sc_${crypto.randomUUID().slice(0, 12)}`;

  return {
    id: txId,
    clientTxId: txId,
    eventId: input.event.id,
    sessionId: input.session.id,
    stage: input.stage,
    roundNumber,
    participantNumber,
    isCorrect: input.isCorrect,
    boosterType,
    basePoints,
    boosterPoints,
    finalDelta,
    bannedNextRound: input.isCorrect ? null : roundNumber + 1,
    createdAt: new Date().toISOString(),
  };
}

export function computeEventAnalytics(
  event: CompetitionEvent,
  participants: Participant[],
  scores: ScoreEvent[]
): EventAnalytics {
  const totalEvaluations = scores.length;
  const totalCorrect = scores.filter((s) => s.isCorrect).length;
  const overallAccuracy = totalEvaluations > 0 ? Math.round((totalCorrect / totalEvaluations) * 100) : 0;

  const teamParticipants = participants.filter((p) => p.stage === 'team');
  const indParticipants = participants.filter((p) => p.stage === 'individual');

  const avgScoreTeam =
    teamParticipants.length > 0
      ? Number((teamParticipants.reduce((sum, p) => sum + p.totalScore, 0) / teamParticipants.length).toFixed(1))
      : 0;
  const avgScoreIndividual =
    indParticipants.length > 0
      ? Number((indParticipants.reduce((sum, p) => sum + p.totalScore, 0) / indParticipants.length).toFixed(1))
      : 0;

  const roundMap = new Map<string, ScoreEvent[]>();
  for (const s of scores) {
    const key = `${s.stage}:${s.roundNumber}`;
    const list = roundMap.get(key) || [];
    list.push(s);
    roundMap.set(key, list);
  }

  const roundTrends: RoundTrendPoint[] = Array.from(roundMap.entries())
    .map(([, list]) => {
      const first = list[0];
      const correctCount = list.filter((x) => x.isCorrect).length;
      const wrongCount = list.length - correctCount;
      const avgDelta = Number((list.reduce((sum, x) => sum + x.finalDelta, 0) / list.length).toFixed(2));
      const luckyBellCount = list.filter((x) => x.boosterType === 'lucky_bell').length;
      const goldenGambleCount = list.filter((x) => x.boosterType === 'star_of_hope').length;
      return {
        roundNumber: first.roundNumber,
        stage: first.stage,
        questionPoints: event.questionPoints[first.roundNumber - 1] ?? 1,
        totalEvaluated: list.length,
        correctCount,
        wrongCount,
        accuracyRate: Math.round((correctCount / list.length) * 100),
        avgDelta,
        luckyBellCount,
        goldenGambleCount,
      };
    })
    .sort((a, b) => a.roundNumber - b.roundNumber || a.stage.localeCompare(b.stage));

  let peakRound: number | null = null;
  let peakTotal = -Infinity;
  for (const rt of roundTrends) {
    const roundPoints = rt.avgDelta * rt.totalEvaluated;
    if (roundPoints > peakTotal) {
      peakTotal = roundPoints;
      peakRound = rt.roundNumber;
    }
  }

  const luckyEvents = scores.filter((s) => s.boosterType === 'lucky_bell');
  const gambleEvents = scores.filter((s) => s.boosterType === 'star_of_hope');

  const boosterAnalytics: BoosterAnalytics = {
    luckyBell: {
      usedCount: luckyEvents.length,
      totalBonusPoints: luckyEvents.length * 3,
      correctWithBell: luckyEvents.filter((s) => s.isCorrect).length,
      wrongWithBell: luckyEvents.filter((s) => !s.isCorrect).length,
    },
    goldenGamble: {
      usedCount: gambleEvents.length,
      wins: gambleEvents.filter((s) => s.isCorrect).length,
      losses: gambleEvents.filter((s) => !s.isCorrect).length,
      netImpactPoints: gambleEvents.reduce((sum, s) => sum + (s.isCorrect ? 5 : -3), 0),
    },
  };

  function buildTopProgressions(stage: StageType): ParticipantProgression[] {
    const top = participants
      .filter((p) => p.stage === stage && (p.correctCount > 0 || p.wrongCount > 0))
      .sort((a, b) => b.totalScore - a.totalScore || b.correctCount - a.correctCount)
      .slice(0, 5);

    return top.map((p) => {
      const pScores = scores
        .filter((s) => s.stage === stage && s.participantNumber === p.participantNumber)
        .sort((a, b) => a.roundNumber - b.roundNumber);

      let running = 0;
      const rounds = pScores.map((s) => {
        running += s.finalDelta;
        return {
          roundNumber: s.roundNumber,
          cumulativeScore: running,
          delta: s.finalDelta,
          isCorrect: s.isCorrect,
        };
      });

      return {
        participantNumber: p.participantNumber,
        label: p.label,
        stage,
        finalScore: p.totalScore,
        rounds,
      };
    });
  }

  return {
    summary: {
      totalEvaluations,
      overallAccuracy,
      avgScoreTeam,
      avgScoreIndividual,
      peakRound,
      totalBoostersApplied: luckyEvents.length + gambleEvents.length,
    },
    roundTrends,
    boosterAnalytics,
    topTeamProgressions: buildTopProgressions('team'),
    topIndividualProgressions: buildTopProgressions('individual'),
  };
}

export function downloadScoresCsv(scores: ScoreEvent[]): void {
  const ordered = [...scores].sort(
    (a, b) => a.stage.localeCompare(b.stage) || a.roundNumber - b.roundNumber || a.participantNumber - b.participantNumber
  );

  const headers = [
    'TxID',
    'Timestamp',
    'Stage',
    'QuestionNumber',
    'ParticipantNumber',
    'Result',
    'QuestionPoints',
    'Booster',
    'BoosterPoints',
    'FinalDelta',
    'BannedNextQuestion',
  ];

  const lines = [headers.join(',')];
  for (const s of ordered) {
    lines.push(
      [
        s.clientTxId,
        s.createdAt,
        s.stage,
        s.roundNumber,
        s.participantNumber,
        s.isCorrect ? 'CORRECT' : 'WRONG',
        s.basePoints,
        s.boosterType,
        s.boosterPoints,
        s.finalDelta,
        s.bannedNextRound ?? '',
      ].join(',')
    );
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', 'golden-bell-scores.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
