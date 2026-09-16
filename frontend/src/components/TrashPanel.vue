<script setup>
import { ref, watch } from 'vue'
import { apiGet } from '../api.js'
import { fmtTime, fmtSize, iconFor } from '../store.js'
import { restoreBatch, purgeBatch, emptyTrash } from '../actions.js'
import { confirm } from '../confirm.js'
import { toast } from '../toast.js'
import Icon from './Icon.vue'

const emit = defineEmits(['close'])

const items = ref([])
const loading = ref(true)
const busy = ref(false)

async function load() {
  loading.value = true
  try {
    const data = await apiGet('/api/trash')
    items.value = data.items || []
  } catch (err) {
    toast(err.message)
    items.value = []
  } finally {
    loading.value = false
  }
}

watch(() => true, load, { immediate: true })

function itemSummary(it) {
  if (it.names.length === 1) return it.names[0]
  return `${it.names[0]} 等 ${it.names.length} 项`
}

function totalNames(it) {
  return it.names.map((n) => (it.path ? it.path + '/' + n : n)).join('、')
}

async function onRestore(it) {
  if (busy.value) return
  busy.value = true
  try {
    if (await restoreBatch(it.id)) await load()
  } finally {
    busy.value = false
  }
}

async function onPurge(it) {
  if (busy.value) return
  const ok = await confirm({
    title: '彻底删除',
    message: `将永久删除“${itemSummary(it)}”，此操作不可恢复！`,
    okText: '彻底删除',
  })
  if (!ok) return
  busy.value = true
  try {
    if (await purgeBatch(it.id)) await load()
  } finally {
    busy.value = false
  }
}

async function onEmpty() {
  if (busy.value) return
  const ok = await confirm({
    title: '清空回收站',
    message: `将永久删除回收站内全部 ${items.value.length} 批条目，此操作不可恢复！`,
    okText: '全部删除',
  })
  if (!ok) return
  busy.value = true
  try {
    if (await emptyTrash()) await load()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/45" @click.self="emit('close')">
      <div
        role="dialog"
        aria-modal="true"
        class="m3-elevate flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-[28px] bg-surface-2 pb-[calc(env(safe-area-inset-bottom)+8px)] shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
      >
        <div class="mx-auto mt-3 mb-2 h-1 w-8 flex-none rounded-full bg-on-surface-variant/40" />

        <div class="flex flex-none items-center gap-2 px-4 pb-2">
          <Icon name="delete" :size="22" class="text-primary" />
          <span class="flex-1 text-lg text-on-surface">回收站</span>
          <button
            class="state-layer flex h-11 flex-none items-center rounded-full px-4 text-sm text-primary"
            @click="emit('close')"
          >
            关闭
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2">
          <div v-if="loading" class="py-10 text-center text-sm text-on-surface-variant">加载中…</div>
          <div v-else-if="items.length === 0" class="flex flex-col items-center gap-3 py-12 text-on-surface-variant/70">
            <Icon name="delete_sweep" :size="44" />
            <span class="text-sm">回收站是空的</span>
          </div>

          <div
            v-for="it in items"
            :key="it.id"
            class="mb-2 rounded-2xl bg-surface-3/60 px-4 py-3"
          >
            <div class="flex items-center gap-3">
              <span class="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon name="folder_delete" :size="22" />
              </span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-[15px] text-on-surface">{{ itemSummary(it) }}</div>
                <div class="truncate text-xs text-on-surface-variant">
                  {{ fmtTime(it.time) }} · 原位置：/{{ it.path || '' }}
                </div>
              </div>
            </div>
            <div class="mt-1 truncate px-1 text-xs text-on-surface-variant/80" :title="totalNames(it)">
              {{ totalNames(it) }}
            </div>
            <div class="mt-2 flex justify-end gap-1">
              <button
                class="state-layer flex h-10 flex-none items-center gap-1.5 rounded-full px-4 text-sm font-medium text-error"
                :disabled="busy"
                @click="onPurge(it)"
              >
                <Icon name="delete_forever" :size="18" />
                彻底删除
              </button>
              <button
                class="state-layer flex h-10 flex-none items-center gap-1.5 rounded-full bg-primary/10 px-4 text-sm font-medium text-primary"
                :disabled="busy"
                @click="onRestore(it)"
              >
                <Icon name="restore_from_trash" :size="18" />
                恢复
              </button>
            </div>
          </div>
        </div>

        <div v-if="!loading && items.length > 0" class="flex flex-none justify-center px-4 pt-2">
          <button
            class="state-layer flex h-11 flex-none items-center gap-1.5 rounded-full bg-error/10 px-5 text-sm font-medium text-error"
            :disabled="busy"
            @click="onEmpty"
          >
            <Icon name="auto_delete" :size="20" />
            清空回收站
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
