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
	flag.Parse()

	_, portStr, err := net.SplitHostPort(*addr)
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

	if *open {
		// best-effort 打开浏览器（Termux: termux-open-url），失败忽略
		go func() {
			cmd := exec.Command("termux-open-url", url)
			if err := cmd.Run(); err != nil {
				log.Printf("自动打开浏览器失败（可手动访问 %s）: %v", url, err)
			}
		}()
	}

	log.Fatal(http.ListenAndServe(*addr, server.New(port)))
}
