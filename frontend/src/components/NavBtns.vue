<script setup>
import { activeTab } from '../store.js'
import { tabGo } from '../actions.js'

const tab = () => activeTab()
</script>

<template>
  <div class="pointer-events-none fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-40 flex flex-col gap-2">
    <button
      class="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-2xl shadow-lg transition-opacity dark:bg-zinc-800 press disabled:pointer-events-none disabled:opacity-35"
      title="后退"
      :disabled="tab().histIdx <= 0"
      @click="tabGo(-1)"
    >
      ‹
    </button>
    <button
      class="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-2xl shadow-lg transition-opacity dark:bg-zinc-800 press disabled:pointer-events-none disabled:opacity-35"
      title="前进"
      :disabled="tab().histIdx >= tab().history.length - 1"
      @click="tabGo(1)"
    >
      ›
    </button>
  </div>
</template>
