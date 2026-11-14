import React, { useMemo, useState } from 'react';
import { BarChart3, Bell, Download, RefreshCw, Star } from 'lucide-react';
import type { CompetitionEvent, Participant, ScoreEvent, StageType } from '../types.ts';
import { computeEventAnalytics, downloadScoresCsv } from '../lib/scoringEngine.ts';

interface TrendsDashboardProps {
  event: CompetitionEvent;
  participants: Participant[];
  scores: ScoreEvent[];
  onRefresh: () => Promise<void>;
  onNavigateJudge: () => void;
}

const LINE_COLORS = ['#D97706', '#0F172A', '#16A34A', '#2563EB', '#DC2626'];

export const TrendsDashboard: React.FC<TrendsDashboardProps> = ({
  event,
  participants,
  scores,
  onRefresh,
  onNavigateJudge,
}) => {
  const [refreshing, setRefreshing] = useState(false);
  const [stageFilter, setStageFilter] = useState<StageType>('team');

  const analytics = useMemo(
    () => computeEventAnalytics(event, participants, scores),
    [event, participants, scores]
  );

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  if (analytics.summary.totalEvaluations === 0) {
    return (
      <div className="mx-auto w-full max-w-5xl px-3 sm:px-6 py-10 pb-20">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center max-w-md mx-auto">
          <div className="mx-auto w-12 h-12 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center mb-4">
            <BarChart3 className="w-6 h-6" />
          </div>
          <h2 className="font-display text-lg font-bold text-slate-900">No Questions Scored Yet</h2>
          <p className="text-sm text-slate-600 mt-2">
            Accuracy curves across Questions 1–20, leader trajectories, and booster impact appear automatically as judges score.
          </p>
          <button
            type="button"
            onClick={onNavigateJudge}
            className="mt-5 px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold min-h-[44px]"
          >
            Open Judge Pad
          </button>
        </div>
      </div>
    );
  }

  const stageRounds = analytics.roundTrends.filter((r) => r.stage === stageFilter);
  const progressions = stageFilter === 'team' ? analytics.topTeamProgressions : analytics.topIndividualProgressions;

  const allProgRounds = progressions.flatMap((p) => p.rounds.map((r) => r.roundNumber));
  const minRound = allProgRounds.length > 0 ? Math.min(...allProgRounds) : 1;
  const maxRound = allProgRounds.length > 0 ? Math.max(...allProgRounds, minRound + 1) : 2;
  const allScores = progressions.flatMap((p) => p.rounds.map((r) => r.cumulativeScore));
  const minScore = Math.min(0, ...allScores);
  const maxScore = Math.max(5, ...allScores);

  return (
    <div className="mx-auto w-full max-w-5xl px-3 sm:px-6 py-4 sm:py-6 pb-20 md:pb-10 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Performance Trends
          </h1>
          <p className="text-xs sm:text-sm text-slate-600">
            Questions 1–20 accuracy, leader trajectories, and booster impact
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center p-1 bg-slate-100 rounded-xl">
            {(['team', 'individual'] as StageType[]).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStageFilter(st)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[36px] ${
                  stageFilter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                {st === 'team' ? 'Teams' : 'Individuals'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void handleRefresh()}
            aria-label="Refresh analytics"
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 min-h-[38px] min-w-[38px] flex items-center justify-center"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => downloadScoresCsv(scores)}
            className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold inline-flex items-center gap-1.5 min-h-[38px]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-xs font-medium text-slate-500">Evaluations</div>
          <div className="font-mono tabular-nums text-2xl font-bold text-slate-900 mt-1">
            {analytics.summary.totalEvaluations}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
            Peak: {analytics.summary.peakRound ? `Q${analytics.summary.peakRound}` : '—'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-xs font-medium text-slate-500">Accuracy</div>
          <div className="font-mono tabular-nums text-2xl font-bold text-emerald-700 mt-1">
            {analytics.summary.overallAccuracy}%
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">All questions</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-xs font-medium text-slate-500">Average Score</div>
          <div className="font-mono tabular-nums text-2xl font-bold text-slate-900 mt-1">
            {stageFilter === 'team' ? analytics.summary.avgScoreTeam : analytics.summary.avgScoreIndividual}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
            Team {analytics.summary.avgScoreTeam} · Ind {analytics.summary.avgScoreIndividual}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-xs font-medium text-slate-500">Boosters Used</div>
          <div className="font-mono tabular-nums text-2xl font-bold text-amber-700 mt-1">
            {analytics.summary.totalBoostersApplied}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
            {analytics.boosterAnalytics.luckyBell.usedCount} Bell · {analytics.boosterAnalytics.goldenGamble.usedCount} Star
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <h2 className="font-display text-base font-bold text-slate-900">Accuracy per Question (Q1–Q20)</h2>
          <p className="text-xs text-slate-500 mb-3">Dashed lines mark Q11 Lucky Bell and Q16 Star of Hope</p>

          {stageRounds.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-slate-500">
              No questions scored for {stageFilter} stage yet.
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <svg viewBox="0 0 560 210" className="w-full min-w-[380px] h-52" role="img" aria-label="Question accuracy chart">
                {[0, 25, 50, 75, 100].map((pct) => {
                  const y = 175 - (pct / 100) * 145;
                  return (
                    <g key={pct}>
                      <line x1="36" y1={y} x2="545" y2={y} stroke="#E2E8F0" strokeWidth="1" />
                      <text x="30" y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-mono">
                        {pct}%
                      </text>
                    </g>
                  );
                })}

                {stageRounds.map((rt, idx) => {
                  const barSlot = 500 / Math.max(stageRounds.length, 1);
                  const barWidth = Math.min(32, Math.max(12, barSlot * 0.6));
                  const x = 42 + idx * barSlot + (barSlot - barWidth) / 2;
                  const barHeight = (rt.accuracyRate / 100) * 145;
                  const y = 175 - barHeight;
                  const isBoosterRound = rt.roundNumber === 11 || rt.roundNumber === 16;

                  return (
                    <g key={`${rt.stage}-${rt.roundNumber}`}>
                      {isBoosterRound && (
                        <line
                          x1={x + barWidth / 2}
                          y1="18"
                          x2={x + barWidth / 2}
                          y2="175"
                          stroke="#D97706"
                          strokeDasharray="3 3"
                          strokeWidth="1.5"
                        />
                      )}
                      <rect
                        x={x}
                        y={y}
                        width={barWidth}
                        height={Math.max(2, barHeight)}
                        rx="4"
                        fill={rt.accuracyRate >= 65 ? '#16A34A' : rt.accuracyRate >= 40 ? '#D97706' : '#DC2626'}
                      />
                      <text
                        x={x + barWidth / 2}
                        y={y - 5}
                        textAnchor="middle"
                        className="fill-slate-700 text-[9px] font-mono font-semibold"
                      >
                        {rt.accuracyRate}%
                      </text>
                      <text
                        x={x + barWidth / 2}
                        y="194"
                        textAnchor="middle"
                        className="fill-slate-500 text-[10px] font-mono"
                      >
                        Q{rt.roundNumber}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <h2 className="font-display text-base font-bold text-slate-900">Top 5 Score Progression</h2>
          <p className="text-xs text-slate-500 mb-3">Cumulative score across answered questions</p>

          {progressions.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-slate-500">
              No score progression yet for this stage.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="w-full overflow-x-auto">
                <svg viewBox="0 0 560 210" className="w-full min-w-[380px] h-52" role="img" aria-label="Score progression chart">
                  {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                    const scoreVal = Math.round(minScore + t * (maxScore - minScore));
                    const y = 175 - t * 145;
                    return (
                      <g key={t}>
                        <line x1="36" y1={y} x2="540" y2={y} stroke="#E2E8F0" strokeWidth="1" />
                        <text x="30" y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-mono">
                          {scoreVal}
                        </text>
                      </g>
                    );
                  })}

                  {progressions.map((prog, pIdx) => {
                    const color = LINE_COLORS[pIdx % LINE_COLORS.length];
                    const coords = prog.rounds.map((pt) => {
                      const xRatio = maxRound === minRound ? 0.5 : (pt.roundNumber - minRound) / (maxRound - minRound);
                      const yRatio = maxScore === minScore ? 0.5 : (pt.cumulativeScore - minScore) / (maxScore - minScore);
                      return {
                        x: 46 + xRatio * 484,
                        y: 175 - yRatio * 145,
                        pt,
                      };
                    });

                    const pathD = coords
                      .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
                      .join(' ');

                    return (
                      <g key={prog.participantNumber}>
                        {coords.length > 1 && (
                          <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        )}
                        {coords.map((c) => (
                          <circle key={c.pt.roundNumber} cx={c.x} cy={c.y} r="3.5" fill={color} />
                        ))}
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 text-xs">
                {progressions.map((prog, idx) => (
                  <div key={prog.participantNumber} className="inline-flex items-center gap-1.5 font-mono tabular-nums text-slate-700">
                    <span
                      className="w-2.5 h-2.5 rounded-sm inline-block"
                      style={{ backgroundColor: LINE_COLORS[idx % LINE_COLORS.length] }}
                    />
                    <span>{prog.label}</span>
                    <span className="font-bold text-slate-900">({prog.finalScore}p)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Booster Impact */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
            <Bell className="w-4 h-4" />
            <span>Lucky Bell (Q11+)</span>
          </div>
          <div className="font-mono tabular-nums text-2xl font-bold text-slate-900 mt-1.5">
            +{analytics.boosterAnalytics.luckyBell.totalBonusPoints} pts
          </div>
          <div className="text-xs text-slate-600 mt-1 font-mono tabular-nums">
            {analytics.boosterAnalytics.luckyBell.usedCount} used · {analytics.boosterAnalytics.luckyBell.correctWithBell} right /{' '}
            {analytics.boosterAnalytics.luckyBell.wrongWithBell} wrong
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
            <Star className="w-4 h-4" />
            <span>Star of Hope (Q16+, +5 / -3)</span>
          </div>
          <div className="font-mono tabular-nums text-2xl font-bold text-slate-900 mt-1.5">
            {analytics.boosterAnalytics.goldenGamble.netImpactPoints >= 0
              ? `+${analytics.boosterAnalytics.goldenGamble.netImpactPoints}`
              : analytics.boosterAnalytics.goldenGamble.netImpactPoints}{' '}
            pts
          </div>
          <div className="text-xs text-slate-600 mt-1 font-mono tabular-nums">
            {analytics.boosterAnalytics.goldenGamble.wins} wins (+5) · {analytics.boosterAnalytics.goldenGamble.losses} losses (-3)
          </div>
        </div>
      </div>
    </div>
  );
};
