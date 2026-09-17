// Command kfm 是一个运行于 Android/Termux 的极简文件管理器。
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os/exec"
	"strconv"
	"time"

	"kfm/internal/fs"
	"kfm/internal/server"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "监听地址")
	lan := flag.Bool("lan", false, "允许局域网设备访问（默认关闭，仅本机；-lan 监听所有网卡）")
	flag.Parse()

	host, portStr, err := net.SplitHostPort(*addr)
	if err != nil {
		log.Fatalf("无效的 -addr %q: %v", *addr, err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		log.Fatalf("无效的端口 %q: %v", portStr, err)
	}

	url := "http://127.0.0.1:" + portStr
	fmt.Println("kfm 服务已启动:", url)
	fmt.Println("起始目录:", server.RootDir())
	fmt.Println("（起始目录 = 路径栏的空路径；访问范围不限，可前往任意绝对路径）")

	// 局域网模式：默认监听地址仅本机时改为监听所有网卡，并打印当前 IP 地址。
	// hostCheck 在 LAN 模式下仍会校验 Host 必须命中本机的某个地址，防 DNS rebinding。
	listenAddr := *addr
	if *lan {
		if host == "127.0.0.1" || host == "localhost" {
			listenAddr = ":" + portStr
		}
		ips := lanIPs()
		if len(ips) == 0 {
			fmt.Println("局域网访问: 未检测到局域网 IP（可能未连接网络）")
		}
		for _, ip := range ips {
			fmt.Println("局域网访问: http://" + ip + ":" + portStr)
		}
	}

	// 先监听端口，端口被占用时立刻报错（不要白启动一次启动命令）
	ln, err := net.Listen("tcp", listenAddr)
	if err != nil {
		log.Fatalf("监听 %s 失败（可用 -addr 换端口）: %v", listenAddr, err)
	}

	// 启动命令（用户设置 startupCommand）在服务就绪后 best-effort 执行，不阻塞服务
	if err := runStartupCommand(url); err != nil {
		log.Printf("启动命令执行失败（可手动访问 %s）: %v", url, err)
	}

	log.Fatal(newServer(listenAddr, server.New(port, *lan)).Serve(ln))
}

// runStartupCommand 读取用户设置里的启动命令模板并异步执行（best-effort）。
//
// 命令来自 <起始目录>/.kfm-settings.json 的 startupCommand 字段：它属于「用户设置」，
// 而不是编译进程序的平台默认值，因此在哪台机器构建都不影响行为。
// 模板里的 {url} 替换为服务地址；模板为空（默认）时不执行任何东西。
func runStartupCommand(url string) error {
	load := server.Root().LoadSettings()
	if load.Warning != "" {
		log.Printf("读取设置提示: %s", load.Warning)
	}
	argv, err := fs.StartupArgv(load.Settings.StartupCommand, url)
	if err != nil {
		return fmt.Errorf("启动命令无法解析: %w", err)
	}
	if len(argv) == 0 {
		return nil
	}
	exe, err := exec.LookPath(argv[0])
	if err != nil {
		return fmt.Errorf("找不到命令 %q: %w", argv[0], err)
	}
	go func() {
		if err := exec.Command(exe, argv[1:]...).Run(); err != nil {
			log.Printf("启动命令 %v 执行失败: %v", argv, err)
		}
	}()
	return nil
}

// newServer 构造带基础超时参数的 http.Server，防止慢客户端/半开连接长期占用。
func newServer(addr string, h http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
}

// lanIPs 枚举本机网卡上的私有网络 IPv4 地址（用于提示局域网访问地址）。
func lanIPs() []string {
	var out []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipNet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipNet.IP.To4()
			if ip4 != nil && ip4.IsPrivate() {
				out = append(out, ip4.String())
			}
		}
	}
	return out
}
