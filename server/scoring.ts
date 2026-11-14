import crypto from 'crypto';
import { db, DEFAULT_QUESTION_POINTS } from './db.ts';
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
  SyncQueueItem,
} from '../src/types.ts';

type EventRow = {
  id: string;
  name: string;
  team_count: number;
  individual_count: number;
  question_points_json?: string;
  apps_script_url: string;
  created_at: string;
};

type ParticipantRow = {
  id: string;
  event_id: string;
  stage: StageType;
  participant_number: number;
  label: string;
  total_score: number;
  correct_count: number;
  wrong_count: number;
  banned_round: number | null;
  lucky_bell_used_round: number | null;
  golden_gamble_count: number;
  updated_at: string;
};

type SessionRow = {
  id: string;
  event_id: string;
  stage: StageType;
  round_number: number;
  selection_size: number;
  range_start: number;
  range_end: number;
  current_number: number;
  status: 'active' | 'completed';
  created_at: string;
};

type ScoreRow = {
  id: string;
  client_tx_id: string;
  event_id: string;
  session_id: string;
  stage: StageType;
  round_number: number;
  participant_number: number;
  is_correct: number;
  booster_type: BoosterType;
  base_points: number;
  booster_points: number;
  final_delta: number;
  banned_next_round: number | null;
  created_at: string;
};

function parseQuestionPoints(raw?: string): number[] {
  if (!raw) return [...DEFAULT_QUESTION_POINTS];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 20) {
      return parsed.map((n) => Math.max(0, Math.min(100, Math.floor(Number(n) || 0))));
    }
  } catch {
    // Fallback to defaults
  }
  return [...DEFAULT_QUESTION_POINTS];
}

function mapEvent(r: EventRow): CompetitionEvent {
  return {
    id: r.id,
    name: r.name,
    teamCount: r.team_count,
    individualCount: r.individual_count,
    questionPoints: parseQuestionPoints(r.question_points_json),
    appsScriptUrl: r.apps_script_url,
    createdAt: r.created_at,
  };
}

function mapParticipant(r: ParticipantRow): Participant {
  return {
    id: r.id,
    eventId: r.event_id,
    stage: r.stage,
    participantNumber: r.participant_number,
    label: r.label,
    totalScore: r.total_score,
    correctCount: r.correct_count,
    wrongCount: r.wrong_count,
    bannedRound: r.banned_round,
    luckyBellUsedRound: r.lucky_bell_used_round,
    goldenGambleCount: r.golden_gamble_count,
    updatedAt: r.updated_at,
  };
}

function mapSession(r: SessionRow): JudgeSession {
  return {
    id: r.id,
    eventId: r.event_id,
    stage: r.stage,
    roundNumber: Math.max(1, Math.min(20, r.round_number)),
    selectionSize: r.selection_size,
    rangeStart: r.range_start,
    rangeEnd: r.range_end,
    currentNumber: r.current_number,
    status: r.status,
    createdAt: r.created_at,
  };
}

function mapScore(r: ScoreRow): ScoreEvent {
  return {
    id: r.id,
    clientTxId: r.client_tx_id,
    eventId: r.event_id,
    sessionId: r.session_id,
    stage: r.stage,
    roundNumber: r.round_number,
    participantNumber: r.participant_number,
    isCorrect: r.is_correct === 1,
    boosterType: r.booster_type,
    basePoints: r.base_points,
    boosterPoints: r.booster_points,
    finalDelta: r.final_delta,
    bannedNextRound: r.banned_next_round,
    createdAt: r.created_at,
  };
}

export function getDefaultEvent(): CompetitionEvent {
  const row = db.prepare('SELECT * FROM events ORDER BY created_at ASC LIMIT 1').get() as EventRow | undefined;
  if (!row) {
    throw new Error('No competition event initialized');
  }
  return mapEvent(row);
}

