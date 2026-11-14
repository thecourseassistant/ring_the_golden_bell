import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { CompetitionEvent, JudgeSession, StageType } from '../types.ts';

interface SessionModalProps {
  open: boolean;
  event: CompetitionEvent;
  session: JudgeSession;
  onClose: () => void;
  onStartSession: (input: {
    stage: StageType;
    roundNumber: number;
    selectionSize: number;
    rangeStart: number;
    rangeEnd: number;
  }) => Promise<void>;
}

export const SessionModal: React.FC<SessionModalProps> = ({
  open,
  event,
  session,
  onClose,
  onStartSession,
}) => {
  const [stage, setStage] = useState<StageType>(session.stage);
  const [roundNumber, setRoundNumber] = useState<number>(session.roundNumber);
  const [selectionSize, setSelectionSize] = useState<number>(
    session.stage === 'team' ? event.teamCount : event.individualCount
  );
  const [rangeStart, setRangeStart] = useState<number>(session.rangeStart || 1);
  const [rangeEnd, setRangeEnd] = useState<number>(
    session.rangeEnd || (session.stage === 'team' ? event.teamCount : event.individualCount)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStage(session.stage);
    setRoundNumber(session.roundNumber);
    setSelectionSize(session.selectionSize);
    setRangeStart(session.rangeStart);
    setRangeEnd(session.rangeEnd);
  }, [open, session.stage, session.roundNumber, session.selectionSize, session.rangeStart, session.rangeEnd]);

  if (!open) return null;

  const midpoint = Math.ceil(selectionSize / 2);

  function handleStageChange(nextStage: StageType) {
    setStage(nextStage);
    const defaultSize = nextStage === 'team' ? event.teamCount : event.individualCount;
    setSelectionSize(defaultSize);
    setRangeStart(1);
    setRangeEnd(defaultSize);
  }

  function handleSelectionSizeChange(size: number) {
    const safe = Math.max(1, Math.min(500, size || 1));
    setSelectionSize(safe);
    setRangeStart(1);
    setRangeEnd(safe);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onStartSession({
        stage,
        roundNumber: Math.max(1, Math.min(20, roundNumber)),
        selectionSize,
        rangeStart: Math.max(1, Math.min(selectionSize, rangeStart)),
        rangeEnd: Math.max(rangeStart, Math.min(selectionSize, rangeEnd)),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 p-5 sm:p-6">
        <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mb-3 sm:hidden" />

        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">Device Judge Session</h2>
            <p className="text-xs text-slate-500">Applies only to this device</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close session modal"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 mt-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Stage</label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
              {(['team', 'individual'] as StageType[]).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => handleStageChange(st)}
                  className={`py-2 text-xs font-semibold rounded-lg transition-colors min-h-[40px] ${
                    stage === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {st === 'team' ? 'Team Round' : 'Individual Round'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Total Participants (1–n)</label>
              <input
                type="number"
                min={1}
                max={500}
                value={selectionSize}
                onChange={(e) => handleSelectionSizeChange(Number(e.target.value))}
                className="w-full px-3 py-2.5 text-sm font-mono tabular-nums border border-slate-200 rounded-xl"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Question (1–20) · +{event.questionPoints[Math.max(0, Math.min(19, roundNumber - 1))] ?? 1}p
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={roundNumber}
                onChange={(e) => setRoundNumber(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                className="w-full px-3 py-2.5 text-sm font-mono tabular-nums border border-slate-200 rounded-xl"
              />
            </div>
          </div>

          {selectionSize >= 2 && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Quick Split (2 Judges)</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRangeStart(1);
                    setRangeEnd(selectionSize);
                  }}
                  className={`py-2 px-2 rounded-xl border text-xs font-semibold font-mono tabular-nums min-h-[40px] transition-colors ${
                    rangeStart === 1 && rangeEnd === selectionSize
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  All 1–{selectionSize}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRangeStart(1);
                    setRangeEnd(midpoint);
                  }}
                  className={`py-2 px-2 rounded-xl border text-xs font-semibold font-mono tabular-nums min-h-[40px] transition-colors ${
                    rangeStart === 1 && rangeEnd === midpoint
                      ? 'bg-amber-600 border-amber-600 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  1st: 1–{midpoint}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRangeStart(Math.min(selectionSize, midpoint + 1));
                    setRangeEnd(selectionSize);
                  }}
                  className={`py-2 px-2 rounded-xl border text-xs font-semibold font-mono tabular-nums min-h-[40px] transition-colors ${
                    rangeStart === Math.min(selectionSize, midpoint + 1) && rangeEnd === selectionSize
                      ? 'bg-amber-600 border-amber-600 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  2nd: {Math.min(selectionSize, midpoint + 1)}–{selectionSize}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Range Start #</label>
              <input
                type="number"
                min={1}
                max={selectionSize}
                value={rangeStart}
                onChange={(e) => setRangeStart(Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-3 py-2.5 text-sm font-mono tabular-nums border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Range End #</label>
              <input
                type="number"
                min={rangeStart}
                max={selectionSize}
                value={rangeEnd}
                onChange={(e) => setRangeEnd(Math.max(rangeStart, Number(e.target.value) || selectionSize))}
                className="w-full px-3 py-2.5 text-sm font-mono tabular-nums border border-slate-200 rounded-xl"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-semibold text-slate-600 min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold min-h-[44px] disabled:opacity-60"
            >
              {saving ? 'Starting...' : `Start (#${rangeStart}–#${rangeEnd})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
