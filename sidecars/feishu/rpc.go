package main

import (
	"bufio"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
)

// RPCRequest is a JSON-RPC request from Node.js to Go.
type RPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
	ID      int             `json:"id"`
}

// RPCResponse is a JSON-RPC response from Go to Node.js.
type RPCResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	Result  interface{} `json:"result,omitempty"`
	Error   *RPCError   `json:"error,omitempty"`
	ID      int         `json:"id"`
}

// RPCError is a JSON-RPC error.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// StdioRPC handles JSON-RPC over stdin/stdout.
type StdioRPC struct {
	reader    *bufio.Reader
	writer    *bufio.Writer
	mu        sync.Mutex
	nextID    atomic.Int32
	pending   map[int]chan *RPCResponse
	pendingMu sync.Mutex
	handlers  map[string]func(params json.RawMessage) (interface{}, error)
}

// NewStdioRPC creates a new JSON-RPC client/server over stdio.
func NewStdioRPC(stdin io.Reader, stdout io.Writer) *StdioRPC {
	return &StdioRPC{
		reader:   bufio.NewReader(stdin),
		writer:   bufio.NewWriter(stdout),
		pending:  make(map[int]chan *RPCResponse),
		handlers: make(map[string]func(params json.RawMessage) (interface{}, error)),
	}
}

// Register a method handler.
func (r *StdioRPC) Register(method string, handler func(params json.RawMessage) (interface{}, error)) {
	r.handlers[method] = handler
}

// Call sends a request and waits for a response.
func (r *StdioRPC) Call(method string, params interface{}) (*RPCResponse, error) {
	id := int(r.nextID.Add(1))

	paramsBytes, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}

	req := RPCRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  paramsBytes,
		ID:      id,
	}

	ch := make(chan *RPCResponse, 1)
	r.pendingMu.Lock()
	r.pending[id] = ch
	r.pendingMu.Unlock()

	if err := r.send(req); err != nil {
		r.pendingMu.Lock()
		delete(r.pending, id)
		r.pendingMu.Unlock()
		return nil, err
	}

	resp := <-ch
	return resp, nil
}

// Notify sends a notification (no response expected).
func (r *StdioRPC) Notify(method string, params interface{}) error {
	paramsBytes, err := json.Marshal(params)
	if err != nil {
		return err
	}

	req := struct {
		JSONRPC string          `json:"jsonrpc"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
	}{
		JSONRPC: "2.0",
		Method:  method,
		Params:  paramsBytes,
	}

	return r.send(req)
}

func (r *StdioRPC) send(v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, err := r.writer.Write(data); err != nil {
		return err
	}
	if _, err := r.writer.WriteString("\n"); err != nil {
		return err
	}
	return r.writer.Flush()
}

// Serve starts reading requests from stdin.
func (r *StdioRPC) Serve() {
	for {
		line, err := r.reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				slog.Info("[Sidecar] stdin closed, exiting")
				return
			}
			slog.Error("[Sidecar] read error", "err", err)
			return
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var req RPCRequest
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			slog.Error("[Sidecar] unmarshal error", "err", err, "line", line[:min(len(line), 200)])
			continue
		}

		// Handle response (from Node.js to our Call)
		if req.Method == "" {
			var resp RPCResponse
			if err := json.Unmarshal([]byte(line), &resp); err == nil && resp.ID > 0 {
				r.pendingMu.Lock()
				ch, ok := r.pending[resp.ID]
				if ok {
					delete(r.pending, resp.ID)
				}
				r.pendingMu.Unlock()
				if ok {
					ch <- &resp
				}
			}
			continue
		}

		// Handle request (Node.js calling our method)
		go r.handleRequest(req)
	}
}

func (r *StdioRPC) handleRequest(req RPCRequest) {
	handler, ok := r.handlers[req.Method]
	if !ok {
		r.send(RPCResponse{
			JSONRPC: "2.0",
			Error:   &RPCError{Code: -32601, Message: "method not found: " + req.Method},
			ID:      req.ID,
		})
		return
	}

	result, err := handler(req.Params)
	if err != nil {
		r.send(RPCResponse{
			JSONRPC: "2.0",
			Error:   &RPCError{Code: -32000, Message: err.Error()},
			ID:      req.ID,
		})
		return
	}

	r.send(RPCResponse{
		JSONRPC: "2.0",
		Result:  result,
		ID:      req.ID,
	})
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
