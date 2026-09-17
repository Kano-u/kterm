<script setup>
import { state } from '../store.js'
import { activeTerm, setView } from '../terminal.js'
</script>

<template>
  <nav
    class="flex flex-none items-center justify-center gap-2 bg-surface px-2 py-1.5 pb-[calc(env(safe-area-inset-bottom)+6px)]"
    aria-label="视图切换"
  >
    <button
      class="state-layer flex h-9 min-w-24 flex-none items-center justify-center gap-1.5 rounded-full px-4 text-[13px] transition-colors"
      :class="
        state.view === 'files'
          ? 'bg-primary-container font-medium text-on-primary-container'
          : 'bg-surface-3 text-on-surface-variant'
      "
      @click="setView('files')"
    >
      <span class="material-symbols-outlined" style="font-size: 18px">folder</span>
      文件
    </button>
    <button
      class="state-layer relative flex h-9 min-w-24 flex-none items-center justify-center gap-1.5 rounded-full px-4 text-[13px] transition-colors"
      :class="
        state.view === 'term'
          ? 'bg-primary-container font-medium text-on-primary-container'
          : 'bg-surface-3 text-on-surface-variant'
      "
      @click="setView('term')"
    >
      <span class="material-symbols-outlined" style="font-size: 18px">terminal</span>
      终端
      <!-- T3：busy 转圈指示 -->
      <span
        v-if="activeTerm() && activeTerm().busy"
        class="material-symbols-outlined absolute right-2 animate-spin text-primary"
        style="font-size: 16px"
      >progress_activity</span>
    </button>
  </nav>
</template>
