interface SpeechSynthesisControls {
  speak(text: string, options?: SpeechSynthesisOptions): void
  stop(): void
}

export interface SpeechSynthesisOptions {
  rate?: number
  volume?: number
  pitch?: number
  voiceName?: string
}

export function useSpeechSynthesis(): SpeechSynthesisControls {
  function getSpeechSynthesis(): SpeechSynthesis | undefined {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return undefined
    }

    return window.speechSynthesis
  }

  function speak(text: string, options: SpeechSynthesisOptions = {}): void {
    const trimmedText = text.trim()
    if (!trimmedText || typeof SpeechSynthesisUtterance === 'undefined') return

    const speechSynthesis = getSpeechSynthesis()
    if (!speechSynthesis) return

    try {
      speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(trimmedText)
      utterance.lang = 'zh-CN'
      utterance.rate = normalizeSpeechValue(options.rate, 1, 0.5, 1.5)
      utterance.volume = normalizeSpeechValue(options.volume, 1, 0, 1)
      utterance.pitch = normalizeSpeechValue(options.pitch, 1, 0.5, 1.5)

      const selectedVoice = findVoiceByName(speechSynthesis, options.voiceName)
      if (selectedVoice) {
        utterance.voice = selectedVoice
        utterance.lang = selectedVoice.lang || utterance.lang
      }

      speechSynthesis.speak(utterance)
    } catch (error) {
      console.warn('[tts] speech synthesis failed:', error)
    }
  }

  function stop(): void {
    getSpeechSynthesis()?.cancel()
  }

  return {
    speak,
    stop
  }
}

function normalizeSpeechValue(
  value: number | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue

  return Math.min(Math.max(value, minimum), maximum)
}

function findVoiceByName(
  speechSynthesis: SpeechSynthesis,
  voiceName: string | undefined
): SpeechSynthesisVoice | undefined {
  const normalizedVoiceName = voiceName?.trim()
  if (!normalizedVoiceName) return undefined

  return speechSynthesis.getVoices().find((voice) => voice.name === normalizedVoiceName)
}
