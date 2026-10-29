# 추후 과제: AI 기능

2026-10-29 결정: 첫 버전에서 AI 기능은 넣지 않는다. 나중에 붙일 때 참고할 원본 위치를 적어 둔다.
원본: https://github.com/chojema/chojemaoffice (Apache-2.0)

## 원본에서 가져올 후보

| 역할 | 원본 경로 |
|---|---|
| AI 패널 화면 | `apps/markdown/src/renderer/ai/AiPanel.tsx`, `EditQueueCard.tsx`, `MindMapCard.tsx` |
| 문서 편집 도구(모델이 문서를 고치는 명령) | `apps/markdown/src/renderer/ai/tools.ts`, `doc-writer.ts`, `edit-queue.ts` |
| 선택 영역 질문 팝오버 | `apps/markdown/src/renderer/components/AiAskPopover.tsx` |
| AI 서비스 구독 연결 | `apps/markdown/src/renderer/ai/subscription-client.ts`, `packages/ai-provider` |
| AI 실행 엔진 | `packages/agent-core` |
| 검색 도구 | `packages/ai-search`, `apps/markdown/src/renderer/ai/search-skill.ts` |
| AI에 숨길 내용(가림 처리) | `apps/markdown/src/renderer/editor/redact.ts`, `Redaction.ts`, `RedactDialog.tsx` |
| AI 변경 강조 표시 | `apps/markdown/src/renderer/editor/aiHighlight.ts`, `aiQueueAnchors.ts` |
| HTML 쪽 AI | `apps/html/src/renderer/ai/*` |

## 붙일 때 알아둘 점

- `src/renderer/editor/ops.ts`는 원본의 문서 편집 명령(MdOp) 구조를 그대로 두었다. AI 도구는 이 명령을 그대로 쓸 수 있다.
- `ops.ts`에서 뺀 가림 처리 검사(`assertPlaceholdersIntact`)는 가림 처리를 다시 넣을 때 함께 되살린다.
- `editor/extensions.ts`에서 뺀 확장: `AiHighlight`, `AiQueueAnchors`, `Redaction`.
- HTML 편집기는 원본과 구조가 달라서(원본은 소스+미리보기, 이 앱은 TipTap 위지위그) `apps/html`의 AI 코드는 그대로 쓰기 어렵다. 마크다운 쪽 도구 방식을 HTML에 맞춰 옮기는 편이 낫다.
