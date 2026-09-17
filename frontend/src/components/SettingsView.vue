<script setup>
/* SettingsView：底部任务栏的「设置」整页视图。
 *
 * 「键盘增强」平时只占一行（标题 + 开关 + 展开箭头），点击标题行才展开按键布局编辑，
 * 避免设置页一进来就被大块内容占满。设置保存在服务端 <root>/.kfm-settings.json。
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  settings, keyRows, parseKeyText, rowsToText, saveSettings,
  DEFAULT_KEY_TEXT,
} from '../settings.js'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import Icon from './Icon.vue'

const open = ref(false) // 「键盘增强」是否展开
const text = ref(rowsToText(keyRows.value))
const error = ref('')
const saving = ref(false)
const enabled = ref(settings.keyBarEnabled)

/* 用「解析成功后的规范化文本」比较，避免缩进/大小写差异造成假脏 */
const baseline = ref(rowsToText(keyRows.value))
const dirty = computed(
  () => text.value !== baseline.value || enabled.value !== settings.keyBarEnabled,
)

/* 服务端设置到达后（App 启动异步）同步一次编辑器内容；用户已改动时不覆盖 */
watch(
  () => [settings.keys, settings.keyBarEnabled],
  () => {
    if (dirty.value) return
    const t = rowsToText(keyRows.value)
    text.value = t
    baseline.value = t
    enabled.value = settings.keyBarEnabled
  },
  { deep: true },
)

/* 预览：解析文本框得到按键（失败则用当前生效的布局） */
const preview = computed(() => {
  const res = parseKeyText(text.value)
  return res.error ? keyRows.value : res.rows
})

/* 未保存时离开页面给一次提示 */
function onBeforeUnload(ev) {
  if (!dirty.value) return
  ev.preventDefault()
  ev.returnValue = '设置尚未保存，确定离开吗？'
  return ev.returnValue
}

onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

function onInput() {
  error.value = ''
}

async function onSave() {
  const res = parseKeyText(text.value)
  if (res.error) {
    error.value = res.error
    toast(res.error)
    return
  }
  saving.value = true
  try {
    await saveSettings({
      keys: res.rows.map((row) => row.map((k) => k.name)),
      keyBarEnabled: enabled.value,
    })
    const normalized = rowsToText(res.rows)
    text.value = normalized
    baseline.value = normalized
    error.value = ''
    toast('设置已保存', 'ok')
  } catch (err) {
    error.value = err.message
    toast(err.message)
  } finally {
    saving.value = false
  }
}

async function onReset() {
  const ok = await confirm({
    title: '恢复默认设置',
    message: '将把按键布局恢复为默认的两行（ESC/TAB/CTRL/ALT/-/↑/ENTER 与 INS/END/SHIFT/:/←/↓/→）。',
    okText: '恢复默认',
  })
  if (!ok) return
  text.value = DEFAULT_KEY_TEXT
  enabled.value = true
  error.value = ''
}
</script>