export function getActiveSession(eventId: string, deviceId = 'default'): JudgeSession {
  const safeDeviceId = (deviceId || 'default').slice(0, 64);
  const row = db
    .prepare(
      "SELECT * FROM judge_sessions WHERE event_id = ? AND device_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
    )
    .get(eventId, safeDeviceId) as SessionRow | undefined;

  if (row) return mapSession(row);

  // Inherit current stage/round defaults from the event's most recent active session if another judge already started
  const template = db
    .prepare("SELECT * FROM judge_sessions WHERE event_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1")
    .get(eventId) as SessionRow | undefined;

  const now = new Date().toISOString();
  const id = `sess_${crypto.randomUUID().slice(0, 10)}`;
  const stage = template?.stage ?? 'team';
  const roundNumber = template?.round_number ?? 1;
  const selectionSize = template?.selection_size ?? 15;
  const rangeStart = 1;
  const rangeEnd = selectionSize;

  db.prepare(`
    INSERT INTO judge_sessions (id, event_id, device_id, stage, round_number, selection_size, range_start, range_end, current_number, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(id, eventId, safeDeviceId, stage, roundNumber, selectionSize, rangeStart, rangeEnd, rangeStart, now);

  const created = db.prepare('SELECT * FROM judge_sessions WHERE id = ?').get(id) as SessionRow;
  return mapSession(created);
}

export function getStateSnapshot(eventId?: string, deviceId = 'default'): AppStateSnapshot {
  const event = eventId
    ? mapEvent(db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as EventRow)
    : getDefaultEvent();

  const activeSession = getActiveSession(event.id, deviceId);
  const participants = (
    db
      .prepare('SELECT * FROM participants WHERE event_id = ? ORDER BY stage ASC, participant_number ASC')
      .all(event.id) as ParticipantRow[]
  ).map(mapParticipant);

  const recentScores = (
    db
      .prepare('SELECT * FROM score_events WHERE event_id = ? ORDER BY created_at DESC LIMIT 1000')
      .all(event.id) as ScoreRow[]
  ).map(mapScore);

  const syncCounts = db
    .prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'synced' THEN 1 ELSE 0 END) AS synced,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM sheets_sync_queue
      WHERE event_id = ?
    `)
    .get(event.id) as { pending: number | null; synced: number | null; failed: number | null };

  return {
    event,
    activeSession,
    participants,
    recentScores,
    syncStats: {
      pending: syncCounts?.pending ?? 0,
      synced: syncCounts?.synced ?? 0,
      failed: syncCounts?.failed ?? 0,
    },
  };
}

