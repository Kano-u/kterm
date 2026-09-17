/* 「启动命令」设置的无依赖回归测试（纯 node，无第三方依赖）：
 *   cd frontend && node test/startup.test.mjs
 *
 * 启动命令保存在 <起始目录>/.kfm-settings.json 的 startupCommand 字段，kfm 启动时
 * 读取并执行（典型：termux-open-url {url}）。这里锁住三件事：
 *   1. parseStartupCommand 的解析契约：空白拆分、引号、{url} 替换、无占位符时追加地址；
 *   2. applySettings / saveSettings 的「部分更新」语义：保存键盘设置不会清空启动命令；
 *   3. argvToText 的预览回显。
 * 与服务端 fs.StartupArgv 的用例表保持一致（同一个契约的两侧实现）。
 */
const { settings, applySettings, saveSettings, parseStartupCommand, argvToText, MAX_STARTUP_LEN } =
  await import('../src/settings.js')

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL ' + msg)
    process.exitCode = 1
  } else console.log('ok   ' + msg)
}

const URL = 'http://127.0.0.1:8080'
const argvOf = (src) => parseStartupCommand(src, URL).argv
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/* ---------- 1. 模板 → argv ---------- */
{
  assert(eq(argvOf(''), []), '空模板 → 不执行任何命令')
  assert(eq(argvOf('   \t '), []), '纯空白 → 不执行任何命令')

  assert(eq(argvOf('termux-open-url {url}'), ['termux-open-url', URL]), '{url} 替换为服务地址')
  assert(eq(argvOf('xdg-open'), ['xdg-open', URL]), '无占位符时地址追加到末尾')
  assert(eq(argvOf('  open   {url}  '), ['open', URL]), '多余空白折叠')
  assert(eq(argvOf('cmd {url} --flag'), ['cmd', URL, '--flag']), '地址可以出现在中间')

  assert(
    eq(argvOf('sh -c "echo {url}"'), ['sh', '-c', 'echo ' + URL]),
    '双引号包裹含空格的参数',
  )
  assert(
    eq(argvOf("my-open '--title=My Page' {url}"), ['my-open', '--title=My Page', URL]),
    '单引号包裹含空格的参数',
  )
  assert(eq(argvOf('say "a\\"b" {url}'), ['say', 'a"b', URL]), '双引号内 \\" 转义')

  // 空字符串参数（'' 或 ""）不会被丢掉
  assert(eq(argvOf("cmd '' {url}"), ['cmd', '', URL]), '空引号参数保留')

  // 预览用的展示文本
  assert(argvToText(['my-open', '--title=My Page', URL]) === `my-open "--title=My Page" ${URL}`,
    'argvToText 给含空格的参数加引号')
}

/* ---------- 2. 错误提示 ---------- */
{
  const unclosed = parseStartupCommand('open "unterminated', URL)
  assert(!!unclosed.error, '引号未闭合报错')
  const tooLong = parseStartupCommand('x'.repeat(MAX_STARTUP_LEN + 1), URL)
  assert(!!tooLong.error, '超长报错')
  const multiline = parseStartupCommand('open {url}\nrm -rf /', URL)
  assert(!!multiline.error, '含换行报错')
}

/* ---------- 3. 设置的部分更新语义 ---------- */
{
  // 用假 fetch 拦截 /api/settings：原样回填请求体（服务端行为的最简模拟）
  const calls = []
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body)
    calls.push(body)
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, settings: body }),
    }
  }

  const keys = [['ESC', 'TAB']]
  await saveSettings({ keys, keyBarEnabled: false, startupCommand: 'termux-open-url {url}' })
  assert(settings.startupCommand === 'termux-open-url {url}', '启动命令保存后进入状态')
  assert(settings.keyBarEnabled === false, '按键栏开关保存后进入状态')

  // 只保存键盘页（不传 startupCommand）→ 启动命令不能被清空
  await saveSettings({ keys, keyBarEnabled: true })
  assert(calls[1].startupCommand === 'termux-open-url {url}', '只保存键盘设置时保留启动命令')
  assert(settings.startupCommand === 'termux-open-url {url}', '状态里的启动命令仍在')
  assert(settings.keyBarEnabled === true, '按键栏开关已更新')

  // 显式清空
  await saveSettings({ startupCommand: '' })
  assert(settings.startupCommand === '', '显式清空启动命令')
  assert(calls[2].keys === undefined || calls[2].keys.length > 0, '未传 keys 时沿用当前布局')
  assert(eq(calls[2].keys, keys), '未传 keys 时沿用当前布局')

  // 服务端缺字段（旧设置文件）→ 前端读成空，不报错
  applySettings({ keys, keyBarEnabled: true })
  assert(settings.startupCommand === '', '缺 startupCommand 字段读成空')
}

console.log(process.exitCode ? '\n有失败用例' : '\n全部通过')
