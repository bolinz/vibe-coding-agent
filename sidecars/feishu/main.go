package main

import (
	"encoding/json"
	"log/slog"
	"os"
)

func main() {
	logLevel := slog.LevelInfo
	if os.Getenv("SIDECAR_DEBUG") == "true" {
		logLevel = slog.LevelDebug
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: logLevel,
	})))

	slog.Info("[Sidecar] Starting feishu-sidecar", "version", "0.1.0")

	// 1. Create JSON-RPC over stdio
	rpc := NewStdioRPC(os.Stdin, os.Stdout)

	// 2. Create Feishu connection
	fs := NewFeishuConn(rpc)

	// 3. Register RPC methods that Node.js can call
	rpc.Register("sendMessage", fs.SendMessage)
	rpc.Register("sendCardSync", fs.SendCardSync)
	rpc.Register("disconnect", func(_ json.RawMessage) (interface{}, error) {
		fs.Disconnect()
		return map[string]string{"status": "disconnected"}, nil
	})

	// 4. Connect to Feishu WebSocket
	if err := fs.Connect(); err != nil {
		slog.Error("[Sidecar] Failed to connect to Feishu", "err", err)
		os.Exit(1)
	}

	// 5. Notify Node.js that we're ready
	if err := rpc.Notify("ready", map[string]string{"status": "ready"}); err != nil {
		slog.Error("[Sidecar] Failed to notify ready", "err", err)
	}

	slog.Info("[Sidecar] Ready. Waiting for events...")

	// 6. Block reading stdio
	rpc.Serve()

	slog.Info("[Sidecar] Exiting")
}