export function updateEventConfig(
  eventId: string,
  input: {
    name?: string;
    teamCount?: number;
    individualCount?: number;
    questionPoints?: number[];
    appsScriptUrl?: string;
  },
  deviceId = 'default'
): AppStateSnapshot {
  const current = getDefaultEvent();
  const teamCount = Math.max(1, Math.min(500, Math.floor(input.teamCount ?? current.teamCount)));
  const individualCount = Math.max(1, Math.min(500, Math.floor(input.individualCount ?? current.individualCount)));
  const name = (input.name ?? current.name).trim() || current.name;
  const appsScriptUrl = (input.appsScriptUrl ?? current.appsScriptUrl).trim();

  const normalizedPoints =
    Array.isArray(input.questionPoints) && input.questionPoints.length === 20
      ? input.questionPoints.map((n) => Math.max(0, Math.min(100, Math.floor(Number(n) || 0))))
      : current.questionPoints;

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE events
      SET name = ?, team_count = ?, individual_count = ?, question_points_json = ?, apps_script_url = ?
      WHERE id = ?
    `).run(name, teamCount, individualCount, JSON.stringify(normalizedPoints), appsScriptUrl, eventId);

    const upsertParticipant = db.prepare(`
      INSERT INTO participants (id, event_id, stage, participant_number, label, total_score, correct_count, wrong_count, banned_round, lucky_bell_used_round, golden_gamble_count, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, 0, NULL, NULL, 0, ?)
      ON CONFLICT (event_id, stage, participant_number) DO NOTHING
    `);

    for (let i = 1; i <= teamCount; i++) {
      upsertParticipant.run(`p_${eventId}_team_${i}`, eventId, 'team', i, `Team ${String(i).padStart(2, '0')}`, now);
    }
    for (let i = 1; i <= individualCount; i++) {
      upsertParticipant.run(`p_${eventId}_ind_${i}`, eventId, 'individual', i, `Player ${String(i).padStart(2, '0')}`, now);
    }

    db.prepare(`
      DELETE FROM participants
      WHERE event_id = ? AND stage = 'team' AND participant_number > ? AND correct_count = 0 AND wrong_count = 0
    `).run(eventId, teamCount);

    db.prepare(`
      DELETE FROM participants
      WHERE event_id = ? AND stage = 'individual' AND participant_number > ? AND correct_count = 0 AND wrong_count = 0
    `).run(eventId, individualCount);
  });

  tx();
  return getStateSnapshot(eventId, deviceId);
}

export function startNewSession(
  eventId: string,
  input: {
    deviceId?: string;
    stage: StageType;
    roundNumber: number;
    selectionSize: number;
    rangeStart?: number;
    rangeEnd?: number;
  }
): AppStateSnapshot {
  const event = getDefaultEvent();
  const safeDeviceId = (input.deviceId || 'default').slice(0, 64);
  const maxForStage = input.stage === 'team' ? event.teamCount : event.individualCount;
  const selectionSize = Math.max(1, Math.min(500, Math.floor(input.selectionSize)));
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    if (selectionSize > maxForStage) {
      if (input.stage === 'team') {
        db.prepare('UPDATE events SET team_count = ? WHERE id = ?').run(selectionSize, eventId);
      } else {
        db.prepare('UPDATE events SET individual_count = ? WHERE id = ?').run(selectionSize, eventId);
      }
      const insertP = db.prepare(`
        INSERT INTO participants (id, event_id, stage, participant_number, label, total_score, correct_count, wrong_count, banned_round, lucky_bell_used_round, golden_gamble_count, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, NULL, NULL, 0, ?)
        ON CONFLICT (event_id, stage, participant_number) DO NOTHING
      `);
      for (let i = maxForStage + 1; i <= selectionSize; i++) {
        const prefix = input.stage === 'team' ? 'Team' : 'Player';
        insertP.run(`p_${eventId}_${input.stage}_${i}`, eventId, input.stage, i, `${prefix} ${String(i).padStart(2, '0')}`, now);
      }
    }

    const rangeStart = Math.max(1, Math.min(selectionSize, Math.floor(input.rangeStart ?? 1)));
    const rangeEnd = Math.max(rangeStart, Math.min(selectionSize, Math.floor(input.rangeEnd ?? selectionSize)));
    const roundNumber = Math.max(1, Math.min(20, Math.floor(input.roundNumber)));

    db.prepare("UPDATE judge_sessions SET status = 'completed' WHERE event_id = ? AND device_id = ? AND status = 'active'").run(
      eventId,
      safeDeviceId
    );

    const sessionId = `sess_${crypto.randomUUID().slice(0, 10)}`;
    db.prepare(`
      INSERT INTO judge_sessions (id, event_id, device_id, stage, round_number, selection_size, range_start, range_end, current_number, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(sessionId, eventId, safeDeviceId, input.stage, roundNumber, selectionSize, rangeStart, rangeEnd, rangeStart, now);
  });

  tx();
  return getStateSnapshot(eventId, safeDeviceId);
}

export function updateActiveSessionParams(
  eventId: string,
  input: {
    deviceId?: string;
    roundNumber?: number;
    currentNumber?: number;
  }
): AppStateSnapshot {
  const safeDeviceId = (input.deviceId || 'default').slice(0, 64);
  const session = getActiveSession(eventId, safeDeviceId);
  const roundNumber =
    input.roundNumber !== undefined
      ? Math.max(1, Math.min(20, Math.floor(input.roundNumber)))
      : session.roundNumber;
  const currentNumber =
    input.currentNumber !== undefined
      ? Math.max(1, Math.min(session.selectionSize, Math.floor(input.currentNumber)))
      : session.currentNumber;

  db.prepare(`
    UPDATE judge_sessions
    SET round_number = ?, current_number = ?
    WHERE id = ?
  `).run(roundNumber, currentNumber, session.id);

  // Flush only this judge session's pending scores when advancing to the next question
  if (roundNumber > session.roundNumber) {
    void flushPendingSyncQueue(eventId, session.id);
  }

  return getStateSnapshot(eventId, safeDeviceId);
}

