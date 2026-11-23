package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClusterUID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/namespaces/kube-system" {
			http.NotFound(w, r)
			return
		}
		w.Write([]byte(`{"metadata":{"name":"kube-system","uid":"6f1c2a0e-1b2c-4d3e-8f90-123456789abc"}}`))
	}))
	defer srv.Close()

	k := &Kube{base: srv.URL, client: srv.Client()}
	if got := clusterUID(context.Background(), k); got != "6f1c2a0e-1b2c-4d3e-8f90-123456789abc" {
		t.Fatalf("clusterUID = %q", got)
	}
}

func TestClusterUIDUnavailable(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	defer srv.Close()

	k := &Kube{base: srv.URL, client: srv.Client()}
	if got := clusterUID(context.Background(), k); got != "" {
		t.Fatalf("clusterUID = %q, want empty", got)
	}
}
