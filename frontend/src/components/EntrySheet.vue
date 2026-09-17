<script setup>
import { ask } from '../dialog.js'
import { doRename, confirmDelete } from '../actions.js'
import { fmtSize, fmtTime, activeTab } from '../store.js'
import { activeBusy } from '../terminal.js'
import { openEditor } from '../editor.js'
import { isTextName } from '../editor-lang.js'
import Icon from './Icon.vue'
import { fileIcon } from '../icons.js'

const props = defineProps({
  entry: { type: Object, required: true },
})
const emit = defineEmits(['close'])

/* 仅文本文件可编辑（仿终端 running 锁定：终端运行中不开放写操作）。
 * props.entry 理论上必填，但缺 prop 时抛错会连带炸掉整棵组件树，故按空条目处理。 */
function canEdit() {
  const e = props.entry
  return !!e && !e.isDir && isTextName(e.name)
}

async function onEdit() {
  const entry = props.entry
  emit('close')
  await openEditor(activeTab(), entry)
}

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

async function onDelete() {
  const entry = props.entry
  emit('close')
  await confirmDelete([entry.name])
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/45" @click.self="emit('close')">
      <!-- M3 bottom sheet -->
      <div
        role="dialog"
        aria-modal="true"
        class="m3-elevate mb-[calc(env(safe-area-inset-bottom)+8px)] w-full max-w-lg rounded-t-[28px] bg-surface-2 pb-3 pt-3 shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
      >
        <!-- drag handle -->
        <div class="mx-auto mb-3 h-1 w-8 rounded-full bg-on-surface-variant/40" />

        <div class="flex items-center gap-3 px-6">
          <span class="flex h-12 w-12 flex-none items-center justify-center text-primary">
            <Icon :name="fileIcon(entry)" :size="30" :filled="entry.isDir" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-base text-on-surface">{{ entry.name }}</div>
            <div class="text-[13px] text-on-surface-variant">{{ entry.isDir ? '文件夹' : '文件' }}</div>
          </div>
        </div>

        <div class="mt-3 flex items-center gap-3 px-6 py-1 text-[13px] text-on-surface-variant">
          <Icon name="data_usage" :size="18" />
          大小：{{ entry.isDir ? '—' : fmtSize(entry.size) }}
        </div>
        <div class="flex items-center gap-3 px-6 py-1 text-[13px] text-on-surface-variant">
          <Icon name="schedule" :size="18" />
          修改时间：{{ fmtTime(entry.mtime) }}
        </div>

        <div class="mt-4 flex justify-end gap-1 px-4">
          <button
            class="state-layer flex h-12 flex-none items-center rounded-full px-5 text-sm font-medium text-primary"
            @click="emit('close')"
          >
            关闭
          </button>
          <button
            v-if="canEdit()"
            class="state-layer flex h-12 flex-none items-center gap-1.5 rounded-full px-5 text-sm font-medium text-primary transition-opacity disabled:pointer-events-none disabled:opacity-35"
            :disabled="activeBusy()"
            :title="activeBusy() ? '终端正在运行命令' : '编辑'"
            @click="onEdit"
          >
            <Icon name="edit_document" :size="20" />
            编辑
          </button>
          <button
            class="state-layer flex h-12 flex-none items-center gap-1.5 rounded-full px-5 text-sm font-medium text-error transition-opacity disabled:pointer-events-none disabled:opacity-35"
            :disabled="activeBusy()"
            :title="activeBusy() ? '终端正在运行命令' : '删除'"
            @click="onDelete"
          >
            <Icon name="delete" :size="20" />
            删除
          </button>
          <button
            class="state-layer flex h-12 flex-none items-center gap-1.5 rounded-full px-5 text-sm font-medium text-primary transition-opacity disabled:pointer-events-none disabled:opacity-35"
            :disabled="activeBusy()"
            :title="activeBusy() ? '终端正在运行命令' : '重命名'"
            @click="onRename"
          >
            <Icon name="edit" :size="20" />
            重命名
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
