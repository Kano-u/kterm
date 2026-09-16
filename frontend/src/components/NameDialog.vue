<script setup>
import { ref, watch, nextTick } from 'vue'
import { dialogState, closeDialog } from '../dialog.js'
import { toast } from '../toast.js'

const input = ref(null)

watch(
  () => dialogState.show,
  async (show) => {
    if (!show) return
    await nextTick()
    const el = input.value
    if (!el) return
    el.focus()
    // 选中主名（不含扩展名），方便改名
    if (dialogState.selectBase) {
      const v = el.value
      const dot = v.lastIndexOf('.')
      el.setSelectionRange(0, dot > 0 ? dot : v.length)
    }
  },
)

function inputName() {
  const v = (input.value?.value || '').trim()
  if (!v) {
    toast('名称不能为空')
    return null
  }
  return v
}

function submitText() {
  const v = inputName()
  if (v !== null) closeDialog(v)
}

function submitNew(kind) {
  const v = inputName()
  if (v !== null) closeDialog({ name: v, kind })
}

function insertDot() {
  const el = input.value
  if (!el) return
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  el.value = el.value.slice(0, start) + '.' + el.value.slice(end)
  const pos = start + 1
  el.setSelectionRange(pos, pos)
  el.focus()
}

function onKeydown(ev) {
  if (ev.key === 'Enter') {
    ev.preventDefault()
    // 新建模式下 Enter 默认创建文件夹
    if (dialogState.mode === 'new') submitNew('dir')
    else submitText()
  }
  if (ev.key === 'Escape') closeDialog(null)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="dialogState.show"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
      @click.self="closeDialog(null)"
    >
      <div
        role="dialog"
        aria-modal="true"
        class="w-full max-w-md rounded-2xl bg-white p-5 pb-3 shadow-2xl dark:bg-zinc-900 pop-in"
      >
        <div class="mb-3 truncate text-base font-semibold">{{ dialogState.title }}</div>
        <input
          ref="input"
          v-model="dialogState.value"
          type="text"
          autocomplete="off"
          spellcheck="false"
          class="h-12 w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800"
          @keydown="onKeydown"
        >
        <div class="mt-3 flex items-center justify-between gap-2">
          <div class="flex gap-2">
            <button
              class="h-11 rounded-xl bg-zinc-100 px-4 text-sm dark:bg-zinc-800 press"
              @click="closeDialog(null)"
            >
              取消
            </button>
            <button
              class="h-11 w-11 rounded-xl bg-zinc-100 text-lg font-bold dark:bg-zinc-800 press"
              title="插入点号"
              @click="insertDot"
            >
              .
            </button>
          </div>
          <div class="flex gap-2">
            <template v-if="dialogState.mode === 'new'">
              <button
                class="h-11 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white press"
                @click="submitNew('file')"
              >
                文件
              </button>
              <button
                class="h-11 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white press"
                @click="submitNew('dir')"
              >
                文件夹
              </button>
            </template>
            <button
              v-else
              class="h-11 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white press"
              @click="submitText"
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
