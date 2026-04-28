package main

import (
	"context"
	"log/slog"
)

// larkLogger implements larkcore.Logger, redirecting all SDK logs to slog (stderr).
type larkLogger struct{}

func (l *larkLogger) Debug(ctx context.Context, args ...interface{}) {
	slog.Debug("[LarkSDK]", args...)
}
func (l *larkLogger) Info(ctx context.Context, args ...interface{}) {
	slog.Info("[LarkSDK]", args...)
}
func (l *larkLogger) Warn(ctx context.Context, args ...interface{}) {
	slog.Warn("[LarkSDK]", args...)
}
func (l *larkLogger) Error(ctx context.Context, args ...interface{}) {
	slog.Error("[LarkSDK]", args...)
}
