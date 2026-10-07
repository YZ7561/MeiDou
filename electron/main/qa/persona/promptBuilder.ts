import { MEIDOU_SYSTEM_PROMPT } from './personaPrompt'
import { MEIDOU_STYLE_EXAMPLES } from './styleExamples'
import type {
  QaConversationContextMessage,
  QaMemoryContextMessage,
  QaRagContextMessage
} from '../qaTypes'

export type ChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function buildMeiDouMessages(
  question: string,
  conversationContext: QaConversationContextMessage[] = [],
  memoryContext: QaMemoryContextMessage[] = [],
  ragContext: QaRagContextMessage[] = []
): ChatCompletionMessage[] {
  const normalizedQuestion = question.trim()

  return [
    {
      role: 'system',
      content: MEIDOU_SYSTEM_PROMPT
    },
    ...buildMemoryMessages(memoryContext),
    ...buildRagMessages(ragContext),
    ...MEIDOU_STYLE_EXAMPLES.flatMap<ChatCompletionMessage>((example) => [
      {
        role: 'user',
        content: example.user
      },
      {
        role: 'assistant',
        content: example.assistant
      }
    ]),
    ...normalizeConversationContext(conversationContext),
    {
      role: 'user',
      content: normalizedQuestion
    }
  ]
}

function buildRagMessages(ragContext: QaRagContextMessage[]): ChatCompletionMessage[] {
  const normalizedChunks = ragContext
    .map((chunk) => ({
      content: chunk.content.trim(),
      documentName: chunk.documentName.trim(),
      chunkIndex: chunk.chunkIndex,
      score: chunk.score
    }))
    .filter((chunk) => chunk.content && chunk.documentName)

  if (normalizedChunks.length === 0) return []

  return [
    {
      role: 'system',
      content: [
        '以下是本地知识库检索到的资料片段。回答用户问题时，请优先基于这些资料。',
        '如果资料片段不足以支持结论，必须明确说明“资料中没有足够依据”。',
        '不要编造资料中没有的信息。使用资料时，请在回答末尾附上简短来源，格式类似：来源：文件名（片段 1）。',
        '',
        ...normalizedChunks.map((chunk, index) =>
          [
            `[资料 ${index + 1}] 文件：${chunk.documentName}；片段：${chunk.chunkIndex}；相似度：${chunk.score.toFixed(4)}`,
            chunk.content
          ].join('\n')
        )
      ].join('\n')
    }
  ]
}

function buildMemoryMessages(memoryContext: QaMemoryContextMessage[]): ChatCompletionMessage[] {
  const normalizedMemories = memoryContext
    .map((memory) => ({
      type: memory.type,
      content: memory.content.trim()
    }))
    .filter((memory) => memory.content)

  if (normalizedMemories.length === 0) return []

  return [
    {
      role: 'system',
      content: [
        '以下是可参考的长期记忆。仅在相关时自然使用，不要生硬复述，也不要透露记忆系统。',
        ...normalizedMemories.map((memory) => '- [' + memory.type + '] ' + memory.content)
      ].join('\n')
    }
  ]
}

function normalizeConversationContext(
  conversationContext: QaConversationContextMessage[]
): ChatCompletionMessage[] {
  return conversationContext
    .map((message) => ({
      role: message.role,
      content: message.content.trim()
    }))
    .filter((message) => message.content)
}
