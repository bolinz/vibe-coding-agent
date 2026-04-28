package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	"github.com/larksuite/oapi-sdk-go/v3/event/dispatcher"
	"github.com/larksuite/oapi-sdk-go/v3/event/dispatcher/callback"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"
)

// FeishuConn manages the Feishu WebSocket connection and card sync.
type FeishuConn struct {
	appID    string
	appSecret string
	domain   string
	client   *lark.Client
	wsClient *larkws.Client
	rpc      *StdioRPC
	cancel   context.CancelFunc
}

// NewFeishuConn creates a new Feishu connection.
func NewFeishuConn(rpc *StdioRPC) *FeishuConn {
	return &FeishuConn{
		appID:     os.Getenv("FEISHU_APP_ID"),
		appSecret: os.Getenv("FEISHU_APP_SECRET"),
		domain:    os.Getenv("FEISHU_DOMAIN"),
		rpc:       rpc,
	}
}

// Connect starts the WebSocket connection.
func (f *FeishuConn) Connect() error {
	if f.appID == "" || f.appSecret == "" {
		return fmt.Errorf("FEISHU_APP_ID and FEISHU_APP_SECRET are required")
	}

	var clientOpts []lark.ClientOptionFunc
	if f.domain != "" {
		clientOpts = append(clientOpts, lark.WithOpenBaseUrl(f.domain))
	}

	f.client = lark.NewClient(f.appID, f.appSecret, clientOpts...)

	eventDispatcher := dispatcher.NewEventDispatcher("", "").
		OnP2MessageReceiveV1(func(ctx context.Context, event *larkim.P2MessageReceiveV1) error {
			return f.onMessage(event)
		}).
		OnP2CardActionTrigger(func(ctx context.Context, event *callback.CardActionTriggerEvent) (*callback.CardActionTriggerResponse, error) {
			return f.onCardAction(event)
		})

	wsOpts := []larkws.ClientOption{
		larkws.WithEventHandler(eventDispatcher),
		larkws.WithLogLevel(larkcore.LogLevelWarn),
		larkws.WithLogger(&larkLogger{}),
	}
	if f.domain != "" {
		wsOpts = append(wsOpts, larkws.WithDomain(f.domain))
	}

	f.wsClient = larkws.NewClient(f.appID, f.appSecret, wsOpts...)

	ctx, cancel := context.WithCancel(context.Background())
	f.cancel = cancel

	go func() {
		if err := f.wsClient.Start(ctx); err != nil {
			slog.Error("[Sidecar] WebSocket error", "err", err)
		}
	}()

	slog.Info("[Sidecar] Feishu WebSocket connected")
	return nil
}

// Disconnect closes the WebSocket.
func (f *FeishuConn) Disconnect() {
	if f.cancel != nil {
		f.cancel()
	}
}

// SendMessage sends a text message via the IM API.
func (f *FeishuConn) SendMessage(params json.RawMessage) (interface{}, error) {
	var req struct {
		ReceiveID string `json:"receiveId"`
		Content   string `json:"content"`
		MsgType   string `json:"msgType,omitempty"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, err
	}

	msgType := req.MsgType
	if msgType == "" {
		msgType = "text"
	}

	content := req.Content
	if msgType == "text" {
		content = fmt.Sprintf(`{"text":"%s"}`, jsonEscape(req.Content))
	}

	_, err := f.client.Im.Message.Create(context.Background(),
		larkim.NewCreateMessageReqBuilder().
			ReceiveIdType("open_id").
			Body(larkim.NewCreateMessageReqBodyBuilder().
				ReceiveId(req.ReceiveID).
				MsgType(msgType).
				Content(content).
				Build()).
			Build())
	if err != nil {
		return nil, err
	}

	return map[string]string{"status": "sent"}, nil
}

// SendCardSync sends a card synchronously (used when Node.js wants to force a new card message).
func (f *FeishuConn) SendCardSync(params json.RawMessage) (interface{}, error) {
	var req struct {
		ReceiveID string                 `json:"receiveId"`
		Card      map[string]interface{} `json:"card"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, err
	}

	cardJSON, err := json.Marshal(req.Card)
	if err != nil {
		return nil, err
	}

	_, err = f.client.Im.Message.Create(context.Background(),
		larkim.NewCreateMessageReqBuilder().
			ReceiveIdType("open_id").
			Body(larkim.NewCreateMessageReqBodyBuilder().
				ReceiveId(req.ReceiveID).
				MsgType("interactive").
				Content(string(cardJSON)).
				Build()).
			Build())
	if err != nil {
		return nil, err
	}

	return map[string]string{"status": "sent"}, nil
}

