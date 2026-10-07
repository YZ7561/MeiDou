import type { MockQaRule } from './qaTypes'

export const DEFAULT_MOCK_QA_RULES: ReadonlyArray<Readonly<MockQaRule>> = [
  { keyword: '你好', answer: '你好呀，我在这里陪你。' },
  { keyword: '毕业设计', answer: '加油！先拆小任务，再一步步完成。' },
  { keyword: '累', answer: '辛苦啦，休息一下也很重要。' }
]

const MAX_RULE_COUNT = 100
const MAX_KEYWORD_LENGTH = 100
const MAX_ANSWER_LENGTH = 2000

export type MockQaRulesValidationResult =
  | { valid: true; rules: MockQaRule[] }
  | { valid: false; message: string }

export function cloneDefaultMockQaRules(): MockQaRule[] {
  return DEFAULT_MOCK_QA_RULES.map((rule) => ({ ...rule }))
}

export function validateMockQaRules(value: unknown): MockQaRulesValidationResult {
  if (!Array.isArray(value)) {
    return { valid: false, message: 'Mock 规则配置必须是数组。' }
  }

  if (value.length > MAX_RULE_COUNT) {
    return { valid: false, message: `Mock 规则不能超过 ${MAX_RULE_COUNT} 条。` }
  }

  const rules: MockQaRule[] = []
  const keywords = new Set<string>()

  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (!isRecord(item)) {
      return { valid: false, message: `第 ${index + 1} 条规则格式无效。` }
    }

    const keyword = normalizeRuleText(item.keyword)
    const answer = normalizeRuleText(item.answer)
    if (!keyword) {
      return { valid: false, message: `第 ${index + 1} 条规则的关键词不能为空。` }
    }
    if (!answer) {
      return { valid: false, message: `第 ${index + 1} 条规则的固定回答不能为空。` }
    }
    if (keyword.length > MAX_KEYWORD_LENGTH) {
      return { valid: false, message: `第 ${index + 1} 条规则的关键词过长。` }
    }
    if (answer.length > MAX_ANSWER_LENGTH) {
      return { valid: false, message: `第 ${index + 1} 条规则的固定回答过长。` }
    }

    const comparableKeyword = keyword.toLocaleLowerCase()
    if (keywords.has(comparableKeyword)) {
      return { valid: false, message: `关键词“${keyword}”重复。` }
    }

    keywords.add(comparableKeyword)
    rules.push({ keyword, answer })
  }

  return { valid: true, rules }
}

function normalizeRuleText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const normalizedValue = value.trim()
  return normalizedValue || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
