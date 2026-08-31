/**
 * 계정명(대분류/중분류/소분류)의 중국어 표기 해석.
 *
 * 우선순위: 번역맵(t) → CSV 의 *_cn 컬럼 → 원문(한국어)
 * CSV 의 _cn 에는 영문 약어(INT·Legal·L35 …)만 들어있는 계정이 있어
 * 실제 중국어(CJK)가 들어있을 때만 채택한다.
 */
import { getAggregatedData } from "./expenseData";
import { t } from "./translations";

type Lang = "ko" | "zh";

const CJK = /[一-鿿]/;

let cnLabelMap: Map<string, string> | null = null;

export function getCnLabel(ko: string): string | undefined {
  if (!cnLabelMap) {
    let rows: {
      cost_lv1?: string;
      cost_lv2?: string;
      cost_lv3?: string;
      cost_lv1_cn?: string;
      cost_lv2_cn?: string;
      cost_lv3_cn?: string;
    }[];
    try {
      rows = getAggregatedData().category_detail;
    } catch {
      // 데이터 로드 전이면 캐시하지 않고 다음 호출에 다시 시도
      return undefined;
    }
    const m = new Map<string, string>();
    const put = (k?: string, v?: string) => {
      const kk = (k ?? "").trim();
      const vv = (v ?? "").trim();
      if (kk && vv && CJK.test(vv) && !m.has(kk)) m.set(kk, vv);
    };
    for (const r of rows) {
      put(r.cost_lv1, r.cost_lv1_cn);
      put(r.cost_lv2, r.cost_lv2_cn);
      put(r.cost_lv3, r.cost_lv3_cn);
    }
    cnLabelMap = m;
  }
  return cnLabelMap.get(ko);
}

/** 계정 라벨 표시: 번역맵 우선 → CSV 중국어 컬럼 → 원문 */
export function tLabel(ko: string, lang: Lang): string {
  if (!ko) return ko;
  const mapped = t(ko, lang);
  if (mapped !== ko) return mapped;
  return lang === "zh" ? (getCnLabel(ko) ?? ko) : ko;
}

/**
 * 수기 입력 항목명의 중국어 자동 표기.
 * 자동으로 찾을 수 있으면 그 값을, 없으면 undefined (→ 사용자가 직접 입력해야 함).
 * 한글이 없는 이름(OMS, CN SAP 등)은 그대로 통용되므로 자동 해결로 본다.
 */
export function autoCnLabel(ko: string): string | undefined {
  const name = (ko ?? "").trim();
  if (!name) return undefined;
  const mapped = t(name, "zh");
  if (mapped !== name) return mapped;
  const fromCsv = getCnLabel(name);
  if (fromCsv) return fromCsv;
  if (!/[가-힣]/.test(name)) return name; // 영문·숫자만이면 그대로 사용
  return undefined;
}