<template>
  <main class="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface-1 px-3 py-3">
    <h1 class="mb-3 px-1 text-lg text-on-surface">设置</h1>

    <!-- 键盘增强：折叠成一项，点击标题行展开 -->
    <section class="overflow-hidden rounded-2xl bg-surface-2">
      <div class="flex items-center gap-1 px-3 py-2.5">
        <button
          class="state-layer flex min-w-0 flex-1 items-center gap-2 rounded-xl py-1 text-left"
          :aria-expanded="open"
          @click="open = !open"
        >
          <Icon name="keyboard" :size="20" class="flex-none text-primary" />
          <span class="min-w-0 flex-1 truncate text-[15px] text-on-surface">键盘增强</span>
          <span class="truncate text-[12px] text-on-surface-variant/80">
            {{ enabled ? '已开启' : '已关闭' }}
          </span>
          <span
            class="material-symbols-outlined flex-none text-on-surface-variant transition-transform"
            :class="open ? 'rotate-180' : ''"
            style="font-size: 20px"
          >expand_more</span>
        </button>
        <!-- 开关：不展开也能快速启停 -->
        <button
          class="state-layer relative h-7 w-12 flex-none rounded-full transition-colors"
          :class="enabled ? 'bg-primary' : 'bg-surface-3'"
          role="switch"
          :aria-checked="enabled"
          :title="enabled ? '关闭键盘增强' : '开启键盘增强'"
          @click="enabled = !enabled"
        >
          <span
            class="absolute top-1 h-5 w-5 rounded-full transition-all"
            :class="enabled ? 'left-6 bg-on-primary' : 'left-1 bg-on-surface-variant'"
          />
        </button>
      </div>

      <!-- 展开区 -->
      <div v-if="open" class="border-t border-outline-variant/40 px-3 pb-3 pt-3">
        <p class="mb-2 text-[12px] leading-relaxed text-on-surface-variant">
          终端视图下弹出软键盘时，底部会显示按键栏（顶替「文件/终端/设置」）。
          CTRL / ALT / SHIFT 为粘滞修饰键：点亮后再点其他键即组合发送（如 CTRL → C），再点一次自己取消。
        </p>

        <div class="mb-1 text-[12px] text-on-surface-variant">按键布局</div>
        <p class="mb-2 text-[11px] leading-relaxed text-on-surface-variant/80">
          二维数组，外层每项一行。可用键名（大小写不敏感）：ESC TAB ENTER UP DOWN LEFT RIGHT
          INS DEL HOME END PGUP PGDN BACKSPACE SPACE CTRL ALT SHIFT，以及任意单字符
          （<code>-</code> <code>:</code> <code>a</code> …）。组合键写成 <code>"CTRL+C"</code>。
          未知名字按字面发送（<code>"F1"</code> 会发送 <code>F1</code> 两个字符）。
        </p>
        <textarea
          v-model="text"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          rows="6"
          class="w-full resize-y rounded-xl bg-surface-3 p-2.5 font-mono text-[11px] leading-relaxed text-on-surface caret-primary outline-none focus:ring-2 focus:ring-primary/60"
          @input="onInput"
        />
        <p v-if="error" class="mt-1.5 text-[12px] text-error">{{ error }}</p>

        <!-- 预览 -->
        <div class="mt-3 mb-1 text-[12px] text-on-surface-variant">预览</div>
        <div class="rounded-xl bg-surface-3/60 p-1.5">
          <div v-for="(row, i) in preview" :key="i" class="flex items-stretch gap-0.5 py-0.5">
            <span
              v-for="(k, j) in row"
              :key="k.name + '-' + j"
              class="flex h-7 min-w-0 flex-1 basis-0 items-center justify-center overflow-hidden rounded-md px-0.5 text-[11px] font-medium whitespace-nowrap"
              :class="k.mod ? 'bg-primary/20 text-primary' : 'bg-surface-3 text-on-surface'"
            >
              <span class="truncate">{{ k.label }}</span>
            </span>
          </div>
        </div>

        <div class="mt-3 flex items-center justify-end gap-1">
          <span v-if="dirty" class="mr-auto pl-1 text-[12px] text-tertiary">有未保存的修改</span>
          <button
            class="state-layer flex h-9 flex-none items-center rounded-full px-3.5 text-[13px] text-on-surface-variant"
            :disabled="saving"
            @click="onReset"
          >
            恢复默认
          </button>
          <button
            class="state-layer flex h-9 flex-none items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-medium text-on-primary transition-opacity disabled:pointer-events-none disabled:opacity-40"
            :disabled="saving || !dirty"
            @click="onSave"
          >
            <Icon name="save" :size="16" />
            保存
          </button>
        </div>
      </div>
    </section>

    <p class="mt-2.5 px-1 text-[11px] leading-relaxed text-on-surface-variant/70">
      设置保存在根目录的 <code>.kfm-settings.json</code>（不会出现在文件列表中）。
    </p>
  </main>
</template>
