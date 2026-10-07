<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import anhunquSpriteUrl from '../assets/anhunqu/spritesheet.webp'
import { useSpeechSynthesis } from '../composables/useSpeechSynthesis'
import ChatInput from './ChatInput.vue'
import SpeechBubble from './SpeechBubble.vue'

type PetState = 'idle' | 'happy' | 'sleep'

const speeches = [
  '你好呀，我是 MeiDou。',
  '今天也要认真做完你的事情。',
  '别忘了保存代码哦。',
  '摸摸头，心情变好了。',
  '我会乖乖待在桌面上的。'
]

const petState = ref<PetState>('idle')
const bubbleText = ref('')
const bubbleVisible = ref(false)
const chatVisible = ref(false)
const isAsking = ref(false)
const isDragging = ref(false)

let bubbleTimer: number | undefined
let clickTimer: number | undefined
let happyTimer: number | undefined
let sleepTimer: number | undefined
let startX = 0
let startY = 0
let lastX = 0
let lastY = 0
let totalMove = 0
let removePetStateListener: (() => void) | undefined
const petSpriteStyle = {
  '--pet-sprite-url': `url("${anhunquSpriteUrl}")`
}
const { speak, stop: stopSpeaking } = useSpeechSynthesis()

function onPetClick(): void {
  wakePet()
  showRandomSpeech()
  setHappyState()
}

function showRandomSpeech(): void {
  const index = Math.floor(Math.random() * speeches.length)
  showSpeech(speeches[index])
}

function showSpeech(text: string, duration = 3000): void {
  bubbleText.value = text
  bubbleVisible.value = true

  window.clearTimeout(bubbleTimer)
  bubbleTimer = window.setTimeout(() => {
    bubbleVisible.value = false
  }, duration)
}

function schedulePetClick(): void {
  window.clearTimeout(clickTimer)
  clickTimer = window.setTimeout(() => {
    onPetClick()
    clickTimer = undefined
  }, 220)
}

function onPetDoubleClick(): void {
  window.clearTimeout(clickTimer)
  clickTimer = undefined
  wakePet()
  chatVisible.value = !chatVisible.value
}

async function onChatSubmit(text: string): Promise<void> {
  if (isAsking.value) return

  wakePet()
  isAsking.value = true
  setPetState('happy')
  window.clearTimeout(happyTimer)

  try {
    const response = await window.meidouAPI.askQuestion(text)
    showSpeech(response.answer, 4000)
    const voice = await getAnswerVoiceConfig()
    if (voice) {
      speak(response.answer, voice)
    } else {
      stopSpeaking()
    }
  } catch {
    showSpeech('我刚刚没想出来，可以再问我一次吗？', 4000)
    stopSpeaking()
  } finally {
    isAsking.value = false
    happyTimer = window.setTimeout(() => {
      setPetState('idle')
      resetSleepTimer()
    }, 4000)
  }
}

function onChatClose(): void {
  chatVisible.value = false
}

async function getAnswerVoiceConfig(): Promise<VoiceConfig | undefined> {
  try {
    const { voice } = await window.meidouAPI.getManagementConfig()
    if (voice.enabled && voice.autoSpeakAnswer && voice.engine === 'system') {
      return voice
    }
  } catch {
  }

  return undefined
}

function setHappyState(): void {
  setPetState('happy')

  window.clearTimeout(happyTimer)
  happyTimer = window.setTimeout(() => {
    setPetState('idle')
    resetSleepTimer()
  }, 2200)
}

function wakePet(): void {
  if (petState.value === 'sleep') {
    setPetState('idle')
  }

  resetSleepTimer()
}

function resetSleepTimer(): void {
  window.clearTimeout(sleepTimer)
  sleepTimer = window.setTimeout(() => {
    if (!isDragging.value && petState.value === 'idle') {
      setPetState('sleep')
      bubbleVisible.value = false
    }
  }, 15000)
}

function setSleepMode(shouldSave = true): void {
  window.clearTimeout(happyTimer)
  window.clearTimeout(sleepTimer)
  bubbleVisible.value = false
  setPetState('sleep', shouldSave)
}