export interface SubmitScoreInput {
  eventId: string;
  deviceId?: string;
  sessionId?: string;
  stage: StageType;
  roundNumber: number;
  participantNumber: number;
  isCorrect: boolean;
  useLuckyBell: boolean;
  useGoldenGamble: boolean;
  clientTxId?: string;
}

export function submitAuthoritativeScore(input: SubmitScoreInput): {
  scoreEvent: ScoreEvent;
  snapshot: AppStateSnapshot;
  duplicate: boolean;
} {
  const clientTxId = input.clientTxId || crypto.randomUUID();
  const safeDeviceId = (input.deviceId || 'default').slice(0, 64);

  const existingTx = db.prepare('SELECT * FROM score_events WHERE client_tx_id = ?').get(clientTxId) as ScoreRow | undefined;
  if (existingTx) {
    return {
      scoreEvent: mapScore(existingTx),
      snapshot: getStateSnapshot(input.eventId, safeDeviceId),
      duplicate: true,
    };
  }

  const eventRow = db.prepare('SELECT * FROM events WHERE id = ?').get(input.eventId) as EventRow | undefined;
  if (!eventRow) {
    throw new Error('Event not found');
  }
  const event = mapEvent(eventRow);
  const session = input.sessionId
    ? (db.prepare('SELECT * FROM judge_sessions WHERE id = ?').get(input.sessionId) as SessionRow | undefined)
    : undefined;
  const activeSession = session ? mapSession(session) : getActiveSession(event.id, safeDeviceId);

  const roundNumber = Math.max(1, Math.min(20, Math.floor(input.roundNumber)));
  const participantNumber = Math.max(1, Math.floor(input.participantNumber));

  if (input.useLuckyBell && (roundNumber < 11 || roundNumber > 15)) {
    throw new Error('TAMPER_BLOCKED: Lucky Bell booster is only available in Questions 11–15');
  }
  if (input.useGoldenGamble && roundNumber < 16) {
    throw new Error('TAMPER_BLOCKED: Star of Hope booster unlocks at Question 16');
  }

  let boosterType: BoosterType = 'none';
  if (input.useGoldenGamble) {
    boosterType = 'star_of_hope';
  } else if (input.useLuckyBell) {
    boosterType = 'lucky_bell';
  }

  // Authoritative per-question point lookup from Sheet Setup (Q1..Q20)
  const configuredQuestionPoints = event.questionPoints[roundNumber - 1] ?? 1;
  const basePoints = input.isCorrect ? configuredQuestionPoints : 0;

  let boosterPoints = 0;
  if (boosterType === 'lucky_bell') {
    boosterPoints = 3;
  } else if (boosterType === 'star_of_hope') {
    boosterPoints = input.isCorrect ? 5 : -3;
  }

  const finalDelta = basePoints + boosterPoints;
  const bannedNextRound = input.isCorrect ? null : roundNumber + 1;
  const now = new Date().toISOString();
  const scoreId = `sc_${crypto.randomUUID().slice(0, 12)}`;

  let insertedScoreRow: ScoreRow | undefined;

  const tx = db.transaction(() => {
    const alreadyScored = db
      .prepare(
        'SELECT id FROM score_events WHERE event_id = ? AND stage = ? AND round_number = ? AND participant_number = ?'
      )
      .get(event.id, input.stage, roundNumber, participantNumber) as { id: string } | undefined;

    if (alreadyScored) {
      throw new Error(
        `ALREADY_SCORED: ${input.stage === 'team' ? 'Team' : 'Player'} #${participantNumber} is already scored for Question ${roundNumber}.`
      );
    }

    db.prepare(`
      INSERT INTO score_events (
        id, client_tx_id, event_id, session_id, stage, round_number, participant_number,
        difficulty, is_correct, booster_type, base_points, booster_points, final_delta,
        banned_next_round, judge_label, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'custom', ?, ?, ?, ?, ?, ?, 'Judge', ?)
    `).run(
      scoreId,
      clientTxId,
      event.id,
      activeSession.id,
      input.stage,
      roundNumber,
      participantNumber,
      input.isCorrect ? 1 : 0,
      boosterType,
      basePoints,
      boosterPoints,
      finalDelta,
      bannedNextRound,
      now
    );

    const participantAfter = db
      .prepare('SELECT * FROM participants WHERE event_id = ? AND stage = ? AND participant_number = ?')
      .get(event.id, input.stage, participantNumber) as ParticipantRow;

    const syncPayload = {
      clientTxId,
      createdAt: now,
      eventName: event.name,
      stage: input.stage,
      roundNumber,
      participantNumber,
      participantLabel: participantAfter.label,
      isCorrect: input.isCorrect,
      basePoints,
      boosterType,
      boosterPoints,
      finalDelta,
      totalScoreAfter: participantAfter.total_score,
      bannedNextRound,
    };

    db.prepare(`
      INSERT INTO sheets_sync_queue (id, score_event_id, event_id, payload_json, status, attempts, last_error, updated_at)
      VALUES (?, ?, ?, ?, 'pending', 0, NULL, ?)
    `).run(`sq_${crypto.randomUUID().slice(0, 12)}`, scoreId, event.id, JSON.stringify(syncPayload), now);

    insertedScoreRow = db.prepare('SELECT * FROM score_events WHERE id = ?').get(scoreId) as ScoreRow;
  });

  tx();

  // Scores stay queued in SQLite (status='pending') until 'Next Q' or 'Sync Now'
  // so Undo cleanly cancels mistakes before they reach Google Sheets.

  return {
    scoreEvent: mapScore(insertedScoreRow!),
    snapshot: getStateSnapshot(event.id, safeDeviceId),
    duplicate: false,
  };
}

