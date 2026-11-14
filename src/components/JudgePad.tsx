import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Ban,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Lock,
  RotateCcw,
  SkipForward,
  Star,
  Undo2,
  X,
} from 'lucide-react';
import type { CompetitionEvent, JudgeSession, Participant, ScoreEvent } from '../types.ts';

interface JudgePadProps {
  event: CompetitionEvent;
  session: JudgeSession;
  participants: Participant[];
  recentScores: ScoreEvent[];
  onScoreSubmit: (payload: {
    stage: 'team' | 'individual';
    roundNumber: number;
    participantNumber: number;
    isCorrect: boolean;
    useLuckyBell: boolean;
    useGoldenGamble: boolean;
  }) => Promise<void>;
  onUndoLast: (scoreId?: string) => Promise<void>;
  onUpdateSessionParams: (params: { roundNumber?: number; currentNumber?: number }) => Promise<void>;
  onOpenNewSession: () => void;
  pendingSyncCount: number;
  onSyncNow: () => Promise<{ synced: number; failed: number }>;
}

export const JudgePad: React.FC<JudgePadProps> = ({
  event,
  session,
  participants,
  recentScores,
  onScoreSubmit,
  onUndoLast,
  onUpdateSessionParams,
  onOpenNewSession,
  pendingSyncCount,
  onSyncNow,
}) => {
  const [activeNumber, setActiveNumber] = useState<number>(session.rangeStart || 1);
  const [useLuckyBell, setUseLuckyBell] = useState(false);
  const [useGoldenGamble, setUseGoldenGamble] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const latestResumeDataRef = useRef({ participants, recentScores });
  latestResumeDataRef.current = { participants, recentScores };

  useEffect(() => {
    const { participants: allParticipants, recentScores: allScores } = latestResumeDataRef.current;
    const scoredSet = new Set<number>();
    for (const s of allScores) {
      if (s.stage === session.stage && s.roundNumber === session.roundNumber) {
        scoredSet.add(s.participantNumber);
      }
    }
    const bannedSet = new Set<number>();
    for (const p of allParticipants) {
      if (p.stage === session.stage && p.bannedRound === session.roundNumber) {
        bannedSet.add(p.participantNumber);
      }
    }

    let firstPending: number | null = null;
    for (let n = session.rangeStart; n <= session.rangeEnd; n++) {
      if (!scoredSet.has(n) && !bannedSet.has(n)) {
        firstPending = n;
        break;
      }
    }

    setActiveNumber(firstPending ?? (session.rangeStart || 1));
    setUseLuckyBell(false);
    setUseGoldenGamble(false);
  }, [session.id, session.stage, session.roundNumber, session.rangeStart, session.rangeEnd]);

  useEffect(() => {
    setUseLuckyBell(false);
    setUseGoldenGamble(false);
  }, [activeNumber, session.roundNumber]);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 2400);
    return () => clearTimeout(timer);
  }, [feedback]);

  const stageParticipants = useMemo(
    () =>
      participants
        .filter(
          (p) =>
            p.stage === session.stage &&
            p.participantNumber >= session.rangeStart &&
            p.participantNumber <= session.rangeEnd
        )
        .sort((a, b) => a.participantNumber - b.participantNumber),
    [participants, session.stage, session.rangeStart, session.rangeEnd]
  );

  const currentParticipant = useMemo(
    () => stageParticipants.find((p) => p.participantNumber === activeNumber) ?? stageParticipants[0],
    [stageParticipants, activeNumber]
  );

  const roundScoresMap = useMemo(() => {
    const map = new Map<number, ScoreEvent>();
    for (const s of recentScores) {
      if (s.stage === session.stage && s.roundNumber === session.roundNumber) {
        map.set(s.participantNumber, s);
      }
    }
    return map;
  }, [recentScores, session.stage, session.roundNumber]);

  const roundTally = useMemo(() => {
    let correct = 0;
    let wrong = 0;
    for (const s of roundScoresMap.values()) {
      if (s.participantNumber >= session.rangeStart && s.participantNumber <= session.rangeEnd) {
        if (s.isCorrect) correct++;
        else wrong++;
      }
    }
    const banned = stageParticipants.filter((p) => p.bannedRound === session.roundNumber).length;
    const eligibleCount = Math.max(0, stageParticipants.length - banned);
    const evaluated = correct + wrong;
    return { correct, wrong, banned, evaluated, eligibleCount };
  }, [roundScoresMap, stageParticipants, session.rangeStart, session.rangeEnd, session.roundNumber]);

  const questionPoints = event.questionPoints[session.roundNumber - 1] ?? 1;
  const isLuckyVisible = session.roundNumber >= 11 && session.roundNumber <= 15;
  const isStarVisible = session.roundNumber >= 16;
  const luckyAlreadyUsed =
    currentParticipant?.luckyBellUsedRound !== null && currentParticipant?.luckyBellUsedRound !== undefined;
  const isBannedThisRound = currentParticipant?.bannedRound === session.roundNumber;
  const currentAlreadyScored = roundScoresMap.get(activeNumber);

  const effectiveLuckyBell = isLuckyVisible && !luckyAlreadyUsed && useLuckyBell;
  const effectiveStarOfHope = isStarVisible && useGoldenGamble;

  const projectedCorrectPoints = questionPoints + (effectiveLuckyBell ? 3 : 0) + (effectiveStarOfHope ? 5 : 0);
  const projectedWrongPoints = (effectiveLuckyBell ? 3 : 0) + (effectiveStarOfHope ? -3 : 0);

  function findNextCandidate(fromNumber: number): number | null {
    for (let n = fromNumber + 1; n <= session.rangeEnd; n++) {
      const p = stageParticipants.find((item) => item.participantNumber === n);
      const banned = p?.bannedRound === session.roundNumber;
      const scored = roundScoresMap.has(n);
      if (!scored && !banned) return n;
    }
    for (let n = session.rangeStart; n < fromNumber; n++) {
      const p = stageParticipants.find((item) => item.participantNumber === n);
      const banned = p?.bannedRound === session.roundNumber;
      const scored = roundScoresMap.has(n);
      if (!scored && !banned) return n;
    }
    return null;
  }

  async function handleScore(isCorrect: boolean) {
    if (!currentParticipant || submitting || isBannedThisRound || currentAlreadyScored) return;

    setSubmitting(true);
    setFeedback(null);

    try {
      await onScoreSubmit({
        stage: session.stage,
        roundNumber: session.roundNumber,
        participantNumber: currentParticipant.participantNumber,
        isCorrect,
        useLuckyBell: effectiveLuckyBell,
        useGoldenGamble: effectiveStarOfHope,
      });

      const next = findNextCandidate(currentParticipant.participantNumber);
      setActiveNumber(next !== null ? next : session.rangeStart);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to record score',
      });
    } finally {
      setSubmitting(false);
    }
  }

  function stepNumber(delta: number) {
    const next = activeNumber + delta;
    if (next < session.rangeStart) setActiveNumber(session.rangeEnd);
    else if (next > session.rangeEnd) setActiveNumber(session.rangeStart);
    else setActiveNumber(next);
  }

  async function handleAdvanceNextQuestion() {
    if (session.roundNumber >= 20) {
      const res = await onSyncNow();
      setFeedback({
        type: 'success',
        text: res.synced > 0 ? `Synced ${res.synced} scores to Google Sheet` : 'All Q20 scores saved',
      });
      return;
    }
    const nextQ = session.roundNumber + 1;
    await onUpdateSessionParams({
      roundNumber: nextQ,
      currentNumber: session.rangeStart,
    });
    setFeedback({
      type: 'success',
      text: `Saved Q${session.roundNumber} · Question ${nextQ}/20 (+${event.questionPoints[nextQ - 1] ?? 1} pts)`,
    });
  }

  const allEvaluated = roundTally.evaluated >= roundTally.eligibleCount && roundTally.eligibleCount > 0;
  const latestScore = recentScores.find(
    (s) => s.stage === session.stage && s.roundNumber === session.roundNumber && s.sessionId === session.id
  );
  const isSplitRange = session.rangeStart > 1 || session.rangeEnd < session.selectionSize;

  return (
    <div className="mx-auto w-full max-w-2xl px-3 sm:px-6 py-3 sm:py-5 pb-20 md:pb-8">
      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6">
        {/* Compact Mobile Context Bar */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-1.5 text-xs sm:text-sm font-medium text-slate-600 min-w-0">
            <span className="font-bold text-slate-900 truncate">
              {session.stage === 'team' ? 'Team' : 'Individual'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900">
              Q{String(session.roundNumber).padStart(2, '0')}/20
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums font-semibold text-amber-700">
              +{questionPoints}p
            </span>
          </div>

          <button
            type="button"
            onClick={onOpenNewSession}
            className="px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
          >
            {isSplitRange ? `Range ${session.rangeStart}–${session.rangeEnd}` : `Session 1–${session.selectionSize}`}
          </button>
        </div>

        {/* CENTER TOP: Single Resized Participant Identifier + Points */}
        <div className="py-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => stepNumber(-1)}
            aria-label="Previous participant"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 active:scale-95 text-slate-700 transition-transform"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="flex flex-col items-center text-center min-w-0">
            <div className="font-display tabular-nums text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
              {session.stage === 'team' ? 'Team' : 'Player'} {String(activeNumber).padStart(2, '0')}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-600 font-mono tabular-nums">
              <span>
                Total: <strong className="text-slate-900">{currentParticipant?.totalScore ?? 0} pts</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Round: <strong className="text-amber-700">+{questionPoints} pts</strong>
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => stepNumber(1)}
            aria-label="Next participant"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 active:scale-95 text-slate-700 transition-transform"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Boosters: Lucky Bell in Q11-Q15; hidden once Star of Hope appears in Q16-Q20 */}
        {(isLuckyVisible || isStarVisible) && (
          <div className="mb-3.5">
            {isLuckyVisible && (
              <button
                type="button"
                disabled={luckyAlreadyUsed || isBannedThisRound || Boolean(currentAlreadyScored)}
                onClick={() => setUseLuckyBell((v) => !v)}
                className={`w-full min-h-[48px] px-3.5 py-2 rounded-xl border text-left transition-all flex items-center justify-between gap-2 ${
                  luckyAlreadyUsed
                    ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                    : useLuckyBell
                      ? 'bg-amber-50 border-amber-500 text-amber-950 ring-2 ring-amber-400/40'
                      : 'bg-white border-slate-200 text-slate-800'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-bold whitespace-nowrap">
                    <Bell className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Lucky Bell</span>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums truncate">
                    {luckyAlreadyUsed ? `Used Q${currentParticipant?.luckyBellUsedRound}` : '+3 pts once (Q11–Q15)'}
                  </div>
                </div>
                {luckyAlreadyUsed ? (
                  <Lock className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                ) : (
                  <span className="text-xs font-bold font-mono shrink-0">{useLuckyBell ? 'ON' : 'OFF'}</span>
                )}
              </button>
            )}

            {isStarVisible && (
              <button
                type="button"
                disabled={isBannedThisRound || Boolean(currentAlreadyScored)}
                onClick={() => {
                  const next = !useGoldenGamble;
                  setUseGoldenGamble(next);
                  setUseLuckyBell(false);
                }}
                className={`w-full min-h-[48px] px-3.5 py-2 rounded-xl border text-left transition-all flex items-center justify-between gap-2 ${
                  useGoldenGamble
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-white border-slate-200 text-slate-800'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-bold whitespace-nowrap">
                    <Star className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Star of Hope</span>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums truncate">+5 correct / -3 wrong</div>
                </div>
                <span className="text-xs font-bold font-mono shrink-0">{useGoldenGamble ? 'ON' : 'OFF'}</span>
              </button>
            )}
          </div>
        )}

        {/* TWO LARGE BOXES: RED (WRONG) & GREEN (CORRECT) */}
        {isBannedThisRound ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-center space-y-3">
            <div className="mx-auto w-11 h-11 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center">
              <Ban className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                #{String(activeNumber).padStart(2, '0')} Banned for Q{session.roundNumber}
              </h3>
              <p className="text-xs text-slate-700 mt-1">
                Wrong answer in Q{session.roundNumber - 1}. Resumes in Q{Math.min(20, session.roundNumber + 1)}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const next = findNextCandidate(activeNumber);
                setActiveNumber(next ?? session.rangeStart);
              }}
              className="w-full py-3 rounded-xl bg-slate-900 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 min-h-[48px]"
            >
              <SkipForward className="w-4 h-4" />
              <span>Next Participant</span>
            </button>
          </div>
        ) : currentAlreadyScored ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center space-y-3">
            <div className="mx-auto w-11 h-11 rounded-full bg-slate-200 text-slate-800 flex items-center justify-center">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                #{String(activeNumber).padStart(2, '0')} Scored for Q{session.roundNumber}
              </h3>
              <p className="text-xs text-slate-600 mt-1 font-mono tabular-nums">
                {currentAlreadyScored.isCorrect ? 'CORRECT' : 'WRONG'} (
                {currentAlreadyScored.finalDelta >= 0 ? '+' : ''}
                {currentAlreadyScored.finalDelta} pts)
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => void onUndoLast(currentAlreadyScored.id)}
                className="py-2.5 rounded-xl border border-slate-300 bg-white text-slate-800 font-semibold text-xs inline-flex items-center justify-center gap-1.5 min-h-[44px]"
              >
                <Undo2 className="w-4 h-4" />
                <span>Undo</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = findNextCandidate(activeNumber);
                  if (next !== null) setActiveNumber(next);
                }}
                className="py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-xs inline-flex items-center justify-center gap-1.5 min-h-[44px]"
              >
                <SkipForward className="w-4 h-4" />
                <span>Next Unscored</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleScore(false)}
              className="flex flex-col items-center justify-center rounded-2xl bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white p-4 min-h-[164px] sm:min-h-[196px] transition-all disabled:opacity-60"
            >
              <div className="w-12 h-12 rounded-full bg-white/15 flex items-center justify-center mb-2.5">
                <X className="w-7 h-7 stroke-[3]" />
              </div>
              <span className="font-display text-xl sm:text-2xl font-bold tracking-tight">WRONG</span>
              <span className="mt-1 text-xs font-medium text-red-100 font-mono tabular-nums">
                {projectedWrongPoints !== 0 ? `${projectedWrongPoints}p · ` : ''}Ban 1 Q
              </span>
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleScore(true)}
              className="flex flex-col items-center justify-center rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white p-4 min-h-[164px] sm:min-h-[196px] transition-all disabled:opacity-60"
            >
              <div className="w-12 h-12 rounded-full bg-white/15 flex items-center justify-center mb-2.5">
                <Check className="w-7 h-7 stroke-[3]" />
              </div>
              <span className="font-display text-xl sm:text-2xl font-bold tracking-tight">CORRECT</span>
              <span className="mt-1 text-xs font-medium text-emerald-100 font-mono tabular-nums">
                +{projectedCorrectPoints} pts
              </span>
            </button>
          </div>
        )}

        {feedback && (
          <div
            role="status"
            className={`mt-3 px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                : 'bg-red-50 text-red-900 border border-red-200'
            }`}
          >
            {feedback.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            ) : (
              <Check className="w-4 h-4 shrink-0" />
            )}
            <span className="truncate">{feedback.text}</span>
          </div>
        )}

        {/* CLEAR TALLY DISPLAYED BELOW */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 py-2 px-1">
              <div className="text-[11px] font-medium text-emerald-800">Correct</div>
              <div className="font-mono tabular-nums text-xl font-bold text-emerald-700 mt-0.5">
                {roundTally.correct}
              </div>
            </div>

            <div className="rounded-xl bg-red-50 border border-red-100 py-2 px-1">
              <div className="text-[11px] font-medium text-red-800">Wrong</div>
              <div className="font-mono tabular-nums text-xl font-bold text-red-700 mt-0.5">
                {roundTally.wrong}
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 border border-amber-100 py-2 px-1">
              <div className="text-[11px] font-medium text-amber-800">Banned</div>
              <div className="font-mono tabular-nums text-xl font-bold text-amber-700 mt-0.5">
                {roundTally.banned}
              </div>
            </div>

            <div className="rounded-xl bg-slate-100 border border-slate-200 py-2 px-1">
              <div className="text-[11px] font-medium text-slate-600">Checked</div>
              <div className="font-mono tabular-nums text-xl font-bold text-slate-900 mt-0.5">
                {roundTally.evaluated}/{roundTally.eligibleCount}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={!latestScore}
              onClick={() => void onUndoLast(latestScore?.id)}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 min-h-[42px] disabled:opacity-40"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Undo Last</span>
            </button>

            <button
              type="button"
              onClick={() => void handleAdvanceNextQuestion()}
              className={`px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 min-h-[42px] transition-colors whitespace-nowrap ${
                allEvaluated
                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                  : 'bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{session.roundNumber >= 20 ? 'Save Q20 to Sheet' : `Next Q${session.roundNumber + 1}`}</span>
            </button>
          </div>
          {pendingSyncCount > 0 && (
            <div className="mt-2 text-[11px] text-slate-500 text-right font-mono tabular-nums">
              {pendingSyncCount} queued · Sends to Google Sheet on {session.roundNumber >= 20 ? 'Save Q20' : `Next Q${session.roundNumber + 1}`}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
