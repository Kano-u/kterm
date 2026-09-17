<script setup>
/* StartupSettings：设置 → 启动命令 的独立页面。
 *
 * 启动命令保存在 <起始目录>/.kfm-settings.json 的 startupCommand 字段（属于用户设置，
 * 不是编译进程序的平台默认值），kfm 启动时读取它并执行，典型用途：
 *   termux-open-url {url}   ← 在 Termux 里自动打开服务器网页
 * 模板中的 {url} 会替换成实际服务地址；留空 = 启动时不执行任何东西。
 *
 * 左上角返回按钮与安卓返回手势等价（都走 history，由 settingsnav.js 统一落实层级）。
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { settings, parseStartupCommand, argvToText, saveSettings, URL_PLACEHOLDER } from '../settings.js'
import { backSettings, setSettingsGuard } from '../settingsnav.js'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import Icon from './Icon.vue'

/* 预览用的服务地址：当前页面来源即服务地址 */
const origin = globalThis.location?.origin || 'http://127.0.0.1:8080'

const text = ref(settings.startupCommand)
const baseText = ref(settings.startupCommand)
const error = ref('')
const saving = ref(false)

const dirty = computed(() => text.value !== baseText.value)

/* 服务端设置到达后（启动异步）同步文本框；用户已改动时不覆盖 */
watch(
  () => settings.startupCommand,
  (v) => {
    if (dirty.value) return
    text.value = v
    baseText.value = v
  },
)

/* 预览：解析当前文本得到真实执行的 argv */
const preview = computed(() => parseStartupCommand(text.value, origin))

const PRESETS = [
  { label: 'Termux', text: `termux-open-url ${URL_PLACEHOLDER}` },
  { label: 'Linux', text: `xdg-open ${URL_PLACEHOLDER}` },
  { label: 'macOS', text: `open ${URL_PLACEHOLDER}` },
  { label: 'Windows', text: `rundll32 url.dll,FileProtocolHandler ${URL_PLACEHOLDER}` },
]

function usePreset(p) {
  text.value = p.text
  error.value = ''
}

/* 返回时若有未保存改动，先问一句（返回按钮与返回手势都经过这里） */
async function guardLeave() {
  if (!dirty.value) return true
  return await confirm({
    title: '放弃未保存的修改？',
    message: '启动命令尚未保存，返回后这些修改将丢失。',
    okText: '放弃修改',
  })
}

/* 刷新/关闭页面时也拦一次 */
function onBeforeUnload(ev) {
  if (!dirty.value) return
  ev.preventDefault()
  ev.returnValue = '设置尚未保存，确定离开吗？'
  return ev.returnValue
}

onMounted(() => {
  setSettingsGuard(guardLeave)
  window.addEventListener('beforeunload', onBeforeUnload)
})
onUnmounted(() => {
  setSettingsGuard(null)
  window.removeEventListener('beforeunload', onBeforeUnload)
})

async function onSave() {
  const src = text.value.trim()
  if (src) {
    const res = parseStartupCommand(src, origin)
    if (res.error) {
      error.value = res.error
      toast(res.error)
      return
    }
  }
  saving.value = true
  try {
    const saved = await saveSettings({ startupCommand: src })
    text.value = saved.startupCommand
    baseText.value = saved.startupCommand
    error.value = ''
    toast(saved.startupCommand ? '启动命令已保存，下次启动生效' : '已关闭启动命令', 'ok')
  } catch (err) {
    error.value = err.message
    toast(err.message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-1">
    <!-- 顶部栏：返回 + 标题 + 保存 -->
    <header class="flex flex-none items-center gap-1 border-b border-outline-variant/40 px-1.5 py-1">
      <button
        class="state-layer flex h-9 w-9 flex-none items-center justify-center rounded-full text-on-surface"
        title="返回"
        aria-label="返回"
        @click="backSettings"
      >
        <Icon name="arrow_back" :size="20" />
      </button>
      <span class="min-w-0 flex-1 truncate px-1 text-[15px] text-on-surface">启动命令</span>
      <span v-if="dirty" class="flex-none pr-1 text-[11px] text-tertiary">未保存</span>
      <button
        class="state-layer flex h-9 flex-none items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-medium text-on-primary transition-opacity disabled:pointer-events-none disabled:opacity-40"
        :disabled="saving || !dirty"
        @click="onSave"
      >
        <Icon name="save" :size="16" />
        保存
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
      <!-- 说明 + 输入 -->
      <div class="rounded-2xl bg-surface-2 px-3 py-3">
        <div class="mb-1.5 text-[13px] text-on-surface">启动时执行的命令</div>
        <p class="mb-2.5 text-[11px] leading-relaxed text-on-surface-variant">
          kfm 启动后执行这条命令，可用来打开服务器网页（例如 Termux 里的
          <code>termux-open-url</code>）。<code>{{ URL_PLACEHOLDER }}</code>
          会替换为实际服务地址（{{ origin }}）；没有写
          <code>{{ URL_PLACEHOLDER }}</code> 时地址追加到末尾。留空则启动时不执行任何东西。
        </p>
        <input
          v-model="text"
          type="text"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          placeholder="termux-open-url {url}"
          class="w-full rounded-xl bg-surface-3 px-2.5 py-2 font-mono text-[12px] text-on-surface caret-primary outline-none focus:ring-2 focus:ring-primary/60"
          @input="(error = '')"
        />
        <p v-if="error" class="mt-1.5 text-[12px] text-error">{{ error }}</p>

        <!-- 预设 -->
        <div class="mt-2.5 flex flex-wrap gap-1.5">
          <button
            v-for="p in PRESETS"
            :key="p.label"
            class="state-layer rounded-full bg-surface-3 px-3 py-1.5 text-[11px] text-on-surface-variant"
            @click="usePreset(p)"
          >
            {{ p.label }}
          </button>
          <button
            class="state-layer rounded-full bg-surface-3 px-3 py-1.5 text-[11px] text-on-surface-variant"
            @click="text = ''"
          >
            清空（不自动打开）
          </button>
        </div>
      </div>

      <!-- 预览 -->
      <div class="mt-3 rounded-2xl bg-surface-2 px-3 py-3">
        <div class="mb-1.5 text-[13px] text-on-surface">预览</div>
        <p v-if="preview.error" class="text-[12px] text-error">{{ preview.error }}</p>
        <template v-else-if="!preview.argv.length">
          <p class="text-[12px] text-on-surface-variant">启动时不执行任何命令。</p>
        </template>
        <template v-else>
          <p class="mb-1.5 text-[11px] text-on-surface-variant">
            实际执行（不经过 shell，管道与重定向不会被解释）：
          </p>
          <pre
            class="overflow-x-auto rounded-xl bg-surface-3/60 p-2.5 font-mono text-[11px] leading-relaxed text-on-surface"
          >{{ argvToText(preview.argv) }}</pre>
        </template>
      </div>

      <p class="px-1 pt-3 pb-1 text-[11px] leading-relaxed text-on-surface-variant/70">
        设置保存在起始目录的 <code>.kfm-settings.json</code>（不会出现在文件列表中）。
        命令由 kfm 进程以当前用户身份执行，请只填写自己信任的命令。
      </p>
    </div>
  </main>
</template>
