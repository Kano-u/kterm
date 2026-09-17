<script setup>
import { onMounted, onUnmounted } from 'vue'
import Tabbar from './components/Tabbar.vue'
import Taskbar from './components/Taskbar.vue'
import Toolbar from './components/Toolbar.vue'
import Sortbar from './components/Sortbar.vue'
import FileList from './components/FileList.vue'
import TerminalView from './components/TerminalView.vue'
import SelectBar from './components/SelectBar.vue'
import PasteBar from './components/PasteBar.vue'
import NavBtns from './components/NavBtns.vue'
import Toast from './components/Toast.vue'
import Loading from './components/Loading.vue'
import NameDialog from './components/NameDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import EntrySheet from './components/EntrySheet.vue'
import { loadState, validateRestoredTabs, activeTab, state } from './store.js'
import { apiList } from './api.js'
import { onPopState, restorePath } from './actions.js'

/* 主题：固定深色（M3 baseline dark），不再跟随系统 prefers-color-scheme。
 * <html class="dark"> 已在 index.html 静态标注（避免首屏白闪），这里再兜底一次；
 * 色值令牌见 style.css，终端配色见 components/TerminalView.vue。 */
document.documentElement.classList.add('dark')

function fatal(msg) {
  document.getElementById('app').innerHTML =
    `<div style="padding:48px 24px;text-align:center;color:#cac4d0">加载失败: ${msg}</div>`
}

function onPop(ev) {
  onPopState(ev, restorePath)
}

/* 启动：恢复状态 → 校验各 tab 路径 → 注册返回手势 */
onMounted(async () => {
  const restored = loadState()
  if (restored) {
    await validateRestoredTabs(apiList)
  } else {
    const tab = activeTab()
    try {
      const data = await apiList('')
      tab.cache = { path: '', entries: data.entries || [] }
    } catch (err) {
      fatal(err.message)
      return
    }
  }
  const act = activeTab()
  history.replaceState({ tabId: act.id, path: act.path }, '')
  window.addEventListener('popstate', onPop)
})

onUnmounted(() => window.removeEventListener('popstate', onPop))
</script>

<template>
  <div class="flex h-dvh flex-col overflow-hidden bg-surface-1 text-on-surface">
    <Tabbar />
    <template v-if="state.view === 'files'">
      <Toolbar />
      <Sortbar />
    </template>

    <!-- 文件视图与终端视图互斥；终端层叠保留会话（v-show 由组件内部管理） -->
    <FileList v-show="state.view === 'files'" />
    <TerminalView v-show="state.view === 'term'" />

    <!-- 底部固定栏（多选与粘贴互斥显示，仅文件视图） -->
    <template v-if="state.view === 'files'">
      <SelectBar />
      <PasteBar />
    </template>

    <!-- 导航 FAB（仅文件视图） -->
    <NavBtns v-if="state.view === 'files'" />

    <!-- 底部任务栏：文件 | 终端 -->
    <Taskbar />

    <!-- 全局浮层 -->
    <Toast />
    <Loading />
    <NameDialog />
    <ConfirmDialog />
    <EntrySheet />
  </div>
</template>
