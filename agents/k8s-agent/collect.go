package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

const (
	kubeletConcurrency = 16
	kubeletTimeout     = 5 * time.Second
)

func listInto[T any](ctx context.Context, k *Kube, path string, required bool) ([]T, error) {
	var l list[T]
	if err := k.Get(ctx, path, &l); err != nil {
		if !required {
			slog.Warn("optional resource unavailable", "path", path, "error", err.Error())
			return nil, nil
		}
		return nil, fmt.Errorf("list %s: %w", path, err)
	}
	return l.Items, nil
}

func Collect(ctx context.Context, k *Kube, installMethod string) (*Report, error) {
	var version struct {
		GitVersion string `json:"gitVersion"`
	}
	if err := k.Get(ctx, "/version", &version); err != nil {
		return nil, fmt.Errorf("get version: %w", err)
	}

	clusterUID := clusterUID(ctx, k)

	var s Snapshot
	var err error
	if s.Nodes, err = listInto[kubeNode](ctx, k, "/api/v1/nodes", true); err != nil {
		return nil, err
	}
	if s.Pods, err = listInto[kubePod](ctx, k, "/api/v1/pods", true); err != nil {
		return nil, err
	}
	s.NodeFS = nodeFilesystems(ctx, k, s.Nodes)
	s.ReplicaSets, _ = listInto[kubeScalable](ctx, k, "/apis/apps/v1/replicasets", false)
	s.Deployments, _ = listInto[kubeScalable](ctx, k, "/apis/apps/v1/deployments", false)
	s.StatefulSets, _ = listInto[kubeScalable](ctx, k, "/apis/apps/v1/statefulsets", false)
	s.DaemonSets, _ = listInto[kubeScalable](ctx, k, "/apis/apps/v1/daemonsets", false)
	s.HPAs, _ = listInto[kubeHPA](ctx, k, "/apis/autoscaling/v2/horizontalpodautoscalers", false)

	metricsAvailable := true
	var nm list[nodeMetrics]
	if err := k.Get(ctx, "/apis/metrics.k8s.io/v1beta1/nodes", &nm); err != nil {
		metricsAvailable = false
		if !errors.Is(err, errNotFound) {
			slog.Warn("metrics-server query failed", "error", err.Error())
		}
	} else {
		s.NodeMetrics = nm.Items
		s.PodMetrics, _ = listInto[podMetrics](ctx, k, "/apis/metrics.k8s.io/v1beta1/pods", false)
	}

	nodes, workloads := Aggregate(s, metricsAvailable)
	return &Report{
		AgentVersion:           agentVersion,
		InstallMethod:          installMethod,
		ClusterUID:             clusterUID,
		KubernetesVersion:      version.GitVersion,
		MetricsServerAvailable: metricsAvailable,
		CollectedAt:            time.Now().UTC().Format(time.RFC3339),
		Nodes:                  nodes,
		Workloads:              workloads,
	}, nil
}

func clusterUID(ctx context.Context, k *Kube) string {
	var ns struct {
		Metadata objectMeta `json:"metadata"`
	}
	if err := k.Get(ctx, "/api/v1/namespaces/kube-system", &ns); err != nil {
		slog.Warn("cluster uid unavailable", "error", err.Error())
		return ""
	}
	return ns.Metadata.UID
}

func filesystemOf(summary kubeletSummary) (Filesystem, bool) {
	fs := summary.Node.Fs
	if fs == nil || fs.UsedBytes == nil || fs.CapacityBytes == nil || *fs.CapacityBytes <= 0 {
		return Filesystem{}, false
	}
	return Filesystem{UsedBytes: *fs.UsedBytes, CapacityBytes: *fs.CapacityBytes}, true
}

func nodeFilesystems(ctx context.Context, k *Kube, nodes []kubeNode) map[string]Filesystem {
	out := map[string]Filesystem{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	var failed []string
	var lastErr error
	sem := make(chan struct{}, kubeletConcurrency)
	for _, n := range nodes {
		wg.Add(1)
		go func(n kubeNode) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			reqCtx, cancel := context.WithTimeout(ctx, kubeletTimeout)
			defer cancel()
			var summary kubeletSummary
			err := k.NodeSummary(reqCtx, n, &summary)
			fs, ok := filesystemOf(summary)
			if err == nil && !ok {
				err = errors.New("summary without node filesystem")
			}
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failed = append(failed, n.Metadata.Name)
				lastErr = err
				return
			}
			out[n.Metadata.Name] = fs
		}(n)
	}
	wg.Wait()
	if len(failed) > 0 {
		slog.Warn("node filesystem stats unavailable", "nodes", failed, "error", lastErr.Error())
	}
	return out
}
