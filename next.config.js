/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 한글 경로 처리를 위한 설정
  async rewrites() {
    return [];
  },
  // Vercel serverless 번들에 정적 데이터 파일 명시적 포함
  // (API 라우트가 path.join(process.cwd(), "data", ...)로 읽기 때문에
  //  Next.js 자동 트레이싱이 누락할 수 있어 명시 필요)
  outputFileTracingIncludes: {
    "/api/ai-report": ["./data/ai-reports/**/*", "./data/aggregated-expense.json"],
    "/api/expense-data": ["./data/aggregated-expense.json"],
  },
};

module.exports = nextConfig;

