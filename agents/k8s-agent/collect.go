package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
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

	var s Snapshot
	var err error
	if s.Nodes, err = listInto[kubeNode](ctx, k, "/api/v1/nodes", true); err != nil {
		return nil, err
	}
	if s.Pods, err = listInto[kubePod](ctx, k, "/api/v1/pods", true); err != nil {
		return nil, err
	}
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
		KubernetesVersion:      version.GitVersion,
		MetricsServerAvailable: metricsAvailable,
		CollectedAt:            time.Now().UTC().Format(time.RFC3339),
		Nodes:                  nodes,
		Workloads:              workloads,
	}, nil
}
