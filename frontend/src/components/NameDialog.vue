<script setup>
import { ref, watch, nextTick } from 'vue'
import { dialogState, closeDialog } from '../dialog.js'
import { toast } from '../toast.js'
import Icon from './Icon.vue'

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
      <!-- M3 对话框：28dp 圆角 -->
      <div
        role="dialog"
        aria-modal="true"
        class="m3-pop w-full max-w-md rounded-[28px] bg-surface-2 p-6 pb-4 shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
      >
        <div class="mb-4 truncate text-xl font-normal text-on-surface">{{ dialogState.title }}</div>
        <input
          ref="input"
          v-model="dialogState.value"
          type="text"
          autocomplete="off"
          spellcheck="false"
          class="h-14 w-full rounded-xl bg-surface-3 px-4 text-[15px] text-on-surface caret-primary outline-none focus:ring-2 focus:ring-primary/60"
          @keydown="onKeydown"
        >
        <div class="mt-5 flex items-center justify-between gap-2">
          <button
            class="state-layer flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant"
            title="插入点号"
            @click="insertDot"
          >
            <span class="text-lg font-bold">.</span>
          </button>
          <div class="flex gap-1">
            <button
              class="state-layer flex h-11 flex-none items-center rounded-full px-4 text-sm font-medium text-primary"
              @click="closeDialog(null)"
            >
              取消
            </button>
            <template v-if="dialogState.mode === 'new'">
              <button
                class="state-layer flex h-11 flex-none items-center gap-1.5 rounded-full px-4 text-sm font-medium text-primary"
                @click="submitNew('file')"
              >
                <Icon name="note_add" :size="20" />
                文件
              </button>
              <button
                class="state-layer flex h-11 flex-none items-center gap-1.5 rounded-full px-4 text-sm font-medium text-primary"
                @click="submitNew('dir')"
              >
                <Icon name="create_new_folder" :size="20" />
                文件夹
              </button>
            </template>
            <button
              v-else
              class="state-layer flex h-11 flex-none items-center rounded-full px-4 text-sm font-medium text-primary"
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
