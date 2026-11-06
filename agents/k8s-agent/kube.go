package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	serviceAccountDir = "/var/run/secrets/kubernetes.io/serviceaccount"
)

var errNotFound = errors.New("not found")

type Kube struct {
	base      string
	tokenFile string
	token     string
	client    *http.Client
}

func NewKube() (*Kube, error) {
	if url := os.Getenv("K8S_API_URL"); url != "" {
		return &Kube{base: strings.TrimRight(url, "/"), token: os.Getenv("K8S_TOKEN"), client: &http.Client{Timeout: 30 * time.Second}}, nil
	}
	host, port := os.Getenv("KUBERNETES_SERVICE_HOST"), os.Getenv("KUBERNETES_SERVICE_PORT")
	if host == "" || port == "" {
		return nil, errors.New("not running in a cluster: set K8S_API_URL (for example via kubectl proxy)")
	}
	caPEM, err := os.ReadFile(serviceAccountDir + "/ca.crt")
	if err != nil {
		return nil, fmt.Errorf("read service account CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, errors.New("invalid service account CA")
	}
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}
	return &Kube{
		base:      "https://" + net.JoinHostPort(host, port),
		tokenFile: serviceAccountDir + "/token",
		client:    &http.Client{Timeout: 30 * time.Second, Transport: transport},
	}, nil
}

func (k *Kube) bearer() string {
	if k.tokenFile != "" {
		if b, err := os.ReadFile(k.tokenFile); err == nil {
			return strings.TrimSpace(string(b))
		}
	}
	return k.token
}

func (k *Kube) Get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, k.base+path, nil)
	if err != nil {
		return err
	}
	if token := k.bearer(); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Accept", "application/json")
	res, err := k.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusServiceUnavailable {
		io.Copy(io.Discard, res.Body)
		return errNotFound
	}
	if res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("GET %s: %d %s", path, res.StatusCode, strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(res.Body).Decode(out)
}
