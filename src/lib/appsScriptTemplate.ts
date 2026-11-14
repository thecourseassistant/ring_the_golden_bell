export const APPS_SCRIPT_CODE = `/**
 * Google Apps Script Web App Backend & Database for Golden Bell Judge
 * Works 100% with static web hosting (e.g. GitHub Pages) — no Node.js server required.
 *
 * Deployment Steps:
 * 1. Paste your Google Spreadsheet link into SPREADSHEET_URL below.
 * 2. Open Google Apps Script (Extensions -> Apps Script or script.google.com).
 * 3. Paste this entire file into Code.gs and save.
 * 4. Click Deploy -> New deployment -> Select type: Web app.
 * 5. Execute as: Me | Who has access: Anyone.
 * 6. Copy the /exec Web App URL and paste it into Golden Bell -> Sheets Setup.
 */

// ============================================================================
// PASTE YOUR GOOGLE SPREADSHEET LINK BELOW:
// Example: 'https://docs.google.com/spreadsheets/d/1AbCdEf.../edit'
// ============================================================================
var SPREADSHEET_URL = 'PASTE_YOUR_GOOGLE_SPREADSHEET_LINK_HERE';

var DEFAULT_QUESTION_POINTS = [
  1, 1, 1, 1, 1,
  2, 2, 2, 2, 2,
  3, 3, 3, 3, 3,
  4, 4, 4, 4, 5
];

var SCORES_HEADERS = [
  'TxID',
  'Timestamp',
  'Event',
  'Stage',
  'Question #',
  'Participant #',
  'Participant Label',
  'Result',
  'Question Points',
  'Booster',
  'Booster Points',
  'Final Delta',
  'Total Score After',
  'Banned Next Question',
  'SessionId'
];

var LEADERBOARD_HEADERS = [
  'Rank',
  'Participant #',
  'Label',
  'Total Score',
  'Correct',
  'Wrong',
  'Banned Question',
  'Lucky Bell Question',
  'Star of Hope Uses'
];

function getTargetSpreadsheet() {
  if (SPREADSHEET_URL && SPREADSHEET_URL !== 'PASTE_YOUR_GOOGLE_SPREADSHEET_LINK_HERE') {
    return SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    return active;
  }
  throw new Error('Please paste your Google Spreadsheet link into SPREADSHEET_URL at the top of Code.gs.');
}

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.payload) {
      var parsed = JSON.parse(String(e.parameter.payload));
      return handleRequestPayload(parsed);
    }
    var action = (e && e.parameter && e.parameter.type) ? String(e.parameter.type) : 'health';
    if (action === 'get_state' || action === 'ping') {
      return handleRequestPayload({ type: action });
    }
    var ss = getTargetSpreadsheet();
    return jsonResponse({
      ok: true,
      service: 'Golden Bell Judge Sheets Backend',
      sheet: ss.getName(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || '{}');
    return handleRequestPayload(payload);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function handleRequestPayload(payload) {
  try {
    var ss = getTargetSpreadsheet();

    if (payload.type === 'ping') {
      return jsonResponse({ ok: true, message: 'Connected to Google Sheet: ' + ss.getName() });
    }

    if (payload.type === 'get_state' && ss.getSheetByName('Config') && ss.getSheetByName('Scores')) {
      return jsonResponse(buildStatePayload(ss));
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);

    try {
      if (payload.type === 'get_state') {
        return jsonResponse(buildStatePayload(ss));
      }

      if (payload.type === 'save_config') {
      var updatedCfg = writeConfig(ss, payload.config || {});
      var stateAfterCfg = buildStatePayload(ss, updatedCfg);
      syncBothLeaderboards(ss, stateAfterCfg.participants);
      return jsonResponse(stateAfterCfg);
    }

    if (payload.type === 'reset_event') {
      var cfg = ensureConfig(ss);
      cfg.resetVersion = Number(cfg.resetVersion || 0) + 1;
      writeConfig(ss, cfg);

      var scoresSheetReset = getOrCreateSheet(ss, 'Scores', SCORES_HEADERS);
      if (scoresSheetReset.getLastRow() > 1) {
        scoresSheetReset.deleteRows(2, scoresSheetReset.getLastRow() - 1);
      }

      var stateAfterReset = buildStatePayload(ss, cfg);
      syncBothLeaderboards(ss, stateAfterReset.participants);
      return jsonResponse(stateAfterReset);
    }

    if (payload.type === 'undo_score') {
      var scoresSheetUndo = getOrCreateSheet(ss, 'Scores', SCORES_HEADERS);
      var undoneTxId = deleteScoreRow(scoresSheetUndo, payload.clientTxId, payload.sessionId, payload.stage, payload.roundNumber);
      var stateAfterUndo = buildStatePayload(ss);
      syncBothLeaderboards(ss, stateAfterUndo.participants);
      stateAfterUndo.undoneTxId = undoneTxId;
      return jsonResponse(stateAfterUndo);
    }

    var config = ensureConfig(ss);
    var scoresSheet = getOrCreateSheet(ss, 'Scores', SCORES_HEADERS);
    var existingScores = readAllScores(scoresSheet);

    var existingTxIds = {};
    var scoredKeys = {};
    var participantState = {};

    for (var i = 0; i < existingScores.length; i++) {
      var ex = existingScores[i];
      existingTxIds[ex.clientTxId] = true;
      scoredKeys[ex.stage + ':' + ex.roundNumber + ':' + ex.participantNumber] = true;
    }

    var sortedExisting = existingScores.slice().sort(function(a, b) {
      return a.roundNumber - b.roundNumber;
    });
    for (var j = 0; j < sortedExisting.length; j++) {
      var s = sortedExisting[j];
      var pKey = s.stage + ':' + s.participantNumber;
      if (!participantState[pKey]) {
        participantState[pKey] = { totalScore: 0, bannedRound: null, luckyBellUsedRound: null };
      }
      participantState[pKey].totalScore += s.finalDelta;
      participantState[pKey].bannedRound = s.isCorrect ? null : (s.roundNumber + 1);
      if (s.boosterType === 'lucky_bell') {
        participantState[pKey].luckyBellUsedRound = s.roundNumber;
      }
    }

    var incoming = Array.isArray(payload.records) ? payload.records : [payload];
    incoming = incoming.slice().sort(function(a, b) {
      return Number(a.roundNumber || 1) - Number(b.roundNumber || 1);
    });

    var appended = 0;
    var rejected = [];
    var rowsToAppend = [];

    for (var k = 0; k < incoming.length; k++) {
      var r = incoming[k];
      if (!r || !r.clientTxId) continue;
      if (existingTxIds[r.clientTxId]) continue;

      var stage = r.stage === 'individual' ? 'individual' : 'team';
      var roundNumber = Math.floor(Number(r.roundNumber || 0));
      var participantNumber = Math.floor(Number(r.participantNumber || 0));
      var isCorrect = Boolean(r.isCorrect);
      var boosterType = String(r.boosterType || 'none');

      if (roundNumber < 1 || roundNumber > 20) {
        rejected.push({ clientTxId: r.clientTxId, reason: 'INVALID_QUESTION: Must be Q1-Q20' });
        continue;
      }
      if (participantNumber < 1) {
        rejected.push({ clientTxId: r.clientTxId, reason: 'INVALID_PARTICIPANT' });
        continue;
      }

      var sKey = stage + ':' + roundNumber + ':' + participantNumber;
      if (scoredKeys[sKey]) {
        rejected.push({ clientTxId: r.clientTxId, reason: 'ALREADY_SCORED: Participant already scored for Q' + roundNumber });
        continue;
      }

      var partKey = stage + ':' + participantNumber;
      if (!participantState[partKey]) {
        participantState[partKey] = { totalScore: 0, bannedRound: null, luckyBellUsedRound: null };
      }
      var pState = participantState[partKey];

      if (pState.bannedRound === roundNumber) {
        rejected.push({ clientTxId: r.clientTxId, reason: 'BAN_ENFORCED: Banned for Q' + roundNumber });
        continue;
      }

      if (boosterType === 'lucky_bell') {
        if (roundNumber < 11 || roundNumber > 15) {
          rejected.push({ clientTxId: r.clientTxId, reason: 'TAMPER_BLOCKED: Lucky Bell only allowed in Q11-Q15' });
          continue;
        }
        if (pState.luckyBellUsedRound !== null) {
          rejected.push({ clientTxId: r.clientTxId, reason: 'TAMPER_BLOCKED: Lucky Bell already used' });
          continue;
        }
      } else if (boosterType === 'star_of_hope') {
        if (roundNumber < 16) {
          rejected.push({ clientTxId: r.clientTxId, reason: 'TAMPER_BLOCKED: Star of Hope unlocks at Q16' });
          continue;
        }
      } else {
        boosterType = 'none';
      }

      var qPoints = Number(config.questionPoints[roundNumber - 1]);
      if (isNaN(qPoints)) qPoints = 1;
      var basePoints = isCorrect ? qPoints : 0;
      var boosterPoints = 0;
      if (boosterType === 'lucky_bell') {
        boosterPoints = 3;
      } else if (boosterType === 'star_of_hope') {
        boosterPoints = isCorrect ? 5 : -3;
      }

      var finalDelta = basePoints + boosterPoints;
      var totalScoreAfter = pState.totalScore + finalDelta;
      var bannedNextRound = isCorrect ? null : (roundNumber + 1);
      var prefix = stage === 'team' ? 'Team ' : 'Player ';
      var label = r.participantLabel || (prefix + (participantNumber < 10 ? '0' + participantNumber : participantNumber));

      rowsToAppend.push([
        r.clientTxId,
        r.createdAt || new Date().toISOString(),
        config.name || 'Golden Bell Championship',
        stage,
        roundNumber,
        participantNumber,
        label,
        isCorrect ? 'CORRECT' : 'WRONG',
        basePoints,
        boosterType,
        boosterPoints,
        finalDelta,
        totalScoreAfter,
        bannedNextRound ? ('Q' + bannedNextRound) : '',
        r.sessionId || ''
      ]);

      existingTxIds[r.clientTxId] = true;
      scoredKeys[sKey] = true;
      pState.totalScore = totalScoreAfter;
      pState.bannedRound = bannedNextRound;
      if (boosterType === 'lucky_bell') {
        pState.luckyBellUsedRound = roundNumber;
      }
      appended++;
    }

    if (rowsToAppend.length > 0) {
      var startRow = scoresSheet.getLastRow() + 1;
      scoresSheet.getRange(startRow, 1, rowsToAppend.length, SCORES_HEADERS.length).setValues(rowsToAppend);
    }

      var finalState = buildStatePayload(ss, config);
      syncBothLeaderboards(ss, finalState.participants);
      finalState.appended = appended;
      finalState.rejected = rejected;
      return jsonResponse(finalState);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#0F172A').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() >= 1 && sheet.getLastColumn() < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function ensureConfig(ss) {
  var sheet = getOrCreateSheet(ss, 'Config', ['Key', 'Value']);
  var lastRow = sheet.getLastRow();
  var map = {};
  if (lastRow > 1) {
    var rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0]) map[String(rows[i][0])] = rows[i][1];
    }
  }

  var qPoints = DEFAULT_QUESTION_POINTS.slice();
  if (map.questionPoints) {
    try {
      var parsed = JSON.parse(String(map.questionPoints));
      if (Array.isArray(parsed) && parsed.length === 20) {
        qPoints = parsed.map(function(n) { return Math.max(0, Math.min(100, Math.floor(Number(n) || 0))); });
      }
    } catch (e) {}
  }

  var cfg = {
    name: map.name ? String(map.name) : 'Golden Bell Championship 2026',
    teamCount: Math.max(1, Math.min(500, Math.floor(Number(map.teamCount) || 15))),
    individualCount: Math.max(1, Math.min(500, Math.floor(Number(map.individualCount) || 30))),
    questionPoints: qPoints,
    resetVersion: Math.floor(Number(map.resetVersion) || 0)
  };

  if (lastRow <= 1) {
    writeConfig(ss, cfg);
  }
  return cfg;
}

function writeConfig(ss, input) {
  var current = ensureConfig(ss);
  var qPoints = current.questionPoints;
  if (Array.isArray(input.questionPoints) && input.questionPoints.length === 20) {
    qPoints = input.questionPoints.map(function(n) { return Math.max(0, Math.min(100, Math.floor(Number(n) || 0))); });
  }
  var cfg = {
    name: input.name !== undefined ? String(input.name).trim() || current.name : current.name,
    teamCount: input.teamCount !== undefined ? Math.max(1, Math.min(500, Math.floor(Number(input.teamCount) || 1))) : current.teamCount,
    individualCount: input.individualCount !== undefined ? Math.max(1, Math.min(500, Math.floor(Number(input.individualCount) || 1))) : current.individualCount,
    questionPoints: qPoints,
    resetVersion: input.resetVersion !== undefined ? Math.floor(Number(input.resetVersion) || 0) : current.resetVersion
  };

  var sheet = getOrCreateSheet(ss, 'Config', ['Key', 'Value']);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).clearContent();
  }
  sheet.getRange(2, 1, 5, 2).setValues([
    ['name', cfg.name],
    ['teamCount', cfg.teamCount],
    ['individualCount', cfg.individualCount],
    ['questionPoints', JSON.stringify(cfg.questionPoints)],
    ['resetVersion', cfg.resetVersion]
  ]);
  return cfg;
}

function readAllScores(scoresSheet) {
  var lastRow = scoresSheet.getLastRow();
  if (lastRow <= 1) return [];
  var cols = Math.max(scoresSheet.getLastColumn(), SCORES_HEADERS.length);
  var values = scoresSheet.getRange(2, 1, lastRow - 1, cols).getValues();
  var list = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (!row[0]) continue;
    var bannedRaw = String(row[13] || '').trim();
    var bannedNext = bannedRaw ? Number(bannedRaw.replace(/^Q/i, '')) || null : null;
    list.push({
      id: String(row[0]),
      clientTxId: String(row[0]),
      createdAt: String(row[1] || ''),
      eventId: 'evt_sheets',
      sessionId: String(row[14] || 'sheets'),
      stage: row[3] === 'individual' ? 'individual' : 'team',
      roundNumber: Number(row[4] || 1),
      participantNumber: Number(row[5] || 1),
      isCorrect: String(row[7] || '').toUpperCase() === 'CORRECT',
      basePoints: Number(row[8] || 0),
      boosterType: String(row[9] || 'none'),
      boosterPoints: Number(row[10] || 0),
      finalDelta: Number(row[11] || 0),
      bannedNextRound: bannedNext
    });
  }
  return list;
}

function deleteScoreRow(scoresSheet, clientTxId, sessionId, stage, roundNumber) {
  var lastRow = scoresSheet.getLastRow();
  if (lastRow <= 1) return null;
  var cols = Math.max(scoresSheet.getLastColumn(), SCORES_HEADERS.length);
  var values = scoresSheet.getRange(2, 1, lastRow - 1, cols).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var row = values[i];
    if (clientTxId && String(row[0]) === String(clientTxId)) {
      scoresSheet.deleteRow(i + 2);
      return String(row[0]);
    }
    if (!clientTxId && sessionId && String(row[14] || '') === String(sessionId)) {
      var rowStage = row[3] === 'individual' ? 'individual' : 'team';
      var rowRound = Number(row[4] || 1);
      if ((!stage || rowStage === stage) && (!roundNumber || rowRound === Number(roundNumber))) {
        scoresSheet.deleteRow(i + 2);
        return String(row[0]);
      }
    }
  }
  return null;
}

function buildStatePayload(ss, providedConfig) {
  var cfg = providedConfig || ensureConfig(ss);
  var scoresSheet = getOrCreateSheet(ss, 'Scores', SCORES_HEADERS);
  var scores = readAllScores(scoresSheet);

  var participantsMap = {};
  var participants = [];

  for (var t = 1; t <= cfg.teamCount; t++) {
    var tObj = {
      id: 'p_team_' + t,
      eventId: 'evt_sheets',
      stage: 'team',
      participantNumber: t,
      label: 'Team ' + (t < 10 ? '0' + t : t),
      totalScore: 0,
      correctCount: 0,
      wrongCount: 0,
      bannedRound: null,
      bannedQuestionsList: [],
      bannedQuestions: '',
      luckyBellUsedRound: null,
      goldenGambleCount: 0,
      updatedAt: new Date().toISOString()
    };
    participantsMap['team:' + t] = tObj;
    participants.push(tObj);
  }

  for (var p = 1; p <= cfg.individualCount; p++) {
    var pObj = {
      id: 'p_ind_' + p,
      eventId: 'evt_sheets',
      stage: 'individual',
      participantNumber: p,
      label: 'Player ' + (p < 10 ? '0' + p : p),
      totalScore: 0,
      correctCount: 0,
      wrongCount: 0,
      bannedRound: null,
      bannedQuestionsList: [],
      bannedQuestions: '',
      luckyBellUsedRound: null,
      goldenGambleCount: 0,
      updatedAt: new Date().toISOString()
    };
    participantsMap['individual:' + p] = pObj;
    participants.push(pObj);
  }

  var sortedScores = scores.slice().sort(function(a, b) {
    return a.roundNumber - b.roundNumber;
  });

  for (var i = 0; i < sortedScores.length; i++) {
    var s = sortedScores[i];
    var key = s.stage + ':' + s.participantNumber;
    var item = participantsMap[key];
    if (!item) continue;

    item.totalScore += s.finalDelta;
    if (s.isCorrect) {
      item.correctCount += 1;
      item.bannedRound = null;
    } else {
      item.wrongCount += 1;
      item.bannedRound = s.roundNumber + 1;
      item.bannedQuestionsList.push('Q' + (s.roundNumber + 1));
    }
    if (s.boosterType === 'lucky_bell') {
      item.luckyBellUsedRound = s.roundNumber;
    }
    if (s.boosterType === 'star_of_hope') {
      item.goldenGambleCount += 1;
    }
  }

  for (var idx = 0; idx < participants.length; idx++) {
    participants[idx].bannedQuestions = participants[idx].bannedQuestionsList.join(', ');
    delete participants[idx].bannedQuestionsList;
  }

  return {
    ok: true,
    event: {
      id: 'evt_sheets',
      name: cfg.name,
      teamCount: cfg.teamCount,
      individualCount: cfg.individualCount,
      questionPoints: cfg.questionPoints,
      resetVersion: cfg.resetVersion,
      createdAt: new Date().toISOString()
    },
    participants: participants,
    scores: scores
  };
}

function syncBothLeaderboards(ss, participants) {
  syncLeaderboardSheet(ss, 'Team_Leaderboard', participants.filter(function(p) { return p.stage === 'team'; }));
  syncLeaderboardSheet(ss, 'Individual_Leaderboard', participants.filter(function(p) { return p.stage === 'individual'; }));
}

function syncLeaderboardSheet(ss, sheetName, rows) {
  var sheet = getOrCreateSheet(ss, sheetName, LEADERBOARD_HEADERS);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, LEADERBOARD_HEADERS.length).clearContent();
  }
  if (!rows || rows.length === 0) return;

  var sorted = rows.slice().sort(function(a, b) {
    return (b.totalScore - a.totalScore) || (b.correctCount - a.correctCount) || (a.participantNumber - b.participantNumber);
  });

  var matrix = sorted.map(function(p, idx) {
    var bannedDisplay = p.bannedQuestions || (p.bannedRound ? ('Q' + p.bannedRound) : '');
    return [
      idx + 1,
      p.participantNumber,
      p.label,
      p.totalScore,
      p.correctCount,
      p.wrongCount,
      bannedDisplay,
      p.luckyBellUsedRound ? ('Q' + p.luckyBellUsedRound) : '',
      p.goldenGambleCount || 0
    ];
  });

  sheet.getRange(2, 1, matrix.length, LEADERBOARD_HEADERS.length).setValues(matrix);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`;
