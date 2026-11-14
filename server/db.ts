import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'golden_bell.db');

export const DEFAULT_QUESTION_POINTS = [
  1, 1, 1, 1, 1,
  2, 2, 2, 2, 2,
  3, 3, 3, 3, 3,
  4, 4, 4, 4, 5,
];

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  const defaultPointsJson = JSON.stringify(DEFAULT_QUESTION_POINTS);

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      team_count INTEGER NOT NULL DEFAULT 15 CHECK (team_count >= 1 AND team_count <= 500),
      individual_count INTEGER NOT NULL DEFAULT 30 CHECK (individual_count >= 1 AND individual_count <= 500),
      question_points_json TEXT NOT NULL DEFAULT '${defaultPointsJson}',
      apps_script_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      stage TEXT NOT NULL CHECK (stage IN ('team', 'individual')),
      participant_number INTEGER NOT NULL CHECK (participant_number >= 1),
      label TEXT NOT NULL,
      total_score INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      wrong_count INTEGER NOT NULL DEFAULT 0,
      banned_round INTEGER DEFAULT NULL,
      lucky_bell_used_round INTEGER DEFAULT NULL,
      golden_gamble_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (event_id, stage, participant_number)
    );

    CREATE TABLE IF NOT EXISTS judge_sessions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL DEFAULT 'default',
      stage TEXT NOT NULL CHECK (stage IN ('team', 'individual')),
      round_number INTEGER NOT NULL DEFAULT 1 CHECK (round_number >= 1 AND round_number <= 20),
      selection_size INTEGER NOT NULL DEFAULT 15 CHECK (selection_size >= 1),
      range_start INTEGER NOT NULL DEFAULT 1 CHECK (range_start >= 1),
      range_end INTEGER NOT NULL DEFAULT 15 CHECK (range_end >= 1),
      current_number INTEGER NOT NULL DEFAULT 1 CHECK (current_number >= 1),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS score_events (
      id TEXT PRIMARY KEY,
      client_tx_id TEXT NOT NULL UNIQUE,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES judge_sessions(id) ON DELETE CASCADE,
      stage TEXT NOT NULL CHECK (stage IN ('team', 'individual')),
      round_number INTEGER NOT NULL CHECK (round_number >= 1 AND round_number <= 20),
      participant_number INTEGER NOT NULL CHECK (participant_number >= 1),
      difficulty TEXT NOT NULL DEFAULT 'custom',
      is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
      booster_type TEXT NOT NULL DEFAULT 'none' CHECK (booster_type IN ('none', 'lucky_bell', 'star_of_hope')),
      base_points INTEGER NOT NULL,
      booster_points INTEGER NOT NULL,
      final_delta INTEGER NOT NULL,
      banned_next_round INTEGER DEFAULT NULL,
      judge_label TEXT NOT NULL DEFAULT 'Judge',
      created_at TEXT NOT NULL,
      UNIQUE (event_id, stage, round_number, participant_number)
    );

    CREATE TABLE IF NOT EXISTS sheets_sync_queue (
      id TEXT PRIMARY KEY,
      score_event_id TEXT NOT NULL UNIQUE REFERENCES score_events(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_participants_lookup ON participants (event_id, stage, participant_number);
    CREATE INDEX IF NOT EXISTS idx_score_events_round ON score_events (event_id, stage, round_number);
    CREATE INDEX IF NOT EXISTS idx_score_events_created ON score_events (event_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sheets_sync_queue (event_id, status, updated_at);
  `);

  // Safe migration if database already existed from prior turns
  const eventCols = db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
  if (!eventCols.some((c) => c.name === 'question_points_json')) {
    db.exec(`ALTER TABLE events ADD COLUMN question_points_json TEXT NOT NULL DEFAULT '${defaultPointsJson}'`);
  }

  const sessionCols = db.prepare('PRAGMA table_info(judge_sessions)').all() as Array<{ name: string }>;
  if (!sessionCols.some((c) => c.name === 'device_id')) {
    db.exec(`ALTER TABLE judge_sessions ADD COLUMN device_id TEXT NOT NULL DEFAULT 'default'`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_judge_sessions_device ON judge_sessions (event_id, device_id, status, created_at DESC);`);

  const scoreTableSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'score_events'")
    .get() as { sql?: string } | undefined;

  if (
    scoreTableSql?.sql &&
    (scoreTableSql.sql.includes("'easy', 'medium', 'hard'") || !scoreTableSql.sql.includes("'star_of_hope'"))
  ) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE score_events_new (
        id TEXT PRIMARY KEY,
        client_tx_id TEXT NOT NULL UNIQUE,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES judge_sessions(id) ON DELETE CASCADE,
        stage TEXT NOT NULL CHECK (stage IN ('team', 'individual')),
        round_number INTEGER NOT NULL CHECK (round_number >= 1 AND round_number <= 20),
        participant_number INTEGER NOT NULL CHECK (participant_number >= 1),
        difficulty TEXT NOT NULL DEFAULT 'custom',
        is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
        booster_type TEXT NOT NULL DEFAULT 'none' CHECK (booster_type IN ('none', 'lucky_bell', 'star_of_hope')),
        base_points INTEGER NOT NULL,
        booster_points INTEGER NOT NULL,
        final_delta INTEGER NOT NULL,
        banned_next_round INTEGER DEFAULT NULL,
        judge_label TEXT NOT NULL DEFAULT 'Judge',
        created_at TEXT NOT NULL,
        UNIQUE (event_id, stage, round_number, participant_number)
      );
      INSERT INTO score_events_new
      SELECT
        id, client_tx_id, event_id, session_id, stage, round_number, participant_number,
        difficulty, is_correct,
        CASE WHEN booster_type = 'golden_gamble' OR booster_type = 'both' THEN 'star_of_hope' ELSE booster_type END,
        base_points, booster_points, final_delta, banned_next_round, judge_label, created_at
      FROM score_events;
      DROP TABLE score_events;
      ALTER TABLE score_events_new RENAME TO score_events;
      CREATE INDEX IF NOT EXISTS idx_score_events_round ON score_events (event_id, stage, round_number);
      CREATE INDEX IF NOT EXISTS idx_score_events_created ON score_events (event_id, created_at DESC);
      PRAGMA foreign_keys = ON;
    `);
  }

  // Tamper-proof database triggers:
  // - Lucky Bell unlocks at Q11 (+3 pts, once per participant)
  // - Star of Hope unlocks at Q16 (+5 correct / -3 wrong)
  // - Mutually exclusive: Star of Hope and Lucky Bell cannot both be active on the same question
  db.exec(`
    DROP TRIGGER IF EXISTS trg_score_events_validate_before_insert;
    CREATE TRIGGER trg_score_events_validate_before_insert
    BEFORE INSERT ON score_events
    FOR EACH ROW
    BEGIN
      SELECT CASE
        WHEN NEW.round_number < 1 OR NEW.round_number > 20
        THEN RAISE(ABORT, 'INVALID_QUESTION: Question number must be between 1 and 20')
      END;

      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM participants
          WHERE event_id = NEW.event_id
            AND stage = NEW.stage
            AND participant_number = NEW.participant_number
        )
        THEN RAISE(ABORT, 'INVALID_PARTICIPANT: Participant does not exist in this stage')
      END;

      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM participants
          WHERE event_id = NEW.event_id
            AND stage = NEW.stage
            AND participant_number = NEW.participant_number
            AND banned_round = NEW.round_number
        )
        THEN RAISE(ABORT, 'BAN_ENFORCED: Participant is banned from this question and resumes next question')
      END;

      SELECT CASE
        WHEN NEW.booster_type = 'lucky_bell' AND (NEW.round_number < 11 OR NEW.round_number > 15)
        THEN RAISE(ABORT, 'TAMPER_BLOCKED: Lucky Bell is only available in Questions 11-15')
      END;

      SELECT CASE
        WHEN NEW.booster_type = 'lucky_bell' AND EXISTS (
          SELECT 1 FROM participants
          WHERE event_id = NEW.event_id
            AND stage = NEW.stage
            AND participant_number = NEW.participant_number
            AND lucky_bell_used_round IS NOT NULL
        )
        THEN RAISE(ABORT, 'TAMPER_BLOCKED: Lucky Bell can only be applied once per participant')
      END;

      SELECT CASE
        WHEN NEW.booster_type = 'star_of_hope' AND NEW.round_number < 16
        THEN RAISE(ABORT, 'TAMPER_BLOCKED: Star of Hope booster unlocks at Question 16')
      END;

      SELECT CASE
        WHEN NEW.final_delta != (NEW.base_points + NEW.booster_points)
        THEN RAISE(ABORT, 'TAMPER_BLOCKED: Score delta integrity check failed')
      END;

      SELECT CASE
        WHEN NEW.booster_type = 'none' AND NEW.booster_points != 0
        THEN RAISE(ABORT, 'TAMPER_BLOCKED: Non-zero booster points without active booster')
        WHEN NEW.booster_type = 'lucky_bell' AND NEW.booster_points != 3
        THEN RAISE(ABORT, 'TAMPER_BLOCKED: Lucky Bell must award exactly +3 points')
        WHEN NEW.booster_type = 'star_of_hope' AND NEW.is_correct = 1 AND NEW.booster_points != 5
        THEN RAISE(ABORT, 'TAMPER_BLOCKED: Star of Hope must award +5 on correct answer')
        WHEN NEW.booster_type = 'star_of_hope' AND NEW.is_correct = 0 AND NEW.booster_points != -3
        THEN RAISE(ABORT, 'TAMPER_BLOCKED: Star of Hope must deduct -3 on wrong answer')
      END;
    END;

    DROP TRIGGER IF EXISTS trg_score_events_apply_after_insert;
    CREATE TRIGGER trg_score_events_apply_after_insert
    AFTER INSERT ON score_events
    FOR EACH ROW
    BEGIN
      UPDATE participants
      SET
        total_score = total_score + NEW.final_delta,
        correct_count = correct_count + CASE WHEN NEW.is_correct = 1 THEN 1 ELSE 0 END,
        wrong_count = wrong_count + CASE WHEN NEW.is_correct = 0 THEN 1 ELSE 0 END,
        banned_round = CASE WHEN NEW.is_correct = 0 THEN NEW.round_number + 1 ELSE NULL END,
        lucky_bell_used_round = CASE
          WHEN NEW.booster_type = 'lucky_bell' THEN NEW.round_number
          ELSE lucky_bell_used_round
        END,
        golden_gamble_count = golden_gamble_count + CASE
          WHEN NEW.booster_type = 'star_of_hope' THEN 1
          ELSE 0
        END,
        updated_at = NEW.created_at
      WHERE event_id = NEW.event_id
        AND stage = NEW.stage
        AND participant_number = NEW.participant_number;
    END;

    DROP TRIGGER IF EXISTS trg_score_events_revert_after_delete;
    CREATE TRIGGER trg_score_events_revert_after_delete
    AFTER DELETE ON score_events
    FOR EACH ROW
    BEGIN
      UPDATE participants
      SET
        total_score = total_score - OLD.final_delta,
        correct_count = MAX(0, correct_count - CASE WHEN OLD.is_correct = 1 THEN 1 ELSE 0 END),
        wrong_count = MAX(0, wrong_count - CASE WHEN OLD.is_correct = 0 THEN 1 ELSE 0 END),
        banned_round = (
          SELECT se.banned_next_round
          FROM score_events se
          WHERE se.event_id = OLD.event_id
            AND se.stage = OLD.stage
            AND se.participant_number = OLD.participant_number
          ORDER BY se.round_number DESC, se.created_at DESC
          LIMIT 1
        ),
        lucky_bell_used_round = CASE
          WHEN OLD.booster_type = 'lucky_bell' THEN NULL
          ELSE lucky_bell_used_round
        END,
        golden_gamble_count = MAX(0, golden_gamble_count - CASE
          WHEN OLD.booster_type = 'star_of_hope' THEN 1
          ELSE 0
        END),
        updated_at = datetime('now')
      WHERE event_id = OLD.event_id
        AND stage = OLD.stage
        AND participant_number = OLD.participant_number;
    END;
  `);

  seedDefaultEventIfEmpty();
}

function seedDefaultEventIfEmpty() {
  const existing = db.prepare('SELECT id FROM events LIMIT 1').get() as { id: string } | undefined;
  if (existing) return;

  const eventId = 'evt_golden_bell_2026';
  const now = new Date().toISOString();

  const insertAll = db.transaction(() => {
    db.prepare(`
      INSERT INTO events (id, name, team_count, individual_count, question_points_json, apps_script_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(eventId, 'Golden Bell Championship 2026', 15, 30, JSON.stringify(DEFAULT_QUESTION_POINTS), '', now);

    const insertParticipant = db.prepare(`
      INSERT INTO participants (id, event_id, stage, participant_number, label, total_score, correct_count, wrong_count, banned_round, lucky_bell_used_round, golden_gamble_count, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, 0, NULL, NULL, 0, ?)
    `);

    for (let i = 1; i <= 15; i++) {
      insertParticipant.run(`p_team_${i}`, eventId, 'team', i, `Team ${String(i).padStart(2, '0')}`, now);
    }
    for (let i = 1; i <= 30; i++) {
      insertParticipant.run(`p_ind_${i}`, eventId, 'individual', i, `Player ${String(i).padStart(2, '0')}`, now);
    }

    db.prepare(`
      INSERT INTO judge_sessions (id, event_id, stage, round_number, selection_size, range_start, range_end, current_number, status, created_at)
      VALUES (?, ?, 'team', 1, 15, 1, 15, 1, 'active', ?)
    `).run('sess_initial_team_1', eventId, now);
  });

  insertAll();
}