export function undoScoreEvent(
  eventId: string,
  scoreId?: string,
  deviceId = 'default'
): { undone: ScoreEvent | null; snapshot: AppStateSnapshot } {
  let target: ScoreRow | undefined;

  if (scoreId) {
    target = db.prepare('SELECT * FROM score_events WHERE id = ? AND event_id = ?').get(scoreId, eventId) as ScoreRow | undefined;
  } else {
    const activeSession = getActiveSession(eventId, deviceId);
    target = db
      .prepare('SELECT * FROM score_events WHERE event_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(eventId, activeSession.id) as ScoreRow | undefined;
  }

  if (!target) {
    return { undone: null, snapshot: getStateSnapshot(eventId, deviceId) };
  }

  db.transaction(() => {
    db.prepare('DELETE FROM score_events WHERE id = ?').run(target!.id);
  })();

  return {
    undone: mapScore(target),
    snapshot: getStateSnapshot(eventId, deviceId),
  };
}

export function resetStageOrEvent(
  eventId: string,
  scope: 'stage' | 'all',
  stage?: StageType,
  deviceId = 'default'
): AppStateSnapshot {
  const now = new Date().toISOString();
  db.transaction(() => {
    if (scope === 'all') {
      db.prepare('DELETE FROM score_events WHERE event_id = ?').run(eventId);
      db.prepare(`
        UPDATE participants
        SET total_score = 0, correct_count = 0, wrong_count = 0, banned_round = NULL, lucky_bell_used_round = NULL, golden_gamble_count = 0, updated_at = ?
        WHERE event_id = ?
      `).run(now, eventId);
      db.prepare(
        "UPDATE judge_sessions SET round_number = 1, current_number = range_start WHERE event_id = ? AND status = 'active'"
      ).run(eventId);
    } else if (stage) {
      db.prepare('DELETE FROM score_events WHERE event_id = ? AND stage = ?').run(eventId, stage);
      db.prepare(`
        UPDATE participants
        SET total_score = 0, correct_count = 0, wrong_count = 0, banned_round = NULL, lucky_bell_used_round = NULL, golden_gamble_count = 0, updated_at = ?
        WHERE event_id = ? AND stage = ?
      `).run(now, eventId, stage);
    }
  })();

  return getStateSnapshot(eventId, deviceId);
}

export function getEventAnalytics(eventId: string): EventAnalytics {
  const event = getDefaultEvent();
  const scores = (
    db.prepare('SELECT * FROM score_events WHERE event_id = ? ORDER BY round_number ASC, created_at ASC').all(eventId) as ScoreRow[]
  ).map(mapScore);

  const participants = (
    db.prepare('SELECT * FROM participants WHERE event_id = ?').all(eventId) as ParticipantRow[]
  ).map(mapParticipant);

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

export function getSyncQueueItems(eventId: string): SyncQueueItem[] {
  const rows = db
    .prepare(`
      SELECT q.id, q.score_event_id, q.event_id, q.status, q.attempts, q.last_error, q.updated_at,
             s.stage, s.round_number, s.participant_number, s.final_delta
      FROM sheets_sync_queue q
      LEFT JOIN score_events s ON s.id = q.score_event_id
      WHERE q.event_id = ?
      ORDER BY q.updated_at DESC
      LIMIT 60
    `)
    .all(eventId) as Array<{
    id: string;
    score_event_id: string;
    event_id: string;
    status: 'pending' | 'synced' | 'failed';
    attempts: number;
    last_error: string | null;
    updated_at: string;
    stage?: StageType;
    round_number?: number;
    participant_number?: number;
    final_delta?: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    scoreEventId: r.score_event_id,
    eventId: r.event_id,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    updatedAt: r.updated_at,
    stage: r.stage,
    roundNumber: r.round_number,
    participantNumber: r.participant_number,
    finalDelta: r.final_delta,
  }));
}

