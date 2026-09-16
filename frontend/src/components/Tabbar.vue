<script setup>
import { state, baseName, tabTitle } from '../store.js'
import { addTab, closeTab, switchTab } from '../actions.js'
</script>

<template>
  <nav
    class="flex flex-none items-center gap-1.5 overflow-x-auto border-b border-zinc-200 bg-white px-2 py-1 no-scrollbar dark:border-zinc-800 dark:bg-zinc-900"
    aria-label="标签页"
  >
    <div
      v-for="t in state.tabs"
      :key="t.id"
      class="flex max-w-[40vw] flex-none cursor-pointer items-center gap-1 rounded-lg px-2 min-h-10 transition-colors"
      :class="
        t.id === state.activeTabId
          ? 'bg-indigo-600 text-white'
          : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
      "
      @click="switchTab(t.id)"
    >
      <span class="truncate text-[13px] leading-tight">{{ baseName(t.path) }}</span>
      <span v-if="tabTitle(t)" class="flex-none text-[10px] leading-none opacity-80">{{ tabTitle(t) }}</span>
      <button
        class="-mr-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-[15px] leading-none hover:bg-black/10 dark:hover:bg-white/10"
        title="关闭标签"
        @click.stop="closeTab(t.id)"
      >
        ×
      </button>
    </div>
    <button
      class="min-h-10 flex-none rounded-lg px-2.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 press"
      title="新建标签"
      @click="addTab()"
    >
      +
    </button>
  </nav>
</template>
