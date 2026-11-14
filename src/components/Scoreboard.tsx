import React, { useMemo, useState } from 'react';
import { Ban, Bell } from 'lucide-react';
import type { JudgeSession, Participant, StageType } from '../types.ts';

interface ScoreboardProps {
  participants: Participant[];
  session: JudgeSession;
}

export const Scoreboard: React.FC<ScoreboardProps> = ({ participants, session }) => {
  const [stageFilter, setStageFilter] = useState<StageType>(session.stage);

  const sorted = useMemo(() => {
    return participants
      .filter((p) => p.stage === stageFilter)
      .sort(
        (a, b) =>
          b.totalScore - a.totalScore ||
          b.correctCount - a.correctCount ||
          a.participantNumber - b.participantNumber
      );
  }, [participants, stageFilter]);

  const topThree = sorted.slice(0, 3);

  return (
    <div className="mx-auto w-full max-w-4xl px-3 sm:px-6 py-4 sm:py-6 pb-20 md:pb-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Live Standings
          </h1>
          <p className="text-xs sm:text-sm text-slate-600">
            Question {session.roundNumber}/20 · {sorted.length} participants
          </p>
        </div>

        <div className="flex items-center p-1 bg-slate-100 rounded-xl">
          {(['team', 'individual'] as StageType[]).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStageFilter(st)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap min-h-[36px] ${
                stageFilter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st === 'team' ? 'Teams' : 'Individuals'}
            </button>
          ))}
        </div>
      </div>

      {/* Top 3 Compact Cards */}
      {topThree.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {topThree.map((p, idx) => (
            <div
              key={p.id}
              className={`rounded-2xl border p-3 sm:p-4 ${
                idx === 0 ? 'bg-amber-50/80 border-amber-200' : 'bg-white border-slate-200'
              }`}
            >
              <div className="text-[11px] font-medium text-slate-500 font-mono tabular-nums">
                #{idx + 1} · {p.label}
              </div>
              <div className="font-mono tabular-nums text-2xl sm:text-3xl font-bold text-slate-900 mt-0.5">
                {p.totalScore}
              </div>
              <div className="text-[11px] text-slate-600 font-mono tabular-nums mt-0.5">
                {p.correctCount}R / {p.wrongCount}W
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Mobile-Clean Standings Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                <th className="py-2.5 px-3">Rank</th>
                <th className="py-2.5 px-3">Participant</th>
                <th className="py-2.5 px-3 text-right">Score</th>
                <th className="py-2.5 px-3 text-right">R / W</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
              {sorted.map((p, index) => {
                const isBanned = p.bannedRound === session.roundNumber;
                return (
                  <tr key={p.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-mono tabular-nums font-semibold text-slate-700">
                      #{index + 1}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="font-semibold text-slate-900">{p.label}</span>
                      {p.luckyBellUsedRound !== null && (
                        <Bell className="w-3 h-3 text-amber-600 inline ml-1.5" aria-label="Lucky Bell used" />
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 text-base">
                      {p.totalScore}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                      <span className="text-emerald-700 font-medium">{p.correctCount}</span>/
                      <span className="text-red-700 font-medium">{p.wrongCount}</span>
                    </td>
                    <td className="py-2.5 px-3 text-xs">
                      {isBanned ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                          <Ban className="w-3 h-3" />
                          <span>Ban Q{session.roundNumber}</span>
                        </span>
                      ) : (
                        <span className="text-slate-500">Active</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