func (f *FeishuConn) onMessage(event *larkim.P2MessageReceiveV1) error {
	msg := event.Event.Message
	sender := event.Event.Sender

	var openID string
	if sender.SenderId != nil && sender.SenderId.OpenId != nil {
		openID = *sender.SenderId.OpenId
	}
	var content string
	if msg.Content != nil {
		content = *msg.Content
	}
	var msgID string
	if msg.MessageId != nil {
		msgID = *msg.MessageId
	}
	var chatID string
	if msg.ChatId != nil {
		chatID = *msg.ChatId
	}

	if openID == "" {
		return nil
	}

	// Parse text content
	text := ""
	var textBody struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal([]byte(content), &textBody); err == nil {
		text = textBody.Text
	}

	// Forward to Node.js via RPC notification
	f.rpc.Notify("message", map[string]interface{}{
		"userId":    openID,
		"chatId":    chatID,
		"messageId": msgID,
		"content":   text,
		"raw":       content,
	})

	return nil
}

func (f *FeishuConn) onCardAction(event *callback.CardActionTriggerEvent) (*callback.CardActionTriggerResponse, error) {
	if event.Event == nil || event.Event.Action == nil {
		return nil, nil
	}

	var userID string
	if event.Event.Operator != nil {
		userID = event.Event.Operator.OpenID
	}
	var chatID, messageID string
	if event.Event.Context != nil {
		chatID = event.Event.Context.OpenChatID
		messageID = event.Event.Context.OpenMessageID
	}

	actionVal := ""
	if v, ok := event.Event.Action.Value["action"].(string); ok {
		actionVal = v
	}
	if actionVal == "" && event.Event.Action.Option != "" {
		actionVal = event.Event.Action.Option
	}

	if actionVal == "" {
		return nil, nil
	}

	sessionKey := ""
	if v, ok := event.Event.Action.Value["session_key"].(string); ok {
		sessionKey = v
	}
	if sessionKey == "" {
		sessionKey = chatID + "_" + userID
	}

	slog.Info("[Sidecar] card action", "user", userID, "action", actionVal)

	// Ask Node.js what to do with this card action
	resp, err := f.rpc.Call("cardAction", map[string]interface{}{
		"userId":     userID,
		"chatId":     chatID,
		"messageId":  messageID,
		"action":     actionVal,
		"sessionKey": sessionKey,
		"value":      event.Event.Action.Value,
	})
	if err != nil {
		slog.Error("[Sidecar] cardAction RPC call failed", "err", err)
		// Fallback: just acknowledge
		return &callback.CardActionTriggerResponse{
			Toast: &callback.Toast{
				Type:    "info",
				Content: "处理中...",
			},
		}, nil
	}

	if resp.Error != nil {
		slog.Error("[Sidecar] cardAction RPC error", "msg", resp.Error.Message)
		return &callback.CardActionTriggerResponse{
			Toast: &callback.Toast{
				Type:    "error",
				Content: "处理失败",
			},
		}, nil
	}

	// Parse result
	resultBytes, _ := json.Marshal(resp.Result)
	slog.Debug("[Sidecar] cardAction raw result", "bytes", string(resultBytes))

	var result struct {
		Card  map[string]interface{} `json:"card"`
		Toast struct {
			Type    string `json:"type"`
			Content string `json:"content"`
		} `json:"toast"`
	}
	if err := json.Unmarshal(resultBytes, &result); err != nil {
		slog.Error("[Sidecar] failed to parse cardAction result", "err", err)
		return nil, nil
	}

	slog.Debug("[Sidecar] parsed cardAction", "hasCard", result.Card != nil, "toastType", result.Toast.Type)

	var toast *callback.Toast
	if result.Toast.Type != "" {
		toast = &callback.Toast{
			Type:    result.Toast.Type,
			Content: result.Toast.Content,
		}
	}

	if result.Card == nil {
		slog.Warn("[Sidecar] cardAction returned no card")
		return &callback.CardActionTriggerResponse{Toast: toast}, nil
	}

	slog.Info("[Sidecar] returning sync card refresh")
	return &callback.CardActionTriggerResponse{
		Toast: toast,
		Card: &callback.Card{
			Type: "raw",
			Data: result.Card,
		},
	}, nil
}

func jsonEscape(s string) string {
	b, _ := json.Marshal(s)
	return string(b[1 : len(b)-1])
}

// Wait for Node.js to be ready before connecting Feishu.
func (f *FeishuConn) waitForInit() {
	// Node.js will send an "init" call with config after spawning us.
	// But for now we read env vars directly.
}
