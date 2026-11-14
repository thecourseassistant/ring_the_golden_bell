import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CheckSquare, Settings, Trophy } from 'lucide-react';
import type { CompetitionEvent, JudgeSession, ScoreEvent, StageType } from './types.ts';
import { JudgePad } from './components/JudgePad.tsx';
import { Scoreboard } from './components/Scoreboard.tsx';
import { TrendsDashboard } from './components/TrendsDashboard.tsx';
import { SheetsSetup } from './components/SheetsSetup.tsx';
import { SessionModal } from './components/SessionModal.tsx';
import {
  buildAppSnapshot,
  createDefaultEvent,
  createDefaultSession,
  validateAndCreateLocalScore,
} from './lib/scoringEngine.ts';
import { callAppsScript } from './lib/appsScriptClient.ts';

type NavTab = 'judge' | 'scoreboard' | 'trends' | 'setup';

const STORAGE_KEYS = {
  event: 'gb_static_event_v1',
  session: 'gb_static_session_v1',
  synced: 'gb_static_synced_scores_v1',
  pending: 'gb_static_pending_scores_v1',
  failed: 'gb_static_failed_scores_v1',
  resetVersion: 'gb_static_reset_version_v1',
};

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonStorage<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota issues
  }
}

function getInitialSheetUrlFromQuery(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const sheetParam = params.get('sheet');
    if (sheetParam && sheetParam.startsWith('https://script.google.com/')) {
      return sheetParam.trim();
    }
  } catch {
    // Ignore
  }
  return '';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('judge');
  const [sessionModalOpen, setSessionModalOpen] = useState(false);

  const [event, setEvent] = useState<CompetitionEvent>(() => {
    const queryUrl = getInitialSheetUrlFromQuery();
    const saved = readJsonStorage<CompetitionEvent | null>(STORAGE_KEYS.event, null);
    if (saved) {
      return queryUrl ? { ...saved, appsScriptUrl: queryUrl } : saved;
    }
    return createDefaultEvent(queryUrl);
  });

  const [session, setSession] = useState<JudgeSession>(() => {
    const saved = readJsonStorage<JudgeSession | null>(STORAGE_KEYS.session, null);
    if (saved) return saved;
    return createDefaultSession(15);
  });

  const [syncedScores, setSyncedScores] = useState<ScoreEvent[]>(() =>
    readJsonStorage<ScoreEvent[]>(STORAGE_KEYS.synced, [])
  );
  const [pendingScores, setPendingScores] = useState<ScoreEvent[]>(() =>
    readJsonStorage<ScoreEvent[]>(STORAGE_KEYS.pending, [])
  );
  const [failedScores, setFailedScores] = useState<ScoreEvent[]>(() =>
    readJsonStorage<ScoreEvent[]>(STORAGE_KEYS.failed, [])
  );
  const [resetVersion, setResetVersion] = useState<number>(() =>
    readJsonStorage<number>(STORAGE_KEYS.resetVersion, 0)
  );

  const [sheetStatus, setSheetStatus] = useState<'local' | 'connected' | 'syncing' | 'error'>(() =>
    event.appsScriptUrl ? 'connected' : 'local'
  );
  const [syncBannerError, setSyncBannerError] = useState<string | null>(null);

  useEffect(() => {
    writeJsonStorage(STORAGE_KEYS.event, event);
  }, [event]);

  useEffect(() => {
    writeJsonStorage(STORAGE_KEYS.session, session);
  }, [session]);

  useEffect(() => {
    writeJsonStorage(STORAGE_KEYS.synced, syncedScores);
  }, [syncedScores]);

  useEffect(() => {
    writeJsonStorage(STORAGE_KEYS.pending, pendingScores);
  }, [pendingScores]);

  useEffect(() => {
    writeJsonStorage(STORAGE_KEYS.failed, failedScores);
  }, [failedScores]);

  useEffect(() => {
    writeJsonStorage(STORAGE_KEYS.resetVersion, resetVersion);
  }, [resetVersion]);

  const snapshot = useMemo(
    () => buildAppSnapshot(event, session, syncedScores, pendingScores, failedScores),
    [event, session, syncedScores, pendingScores, failedScores]
  );

  const stateRef = useRef({
    event,
    session,
    syncedScores,
    pendingScores,
    failedScores,
    resetVersion,
  });
  stateRef.current = {
    event,
    session,
    syncedScores,
    pendingScores,
    failedScores,
    resetVersion,
  };

  const applyRemotePayload = useCallback(
    (payload: {
      event?: CompetitionEvent & { resetVersion?: number };
      scores?: ScoreEvent[];
    }) => {
      const remoteEvent = payload.event;
      const remoteScores = Array.isArray(payload.scores) ? payload.scores : null;
      const currentUrl = stateRef.current.event.appsScriptUrl;

      if (remoteEvent) {
        setEvent((prev) => ({
          ...prev,
          name: remoteEvent.name || prev.name,
          teamCount: remoteEvent.teamCount || prev.teamCount,
          individualCount: remoteEvent.individualCount || prev.individualCount,
          questionPoints:
            Array.isArray(remoteEvent.questionPoints) && remoteEvent.questionPoints.length === 20
              ? remoteEvent.questionPoints
              : prev.questionPoints,
          appsScriptUrl: currentUrl,
        }));

        const remoteReset = Number(remoteEvent.resetVersion ?? 0);
        if (remoteReset > stateRef.current.resetVersion) {
          setResetVersion(remoteReset);
          setPendingScores([]);
          setFailedScores([]);
          setSession((prev) => ({
            ...prev,
            roundNumber: 1,
            currentNumber: prev.rangeStart,
          }));
        }
      }

      if (remoteScores) {
        const remoteTxIds = new Set(remoteScores.map((s) => s.clientTxId));
        setSyncedScores(remoteScores);
        setPendingScores((prev) => prev.filter((s) => !remoteTxIds.has(s.clientTxId)));
        setFailedScores((prev) => prev.filter((s) => !remoteTxIds.has(s.clientTxId)));
      }
    },
    []
  );

  const isPollingRef = useRef(false);

  const refreshFromSheet = useCallback(async () => {
    const url = stateRef.current.event.appsScriptUrl.trim();
    if (!url || isPollingRef.current) {
      if (!url) setSheetStatus('local');
      return;
    }
    isPollingRef.current = true;
    try {
      const res = await callAppsScript(url, { type: 'get_state' }, 25000);
      applyRemotePayload(res);
      setSheetStatus('connected');
      setSyncBannerError(null);
    } catch (err) {
      setSheetStatus('error');
      setSyncBannerError(err instanceof Error ? err.message : 'Unable to reach Google Sheet');
    } finally {
      isPollingRef.current = false;
    }
  }, [applyRemotePayload]);

  useEffect(() => {
    if (!event.appsScriptUrl.trim()) {
      setSheetStatus('local');
      return;
    }

    void refreshFromSheet();

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshFromSheet();
      }
    }, 12000);

    return () => clearInterval(timer);
  }, [event.appsScriptUrl, refreshFromSheet]);

  const flushToSheet = useCallback(
    async (onlySessionId?: string): Promise<{ synced: number; failed: number }> => {
      const url = stateRef.current.event.appsScriptUrl.trim();
      if (!url) {
        return { synced: 0, failed: 0 };
      }

      const combinedQueue = [...stateRef.current.failedScores, ...stateRef.current.pendingScores];
      const toSend = onlySessionId
        ? combinedQueue.filter((item) => item.sessionId === onlySessionId)
        : combinedQueue;

      if (toSend.length === 0) {
        return { synced: 0, failed: 0 };
      }

      const toSendIds = new Set(toSend.map((s) => s.clientTxId));
      setSheetStatus('syncing');

      try {
        const records = toSend.map((s) => ({
          clientTxId: s.clientTxId,
          createdAt: s.createdAt,
          eventName: stateRef.current.event.name,
          stage: s.stage,
          roundNumber: s.roundNumber,
          participantNumber: s.participantNumber,
          participantLabel: `${s.stage === 'team' ? 'Team' : 'Player'} ${String(s.participantNumber).padStart(2, '0')}`,
          isCorrect: s.isCorrect,
          boosterType: s.boosterType,
          sessionId: s.sessionId,
        }));

        const res = await callAppsScript(url, { type: 'batch_sync', records }, 18000);
        applyRemotePayload(res);

        // Remove sent items from local queues (including any rejected duplicates already in Sheet)
        setPendingScores((prev) => prev.filter((s) => !toSendIds.has(s.clientTxId)));
        setFailedScores((prev) => prev.filter((s) => !toSendIds.has(s.clientTxId)));
        setSheetStatus('connected');
        setSyncBannerError(null);

        const rejectedCount = Array.isArray(res.rejected) ? res.rejected.length : 0;
        if (rejectedCount > 0 && res.rejected) {
          setSyncBannerError(res.rejected.map((r) => r.reason).join(' · '));
        }

        return { synced: res.appended ?? toSend.length, failed: rejectedCount };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Sync failed';
        setPendingScores((prev) => prev.filter((s) => !toSendIds.has(s.clientTxId)));
        setFailedScores((prev) => {
          const existingIds = new Set(prev.map((x) => x.clientTxId));
          return [...prev, ...toSend.filter((x) => !existingIds.has(x.clientTxId))];
        });
        setSheetStatus('error');
        setSyncBannerError(msg);
        return { synced: 0, failed: toSend.length };
      }
    },
    [applyRemotePayload]
  );

  async function handleScoreSubmit(payload: {
    stage: StageType;
    roundNumber: number;
    participantNumber: number;
    isCorrect: boolean;
    useLuckyBell: boolean;
    useGoldenGamble: boolean;
  }) {
    const newScore = validateAndCreateLocalScore({
      event: snapshot.event,
      session: snapshot.activeSession,
      participants: snapshot.participants,
      allScores: snapshot.recentScores,
      ...payload,
    });

    setPendingScores((prev) => [newScore, ...prev]);
  }

  async function handleUndoLast(scoreId?: string) {
    const target = scoreId
      ? snapshot.recentScores.find((s) => s.id === scoreId || s.clientTxId === scoreId)
      : snapshot.recentScores.find(
          (s) =>
            s.stage === session.stage &&
            s.roundNumber === session.roundNumber &&
            s.sessionId === session.id
        );

    if (!target) return;

    const isPendingOrFailed =
      pendingScores.some((s) => s.clientTxId === target.clientTxId) ||
      failedScores.some((s) => s.clientTxId === target.clientTxId);

    if (isPendingOrFailed) {
      setPendingScores((prev) => prev.filter((s) => s.clientTxId !== target.clientTxId));
      setFailedScores((prev) => prev.filter((s) => s.clientTxId !== target.clientTxId));
      return;
    }

    // Already synced to Google Sheets: remove from Sheet via Apps Script
    const url = event.appsScriptUrl.trim();
    if (url) {
      setSheetStatus('syncing');
      try {
        const res = await callAppsScript(url, {
          type: 'undo_score',
          clientTxId: target.clientTxId,
        });
        applyRemotePayload(res);
        setSheetStatus('connected');
        setSyncBannerError(null);
      } catch (err) {
        setSheetStatus('error');
        setSyncBannerError(err instanceof Error ? err.message : 'Unable to undo synced score');
      }
    } else {
      setSyncedScores((prev) => prev.filter((s) => s.clientTxId !== target.clientTxId));
    }
  }

  async function handleStartSession(input: {
    stage: StageType;
    roundNumber: number;
    selectionSize: number;
    rangeStart: number;
    rangeEnd: number;
  }) {
    const selectionSize = Math.max(1, Math.min(500, Math.floor(input.selectionSize)));
    const rangeStart = Math.max(1, Math.min(selectionSize, Math.floor(input.rangeStart)));
    const rangeEnd = Math.max(rangeStart, Math.min(selectionSize, Math.floor(input.rangeEnd)));
    const roundNumber = Math.max(1, Math.min(20, Math.floor(input.roundNumber)));

    setEvent((prev) => {
      if (input.stage === 'team' && selectionSize > prev.teamCount) {
        return { ...prev, teamCount: selectionSize };
      }
      if (input.stage === 'individual' && selectionSize > prev.individualCount) {
        return { ...prev, individualCount: selectionSize };
      }
      return prev;
    });

    setSession({
      id: `sess_${crypto.randomUUID().slice(0, 10)}`,
      eventId: event.id,
      stage: input.stage,
      roundNumber,
      selectionSize,
      rangeStart,
      rangeEnd,
      currentNumber: rangeStart,
      status: 'active',
      createdAt: new Date().toISOString(),
    });
  }

  async function handleUpdateSessionParams(params: { roundNumber?: number; currentNumber?: number }) {
    const prevRound = session.roundNumber;
    const nextRound =
      params.roundNumber !== undefined
        ? Math.max(1, Math.min(20, Math.floor(params.roundNumber)))
        : session.roundNumber;
    const nextCurrent =
      params.currentNumber !== undefined
        ? Math.max(1, Math.min(session.selectionSize, Math.floor(params.currentNumber)))
        : session.currentNumber;

    setSession((prev) => ({
      ...prev,
      roundNumber: nextRound,
      currentNumber: nextCurrent,
    }));

    if (nextRound > prevRound) {
      void flushToSheet(session.id);
    }
  }

  async function handleSaveConfig(input: Partial<CompetitionEvent>) {
    const nextEvent: CompetitionEvent = {
      ...event,
      name: (input.name ?? event.name).trim() || event.name,
      teamCount: Math.max(1, Math.min(500, Math.floor(input.teamCount ?? event.teamCount))),
      individualCount: Math.max(1, Math.min(500, Math.floor(input.individualCount ?? event.individualCount))),
      questionPoints:
        Array.isArray(input.questionPoints) && input.questionPoints.length === 20
          ? input.questionPoints.map((n) => Math.max(0, Math.min(100, Math.floor(Number(n) || 0))))
          : event.questionPoints,
      appsScriptUrl: (input.appsScriptUrl ?? event.appsScriptUrl).trim(),
    };

    setEvent(nextEvent);

    if (nextEvent.appsScriptUrl) {
      setSheetStatus('syncing');
      const res = await callAppsScript(nextEvent.appsScriptUrl, {
        type: 'save_config',
        config: {
          name: nextEvent.name,
          teamCount: nextEvent.teamCount,
          individualCount: nextEvent.individualCount,
          questionPoints: nextEvent.questionPoints,
        },
      });
      stateRef.current.event = nextEvent;
      applyRemotePayload(res);
      setSheetStatus('connected');
      setSyncBannerError(null);
    } else {
      setSheetStatus('local');
    }
  }

  async function handleResetEvent() {
    setSyncedScores([]);
    setPendingScores([]);
    setFailedScores([]);
    setSession((prev) => ({
      ...prev,
      roundNumber: 1,
      currentNumber: prev.rangeStart,
    }));

    const url = event.appsScriptUrl.trim();
    if (url) {
      setSheetStatus('syncing');
      try {
        const res = await callAppsScript(url, { type: 'reset_event' });
        applyRemotePayload(res);
        setSheetStatus('connected');
        setSyncBannerError(null);
      } catch (err) {
        setSheetStatus('error');
        setSyncBannerError(err instanceof Error ? err.message : 'Failed to reset Google Sheet');
      }
    }
  }

  async function handleSyncNow() {
    return flushToSheet();
  }

  const navItems: { id: NavTab; label: string; icon: typeof CheckSquare }[] = [
    { id: 'judge', label: 'Judge', icon: CheckSquare },
    { id: 'scoreboard', label: 'Scores', icon: Trophy },
    { id: 'trends', label: 'Trends', icon: BarChart3 },
    { id: 'setup', label: 'Sheets', icon: Settings },
  ];

  function handleTabChange(nextTab: NavTab) {
    setActiveTab(nextTab);
    if (nextTab !== 'judge' && event.appsScriptUrl.trim()) {
      void refreshFromSheet();
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 h-12 md:h-14 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => handleTabChange('judge')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Golden Bell
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleTabChange(item.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  activeTab === item.id
                    ? 'text-slate-900 font-semibold border-amber-600'
                    : 'border-transparent hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setSessionModalOpen(true)}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
            >
              New Session
            </button>
          </div>
        </div>
      </header>

      {syncBannerError && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-xs text-red-800 flex items-center justify-between gap-3">
          <span className="truncate">{syncBannerError}</span>
          <button
            type="button"
            onClick={() => setSyncBannerError(null)}
            className="font-semibold underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <main className="flex-1">
        {activeTab === 'judge' && (
          <JudgePad
            event={snapshot.event}
            session={snapshot.activeSession}
            participants={snapshot.participants}
            recentScores={snapshot.recentScores}
            onScoreSubmit={handleScoreSubmit}
            onUndoLast={handleUndoLast}
            onUpdateSessionParams={handleUpdateSessionParams}
            onOpenNewSession={() => setSessionModalOpen(true)}
            pendingSyncCount={snapshot.syncStats.pending + snapshot.syncStats.failed}
            onSyncNow={handleSyncNow}
          />
        )}

        {activeTab === 'scoreboard' && (
          <Scoreboard participants={snapshot.participants} session={snapshot.activeSession} />
        )}

        {activeTab === 'trends' && (
          <TrendsDashboard
            event={snapshot.event}
            participants={snapshot.participants}
            scores={snapshot.recentScores}
            onRefresh={refreshFromSheet}
            onNavigateJudge={() => handleTabChange('judge')}
          />
        )}

        {activeTab === 'setup' && (
          <SheetsSetup
            event={snapshot.event}
            scores={snapshot.recentScores}
            syncStats={snapshot.syncStats}
            onSaveConfig={handleSaveConfig}
            onResetEvent={handleResetEvent}
            onSyncNow={handleSyncNow}
          />
        )}
      </main>

      <footer className="hidden md:block border-t border-slate-200 bg-white py-3 px-6 text-xs text-slate-500">
        <div className="mx-auto max-w-5xl flex items-center justify-between">
          <span>{snapshot.event.name}</span>
          <span className="font-mono tabular-nums">
            Google Sheet:{' '}
            {sheetStatus === 'connected'
              ? 'Connected'
              : sheetStatus === 'syncing'
                ? 'Syncing...'
                : sheetStatus === 'error'
                  ? 'Sync Error'
                  : 'Local Only'}
          </span>
        </div>
      </footer>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-4 items-center"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleTabChange(item.id)}
              className={`h-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? 'text-amber-700 font-semibold' : 'text-slate-500'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] leading-none whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <SessionModal
        open={sessionModalOpen}
        event={snapshot.event}
        session={snapshot.activeSession}
        onClose={() => setSessionModalOpen(false)}
        onStartSession={handleStartSession}
      />
    </div>
  );
}
