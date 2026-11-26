package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

const agentVersion = "0.5.0"

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	apiURL, token := os.Getenv("CCG_API_URL"), os.Getenv("CCG_AGENT_TOKEN")
	if apiURL == "" || token == "" {
		slog.Error("CCG_API_URL and CCG_AGENT_TOKEN are required")
		os.Exit(1)
	}
	installMethod := os.Getenv("CCG_INSTALL_METHOD")
	if installMethod != "kubectl" && installMethod != "helm" {
		installMethod = "unknown"
	}
	interval := 300 * time.Second
	if v, err := strconv.Atoi(os.Getenv("CCG_INTERVAL_SECONDS")); err == nil && v >= 30 {
		interval = time.Duration(v) * time.Second
	}

	kube, err := NewKube()
	if err != nil {
		slog.Error("kubernetes client", "error", err.Error())
		os.Exit(1)
	}
	reporter := NewReporter(apiURL, token)
	sampleRatio := 1.0
	if v, err := strconv.ParseFloat(os.Getenv("CCG_TRACES_SAMPLE_RATIO"), 64); err == nil && v > 0 && v <= 1 {
		sampleRatio = v
	}
	otlpAddr := os.Getenv("CCG_OTLP_ADDR")
	if otlpAddr == "" {
		otlpAddr = ":4318"
	}
	traces := NewTraceAggregator(time.Now)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go serveHealth(ctx)
	if otlpAddr != "off" {
		go serveOTLP(ctx, otlpAddr, traces)
		go traces.Run(ctx)
	}
	slog.Info("ccg-k8s-agent started", "version", agentVersion, "interval", interval.String(), "installMethod", installMethod, "clusterId", os.Getenv("CCG_CLUSTER_ID"))

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		runOnce(ctx, kube, reporter, traces, sampleRatio, installMethod)
		select {
		case <-ctx.Done():
			slog.Info("ccg-k8s-agent stopping")
			return
		case <-ticker.C:
		}
	}
}

func runOnce(ctx context.Context, kube *Kube, reporter *Reporter, traces *TraceAggregator, sampleRatio float64, installMethod string) {
	started := time.Now()
	report, err := Collect(ctx, kube, installMethod)
	if err != nil {
		slog.Error("collect failed", "error", err.Error())
		return
	}
	report.Requests = traces.Drain(sampleRatio)
	if err := reporter.Send(ctx, report); err != nil {
		slog.Error("report failed", "error", err.Error())
		return
	}
	slog.Info("report sent", "nodes", len(report.Nodes), "workloads", len(report.Workloads), "metricsServer", report.MetricsServerAvailable, "routes", routeCount(report.Requests), "durationMs", time.Since(started).Milliseconds())
}

func serveHealth(ctx context.Context) {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
	server := &http.Server{Addr: ":8080", Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		server.Close()
	}()
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("health server", "error", err.Error())
	}
}

func routeCount(u *RequestUsage) int {
	if u == nil {
		return 0
	}
	return len(u.Routes)
}
