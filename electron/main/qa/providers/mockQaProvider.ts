import type { QaProvider, QaResponse } from '../qaTypes'
import { loadMockQaRules } from '../../storage/configStore'

export const mockQaProvider: QaProvider = {
  async ask(question: string): Promise<QaResponse> {
    const normalizedQuestion = question.trim()

    if (!normalizedQuestion) {
      return createMockResponse('你还没有告诉我问题哦。')
    }

    for (const rule of loadMockQaRules()) {
      if (normalizedQuestion.includes(rule.keyword)) {
        return createMockResponse(rule.answer)
      }
    }

    return createMockResponse('我先记下啦，之后会变得更聪明。')
  }
}

function createMockResponse(answer: string): QaResponse {
  return {
    answer,
    type: 'mock'
  }
}
