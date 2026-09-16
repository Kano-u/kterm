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

	"kfm/internal/server"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "监听地址")
	open := flag.Bool("open", true, "启动时尝试打开浏览器")
	lan := flag.Bool("lan", true, "允许局域网设备访问（默认开启，监听所有网卡；-lan=false 关闭）")
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
	fmt.Println("根目录:", server.RootDir())

	// 局域网模式：默认监听地址仅本机时改为监听所有网卡，并打印当前 IP 地址
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

	if *open {
		// best-effort 打开浏览器（Termux: termux-open-url），失败忽略
		go func() {
			cmd := exec.Command("termux-open-url", url)
			if err := cmd.Run(); err != nil {
				log.Printf("自动打开浏览器失败（可手动访问 %s）: %v", url, err)
			}
		}()
	}

	log.Fatal(http.ListenAndServe(listenAddr, server.New(port, *lan)))
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
