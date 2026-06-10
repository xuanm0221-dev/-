"use client";

import React from "react";
import { X, Microscope } from "lucide-react";

interface DeepAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// 섹션 헤더 — 큰 숫자 + 제목 + 하단 보더 (3섹션 구분 리듬용)
function SectionHeading({ index, title }: { index: number; title: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-5 pb-2.5 border-b-2 border-slate-200">
      <span className="text-[28px] font-extrabold text-violet-600 leading-none" style={{ fontVariantNumeric: "tabular-nums" }}>
        {index}.
      </span>
      <h2 className="text-[19px] font-bold text-slate-900 leading-tight">{title}</h2>
    </div>
  );
}

// 강조 라벨 칩 — "개선 여지", "장기 효과" 같은 in-line 강조 (border-l 박스 대체)
function Chip({ children, color }: { children: React.ReactNode; color: "blue" | "amber" }) {
  const palette = {
    blue: "bg-blue-100 text-blue-800",
    amber: "bg-amber-100 text-amber-800",
  };
  return (
    <span className={`inline-block text-[11.5px] font-bold tracking-wider uppercase px-2 py-0.5 rounded ${palette[color]} mr-2`}>
      {children}
    </span>
  );
}

export function DeepAnalysisModal({ isOpen, onClose }: DeepAnalysisModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative flex flex-col bg-white rounded-2xl shadow-2xl w-[96vw] max-w-4xl h-[94vh]">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-white rounded-t-2xl border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <Microscope className="w-5 h-5 text-violet-600" />
            <span className="font-bold text-slate-800 text-[15px]">심층분석 보고서</span>
            <span className="text-[12px] text-slate-500 ml-1">2026년 5월 YTD 기준</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-7 py-6">
          {/* Title block — 메인 헤더 (유일한 그라데이션) */}
          <div className="rounded-xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 px-6 py-5 text-white shadow-md mb-8">
            <div className="text-[12px] font-semibold uppercase tracking-widest text-violet-100 mb-2">
              심층 보고서
            </div>
            <h1 className="text-[22px] font-bold leading-snug">
              2026년 5월 F&amp;F 중국 법인 비용 구조 및 운영 효율성 분석
            </h1>
          </div>

          {/* 1. KPI Review */}
          <section className="mb-10">
            <SectionHeading index={1} title="전사 경영 지표 및 수익성 현황 (KPI Review)" />
            <p className="text-[15px] text-slate-700 leading-[1.7] mb-5">
              2026년 5월 누적(YTD) 기준, 법인은 <strong className="text-slate-900">외형 성장</strong>과 함께 <strong className="text-slate-900">미래를 위한 인프라 구축</strong>에 집중하고 있습니다.
            </p>

            {/* KPI 스탯 카드 — 한 눈에 잡히는 핵심 수치라서 박스 유지 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 px-4 py-3.5">
                <div className="text-[12px] font-semibold tracking-wider text-emerald-700 uppercase mb-1">판매매출</div>
                <div className="text-[26px] font-bold text-emerald-700 leading-tight" style={{ fontVariantNumeric: "tabular-nums" }}>4,164M</div>
                <div className="text-[13px] text-slate-600 mt-1.5">전년 동기 3,870M 대비 <strong className="text-emerald-700">108% 성장</strong></div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50/40 px-4 py-3.5">
                <div className="text-[12px] font-semibold tracking-wider text-amber-700 uppercase mb-1">총비용 집행</div>
                <div className="text-[26px] font-bold text-amber-700 leading-tight" style={{ fontVariantNumeric: "tabular-nums" }}>192,078K</div>
                <div className="text-[13px] text-slate-600 mt-1.5">전년 대비 <strong className="text-amber-700">117% 증가</strong>, 매출 성장률 상회</div>
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50/40 px-4 py-3.5">
                <div className="text-[12px] font-semibold tracking-wider text-rose-700 uppercase mb-1">매출 대비 비용률</div>
                <div className="text-[26px] font-bold text-rose-700 leading-tight" style={{ fontVariantNumeric: "tabular-nums" }}>
                  5.2% <span className="text-[16px] font-semibold">(+0.4%p)</span>
                </div>
                <div className="text-[13px] text-slate-600 mt-1.5">SCM 혁신·공간 확장 <strong>전략적 비용 포함</strong></div>
              </div>
            </div>

            <p className="text-[14.5px] text-slate-700 leading-[1.7]">
              매출 성장보다 비용 투입이 가팔라지며 비용률이 상승했으나, 이는 <strong className="text-slate-900">단순 소모성 지출이 아닌 SCM 혁신 및 공간 확장을 위한 전략적 비용</strong>이 포함된 수치입니다.
            </p>
          </section>

          {/* 2. 주요 항목별 심층 분석 — 가벼운 카드 (왼쪽 컬러 액센트 + 옅은 배경) */}
          <section className="mb-10">
            <SectionHeading index={2} title="주요 항목별 심층 분석 및 효율 진단" />

            <div className="space-y-4">
              {/* ① 광고비 */}
              <div className="bg-slate-50/70 border-l-[3px] border-blue-500 rounded-r-lg pl-5 pr-5 py-4">
                <h3 className="flex items-center gap-2.5 mb-3 leading-tight">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-[15px] font-bold flex-shrink-0">1</span>
                  <span className="text-[18px] font-bold text-slate-900">
                    광고비 <span className="text-blue-700">90,847K · YoY 124%</span>
                  </span>
                </h3>
                <p className="text-[13.5px] text-slate-500 font-medium mb-3 -mt-1.5 ml-[42px]">성장을 견인하는 핵심 엔진</p>
                <div className="space-y-2 text-[14.5px] text-slate-700 leading-[1.7]">
                  <p>
                    <span className="font-semibold text-slate-900">브랜드별 전략:</span> <strong>MLB(67,895K, 120%↑)</strong>가 안정적 매출 기반을 제공하는 가운데, <strong>DISCOVERY(15,846K, 153%↑)</strong>에 대한 공격적 투자가 이어지고 있습니다.
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">효율성 지표:</span> ROI <strong>8,828%</strong>, 평균 ROAS <strong>89.28</strong> — 투입 대비 산출 효과 매우 강력.
                  </p>
                  <p>
                    <Chip color="blue">개선 여지</Chip>
                    현재 효율 등급은 <strong>C등급</strong>이며, 광고비를 <strong>18,115K ~ 18,541K 구간</strong>으로 최적화할 경우 ROAS를 <strong className="text-blue-700">114.28</strong>까지 끌어올릴 수 있다는 분석 결과가 도출.
                  </p>
                </div>
              </div>

              {/* ② 지급수수료 */}
              <div className="bg-slate-50/70 border-l-[3px] border-amber-500 rounded-r-lg pl-5 pr-5 py-4">
                <h3 className="flex items-center gap-2.5 mb-3 leading-tight">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-600 text-white text-[15px] font-bold flex-shrink-0">2</span>
                  <span className="text-[18px] font-bold text-slate-900">
                    지급수수료 <span className="text-amber-700">7,657K · YoY 145%</span>
                  </span>
                </h3>
                <p className="text-[13.5px] text-slate-500 font-medium mb-3 -mt-1.5 ml-[42px]">SCM 혁신을 위한 선제적 투자</p>
                <div className="space-y-2 text-[14.5px] text-slate-700 leading-[1.7]">
                  <p>
                    <span className="font-semibold text-slate-900">일시적 비용의 집중:</span> 온라인 창고 이전 관련 <strong>Supply Chain 비용 3,405K (578%↑)</strong> 및 재고 전수 실사로 인한 <strong>서비스 비용 738K (3,517%↑)</strong> 급증.
                  </p>
                  <p>
                    <Chip color="amber">장기 효과</Chip>
                    창고 이전 완료 후 연간 <strong>500만~900만 RMB</strong> 규모의 수수료 절감 예상 — 현재의 비용 지출은 <strong>미래의 이익률을 높이기 위한 고통 분담 과정</strong>.
                  </p>
                </div>
              </div>

              {/* ③ 임차료 및 수주회 */}
              <div className="bg-slate-50/70 border-l-[3px] border-slate-400 rounded-r-lg pl-5 pr-5 py-4">
                <h3 className="flex items-center gap-2.5 mb-3 leading-tight">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-600 text-white text-[15px] font-bold flex-shrink-0">3</span>
                  <span className="text-[18px] font-bold text-slate-900">임차료 및 수주회</span>
                </h3>
                <p className="text-[13.5px] text-slate-500 font-medium mb-3 -mt-1.5 ml-[42px]">구조적 상승과 운영 리스크 관리</p>
                <div className="space-y-2.5 text-[14.5px] text-slate-700 leading-[1.7]">
                  <p>
                    <span className="font-semibold text-slate-900">임차료 9,560K (YoY 120%):</span> 사무실 추가 임차에 따른 구조적 고정비 상승. 계획 누적액(9,562K) 대비 <strong className="text-emerald-700">100% 집행률</strong> — 계획 범위 내 질서 있게 발생 중.
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">수주회 8,076K (YoY 121%):</span> 상반기 모듈형 가구 제작비로 예산 대비 지출 컸음. 하반기 개최지가 <strong>하이난</strong>으로 변경됨에 따라 기존 제작물 재활용 제한 가능성. <strong className="text-rose-700">장소 변경 추가 비용 모니터링 필요</strong>.
                  </p>
                </div>
              </div>

              {/* ④ IT 수수료 */}
              <div className="bg-slate-50/70 border-l-[3px] border-emerald-500 rounded-r-lg pl-5 pr-5 py-4">
                <h3 className="flex items-center gap-2.5 mb-3 leading-tight">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-600 text-white text-[15px] font-bold flex-shrink-0">4</span>
                  <span className="text-[18px] font-bold text-slate-900">
                    IT 수수료 <span className="text-emerald-700">4,717K · YoY 89%</span>
                  </span>
                </h3>
                <p className="text-[13.5px] text-slate-500 font-medium mb-3 -mt-1.5 ml-[42px]">효율화와 기술 투자의 병행</p>
                <p className="text-[14.5px] text-slate-700 leading-[1.7]">
                  전체 지출은 감소했으나, 온라인 플랫폼 수수료를 절감(<strong>-314K</strong>)한 재원을 <strong>AI 식별시스템(611K 신규)</strong> 및 <strong>OMS(198%↑)</strong> 등 자체 시스템 고도화에 재투입 — 디지털 전환 가속화.
                </p>
              </div>
            </div>
          </section>

          {/* 3. 전략적 관리 방안 제안 */}
          <section>
            <SectionHeading index={3} title="향후 전략적 관리 방안 제안" />

            <div className="space-y-4">
              {/* 단기 */}
              <div className="bg-rose-50/40 rounded-lg px-5 py-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="text-[11px] font-bold tracking-widest text-rose-700 uppercase bg-rose-200/60 px-2 py-0.5 rounded">단기</span>
                  <h3 className="text-[16px] font-bold text-rose-900">효율 최적화</h3>
                </div>
                <ul className="space-y-2.5 text-[14.5px] text-slate-700 leading-[1.7] list-none">
                  <li>
                    <span className="font-semibold text-slate-900">광고 타겟팅 정교화:</span> 현재의 높은 ROI를 유지하면서 효율 등급(<strong>C → B 이상</strong>) 상향을 위해 브랜드별 최적 집행 구간(ROAS 114.28 달성 구간)을 참고하여 예산 재배분.
                  </li>
                  <li>
                    <span className="font-semibold text-slate-900">하이난 수주회 예산 통제:</span> 장소 변경에 따른 물류비 상승분과 가구 재활용 제약 요인을 반영한 <strong>긴급 예산 검토 필요</strong>.
                  </li>
                </ul>
              </div>

              {/* 중기 */}
              <div className="bg-amber-50/40 rounded-lg px-5 py-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="text-[11px] font-bold tracking-widest text-amber-700 uppercase bg-amber-200/60 px-2 py-0.5 rounded">중기</span>
                  <h3 className="text-[16px] font-bold text-amber-900">수익성 회복</h3>
                </div>
                <ul className="space-y-2.5 text-[14.5px] text-slate-700 leading-[1.7] list-none">
                  <li>
                    <span className="font-semibold text-slate-900">SCM 절감 효과 가시화:</span> 창고 이전 후 기대되는 연간 <strong>500만~900만 RMB</strong> 절감분을 분기별 손익에 반영, 매출 대비 비용률을 <strong className="text-emerald-700">4.8% 이하</strong>로 회복시키는 마일스톤 설정.
                  </li>
                  <li>
                    <span className="font-semibold text-slate-900">인당 생산성 유지:</span> 인당 인건비 <strong>37.3K (110%↑)</strong> 상승 추세 — AI 및 OMS 등 도입 시스템을 활용해 인력 운영 효율성 극대화.
                  </li>
                </ul>
              </div>

              {/* 결론 — 가장 강한 시각 강조 (그라데이션 카드, 한 곳만) */}
              <div className="mt-6 rounded-xl bg-gradient-to-br from-indigo-50 via-violet-50 to-indigo-100/50 border border-indigo-200 px-6 py-5">
                <div className="text-[12.5px] font-bold uppercase tracking-widest text-indigo-700 mb-2.5">📌 결론</div>
                <p className="text-[15.5px] text-slate-800 leading-[1.8]">
                  F&amp;F 중국 법인은 현재 <strong className="text-indigo-700">&apos;규모의 경제&apos;</strong>를 달성하기 위한 과도기적 투자 단계에 있습니다. 창고 이전비와 가구 제작비 같은 일시적 요인이 제거되고 마케팅 타겟팅이 최적화된다면, <strong>하반기에는 매출 성장세와 더불어 압도적인 수익성 개선이 가능</strong>할 것으로 판단됩니다.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