let isFlushing = false;
let onSyncStateChange: ((eventId: string) => void) | null = null;

export function registerSyncBroadcastCallback(cb: (eventId: string) => void) {
  onSyncStateChange = cb;
}

export async function flushPendingSyncQueue(
  eventId: string,
  sessionId?: string
): Promise<{ synced: number; failed: number }> {
  if (isFlushing) return { synced: 0, failed: 0 };

  const eventRow = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as EventRow | undefined;
  if (!eventRow || !eventRow.apps_script_url) {
    return { synced: 0, failed: 0 };
  }

  const pending = sessionId
    ? (db
        .prepare(`
          SELECT q.id, q.payload_json, q.attempts
          FROM sheets_sync_queue q
          JOIN score_events s ON s.id = q.score_event_id
          WHERE q.event_id = ? AND q.status IN ('pending', 'failed') AND s.session_id = ?
          ORDER BY q.updated_at ASC
          LIMIT 100
        `)
        .all(eventId, sessionId) as Array<{ id: string; payload_json: string; attempts: number }>)
    : (db
        .prepare(`
          SELECT id, payload_json, attempts
          FROM sheets_sync_queue
          WHERE event_id = ? AND status IN ('pending', 'failed')
          ORDER BY updated_at ASC
          LIMIT 200
        `)
        .all(eventId) as Array<{ id: string; payload_json: string; attempts: number }>);

  if (pending.length === 0) return { synced: 0, failed: 0 };

  isFlushing = true;
  let synced = 0;
  let failed = 0;
  const now = new Date().toISOString();

  try {
    const records = pending.map((item) => JSON.parse(item.payload_json));

    const bannedHistoryRows = db
      .prepare(`
        SELECT stage, participant_number, banned_next_round
        FROM score_events
        WHERE event_id = ? AND banned_next_round IS NOT NULL
        ORDER BY round_number ASC
      `)
      .all(eventId) as Array<{ stage: StageType; participant_number: number; banned_next_round: number }>;

    const bannedMap = new Map<string, string[]>();
    for (const row of bannedHistoryRows) {
      const key = `${row.stage}:${row.participant_number}`;
      const list = bannedMap.get(key) || [];
      list.push(`Q${row.banned_next_round}`);
      bannedMap.set(key, list);
    }

    const leaderboard = (
      db.prepare('SELECT * FROM participants WHERE event_id = ?').all(eventId) as ParticipantRow[]
    ).map((row) => {
      const p = mapParticipant(row);
      const history = bannedMap.get(`${p.stage}:${p.participantNumber}`) || [];
      return {
        ...p,
        bannedQuestions: history.join(', '),
      };
    });

    const response = await fetch(eventRow.apps_script_url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify({
        type: 'batch_sync',
        records,
        leaderboard,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const text = await response.text();
    let parsed: { ok?: boolean; error?: string } = {};
    let isJson = false;
    try {
      parsed = JSON.parse(text);
      isJson = true;
    } catch {
      isJson = false;
    }

    if (response.ok && isJson && parsed.ok !== false) {
      const markSynced = db.prepare(
        "UPDATE sheets_sync_queue SET status = 'synced', attempts = attempts + 1, last_error = NULL, updated_at = ? WHERE id = ?"
      );
      db.transaction(() => {
        for (const item of pending) {
          markSynced.run(now, item.id);
        }
      })();
      synced = pending.length;
    } else {
      const errMsg =
        parsed.error ||
        (response.status === 401 || response.status === 403
          ? `HTTP ${response.status}: Set Apps Script deployment 'Who has access' to 'Anyone' and use the /exec URL.`
          : `HTTP ${response.status}: Unexpected response from Apps Script`);
      const markFailed = db.prepare(
        "UPDATE sheets_sync_queue SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?"
      );
      db.transaction(() => {
        for (const item of pending) {
          markFailed.run(errMsg, now, item.id);
        }
      })();
      failed = pending.length;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Network error posting to Apps Script';
    const markFailed = db.prepare(
      "UPDATE sheets_sync_queue SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?"
    );
    db.transaction(() => {
      for (const item of pending) {
        markFailed.run(errMsg, now, item.id);
      }
    })();
    failed = pending.length;
  } finally {
    isFlushing = false;
    onSyncStateChange?.(eventId);
  }

  return { synced, failed };
}

export async function testAppsScriptConnection(url: string): Promise<{ ok: boolean; message: string }> {
  const cleanUrl = url.trim();
  if (!cleanUrl || !cleanUrl.startsWith('https://script.google.com/')) {
    return {
      ok: false,
      message: 'Enter a valid Google Apps Script Web App URL starting with https://script.google.com/',
    };
  }

  if (cleanUrl.endsWith('/dev') || cleanUrl.includes('/dev?')) {
    return {
      ok: false,
      message: 'You pasted a /dev test URL. Click Deploy -> New deployment -> Web app and paste the /exec URL instead.',
    };
  }

  try {
    const res = await fetch(cleanUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify({ type: 'ping' }),
      signal: AbortSignal.timeout(12000),
    });

    const text = await res.text();
    try {
      const data = JSON.parse(text) as { ok?: boolean; message?: string; error?: string };
      if (data.ok) {
        return { ok: true, message: data.message || 'Connected to Google Apps Script' };
      }
      return { ok: false, message: data.error || 'Apps Script returned ok=false' };
    } catch {
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          message:
            'HTTP 403 Forbidden: In Apps Script click Deploy -> Manage deployments -> Edit -> set "Execute as: Me" and "Who has access: Anyone", authorize access, and save.',
        };
      }
      if (text.toLowerCase().includes('accounts.google.com') || text.toLowerCase().includes('<html')) {
        return {
          ok: false,
          message:
            'Apps Script redirected to a Google login/HTML page. Set "Who has access" to "Anyone" (not "Only myself" or "Anyone with Google account") and re-deploy.',
        };
      }
      return { ok: false, message: `HTTP ${res.status} response from Apps Script` };
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Failed to connect to Apps Script URL',
    };
  }
}

export function exportScoresCsv(eventId: string): string {
  const scores = (
    db
      .prepare('SELECT * FROM score_events WHERE event_id = ? ORDER BY stage ASC, round_number ASC, participant_number ASC')
      .all(eventId) as ScoreRow[]
  ).map(mapScore);

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
  for (const s of scores) {
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
  return lines.join('\n');
}
