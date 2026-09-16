<script setup>
import { state } from '../store.js'
import { toast } from '../toast.js'
import { ask } from '../dialog.js'
import { doRename, pasteClipboard } from '../actions.js'
import { fmtSize, fmtTime } from '../store.js'

const props = defineProps({
  entry: { type: Object, required: true },
})
const emit = defineEmits(['close'])

async function onRename() {
  const entry = props.entry
  emit('close')
  const newName = await ask({
    title: '重命名',
    value: entry.name,
    selectBase: true,
  })
  if (newName === null || newName === entry.name) return
  await doRename(entry, newName)
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/45" @click.self="emit('close')">
      <div
        role="dialog"
        aria-modal="true"
        class="mb-[calc(env(safe-area-inset-bottom)+8px)] w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-zinc-900 pop-in"
      >
        <div class="mb-2 truncate text-base font-semibold">{{ entry.name }}</div>
        <div class="mb-1 text-[13px] leading-7 text-zinc-500 dark:text-zinc-400">
          {{ entry.isDir ? '文件夹' : '文件' }}
        </div>
        <div class="mb-1 text-[13px] leading-7 text-zinc-500 dark:text-zinc-400">
          大小：{{ entry.isDir ? '—' : fmtSize(entry.size) }}
        </div>
        <div class="mb-4 text-[13px] leading-7 text-zinc-500 dark:text-zinc-400">
          修改时间：{{ fmtTime(entry.mtime) }}
        </div>
        <div class="flex justify-end gap-2">
          <button
            class="h-11 rounded-xl bg-zinc-100 px-5 text-sm dark:bg-zinc-800 press"
            @click="emit('close')"
          >
            关闭
          </button>
          <button
            class="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white press"
            @click="onRename"
          >
            重命名
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
