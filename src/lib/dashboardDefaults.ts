import {
  getAvailableMonths,
  getAvailableYearOptions,
  type YearOption,
} from "./expenseData";

const FALLBACK_YEAR_OPTION: YearOption = {
  year: 2025,
  type: "actual",
  display: "2025년(실적)",
};

/**
 * 대시보드 진입 시 기본으로 보여줄 연도 옵션.
 * 실적 데이터가 존재하는 가장 최근 연도를 사용한다.
 * (getAvailableYearOptions 는 연도 내림차순 정렬이므로 첫 매칭이 최신)
 */
export function getLatestYearOption(): YearOption {
  const options = getAvailableYearOptions();
  const latestActual = options.find(
    (opt) => opt.type === "actual" && getAvailableMonths(opt.year, opt.type).length > 0
  );
  return latestActual ?? options[0] ?? FALLBACK_YEAR_OPTION;
}

/** 해당 연도에서 데이터가 있는 가장 최근 월 */
export function getLatestMonth(yearOption: YearOption): number {
  const months = getAvailableMonths(yearOption.year, yearOption.type);
  return months.length > 0 ? months[months.length - 1] : 1;
}