function setPetState(state: PetState, shouldSave = true): void {
  petState.value = state

  if (shouldSave) {
    window.meidouAPI.savePetState(state)
  }
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return

  wakePet()
  isDragging.value = true
  startX = event.screenX
  startY = event.screenY
  lastX = event.screenX
  lastY = event.screenY
  totalMove = 0

  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (!isDragging.value) return

  const deltaX = event.screenX - lastX
  const deltaY = event.screenY - lastY

  totalMove = Math.hypot(event.screenX - startX, event.screenY - startY)
  lastX = event.screenX
  lastY = event.screenY

  if (deltaX !== 0 || deltaY !== 0) {
    window.meidouAPI.moveWindowBy(deltaX, deltaY)
  }
}

function onPointerUp(event: PointerEvent): void {
  if (!isDragging.value) return

  isDragging.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId)
  }
  window.meidouAPI.saveWindowPosition()

  if (totalMove < 6) {
    schedulePetClick()
  } else {
    setPetState('idle')
    resetSleepTimer()
  }
}

onBeforeUnmount(() => {
  removePetStateListener?.()
  window.clearTimeout(bubbleTimer)
  window.clearTimeout(clickTimer)
  window.clearTimeout(happyTimer)
  window.clearTimeout(sleepTimer)
  stopSpeaking()
})

onMounted(async () => {
  const savedState = await window.meidouAPI.getPetState()

  if (savedState === 'sleep') {
    setSleepMode(false)
  } else {
    setPetState(savedState, false)
    resetSleepTimer()
  }

  removePetStateListener = window.meidouAPI.onPetStateChanged((state) => {
    if (state === 'sleep') {
      setSleepMode()
    } else {
      setPetState(state)
      resetSleepTimer()
    }
  })
})
</script>

<template>
  <main class="pet-stage">
    <SpeechBubble :text="bubbleText" :visible="bubbleVisible" />
    <ChatInput :visible="chatVisible" :pending="isAsking" @close="onChatClose" @submit="onChatSubmit" />

    <button
      class="pet"
      :class="`pet--${petState}`"
      type="button"
      aria-label="MeiDou pet"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @dblclick.stop="onPetDoubleClick"
    >
      <span class="pet__sprite" :style="petSpriteStyle" aria-hidden="true"></span>
    </button>
  </main>
</template>

<style scoped>
.pet-stage {
  position: relative;
  width: 240px;
  height: 280px;
  overflow: hidden;
  background: transparent;
}

.pet {
  position: absolute;
  left: 50%;
  bottom: 54px;
  width: 128px;
  height: 144px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: grab;
  outline: none;
  touch-action: none;
  -webkit-app-region: no-drag;
  transform-origin: bottom center;
  transform: translateX(-50%);
  transition:
    filter 200ms ease,
    transform 200ms ease;
  z-index: 1;
}

.pet:active {
  cursor: grabbing;
}

.pet--happy {
  filter: saturate(1.25) brightness(1.06);
  transform: translateX(-50%) translateY(-3px);
}

.pet--sleep {
  filter: saturate(0.65) brightness(0.92);
  transform: translateX(-50%) translateY(2px) scale(0.96);
}

.pet__sprite {
  --pet-row-offset: 0;
  --pet-frame-end: -1344px;
  --pet-duration: 1400ms;

  position: absolute;
  left: 50%;
  bottom: 0;
  display: block;
  width: 192px;
  height: 208px;
  background-image: var(--pet-sprite-url);
  background-repeat: no-repeat;
  background-size: 1536px 2288px;
  background-position: 0 var(--pet-row-offset);
  image-rendering: pixelated;
  transform: translateX(-50%) scale(0.59);
  transform-origin: bottom center;
  animation-name: pet-sprite-step;
  animation-duration: var(--pet-duration);
  animation-timing-function: steps(7);
  animation-iteration-count: infinite;
}

.pet--happy .pet__sprite {
  --pet-row-offset: -624px;
  --pet-frame-end: -768px;
  --pet-duration: 720ms;

  animation-timing-function: steps(4);
}

.pet--sleep .pet__sprite {
  --pet-row-offset: -1040px;
  --pet-frame-end: -1536px;
  --pet-duration: 1600ms;

  animation-timing-function: steps(8);
}

@keyframes pet-sprite-step {
  from {
    background-position: 0 var(--pet-row-offset);
  }

  to {
    background-position: var(--pet-frame-end) var(--pet-row-offset);
  }
}
</style>
