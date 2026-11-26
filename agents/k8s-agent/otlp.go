package main

import (
	"compress/gzip"
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/proto"
)

const (
	otlpTracesPath   = "/v1/traces"
	maxOTLPBodyBytes = 16 << 20
	maxOTLPRawBytes  = 64 << 20
)

func otlpHandler(agg *TraceAggregator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/x-protobuf") {
			http.Error(w, "only application/x-protobuf is supported", http.StatusUnsupportedMediaType)
			return
		}
		var body io.Reader = http.MaxBytesReader(w, r.Body, maxOTLPBodyBytes)
		if r.Header.Get("Content-Encoding") == "gzip" {
			gz, err := gzip.NewReader(body)
			if err != nil {
				http.Error(w, "invalid gzip body", http.StatusBadRequest)
				return
			}
			defer gz.Close()
			body = io.LimitReader(gz, maxOTLPRawBytes)
		}
		raw, err := io.ReadAll(body)
		if err != nil {
			http.Error(w, "body too large or unreadable", http.StatusRequestEntityTooLarge)
			return
		}
		var data tracepb.TracesData
		if err := proto.Unmarshal(raw, &data); err != nil {
			http.Error(w, "invalid OTLP payload", http.StatusBadRequest)
			return
		}
		agg.Add(&data)
		w.Header().Set("Content-Type", "application/x-protobuf")
		w.WriteHeader(http.StatusOK)
	}
}

func serveOTLP(ctx context.Context, addr string, agg *TraceAggregator) {
	mux := http.NewServeMux()
	mux.HandleFunc(otlpTracesPath, otlpHandler(agg))
	server := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second}
	go func() {
		<-ctx.Done()
		server.Close()
	}()
	slog.Info("OTLP receiver listening", "addr", addr, "path", otlpTracesPath)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("OTLP receiver", "error", err.Error())
	}
}
