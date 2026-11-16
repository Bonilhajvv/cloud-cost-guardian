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
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	serviceAccountDir  = "/var/run/secrets/kubernetes.io/serviceaccount"
	defaultKubeletPort = 10250
)

var errNotFound = errors.New("not found")

type Kube struct {
	base      string
	tokenFile string
	token     string
	client    *http.Client
	kubelet   *http.Client
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
	kubeletTransport := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS12}}
	return &Kube{
		base:      "https://" + net.JoinHostPort(host, port),
		tokenFile: serviceAccountDir + "/token",
		client:    &http.Client{Timeout: 30 * time.Second, Transport: transport},
		kubelet:   &http.Client{Timeout: 10 * time.Second, Transport: kubeletTransport},
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
	return k.get(ctx, k.client, k.base+path, out)
}

func (k *Kube) NodeSummary(ctx context.Context, n kubeNode, out *kubeletSummary) error {
	if k.kubelet == nil {
		return k.Get(ctx, "/api/v1/nodes/"+url.PathEscape(n.Metadata.Name)+"/proxy/stats/summary", out)
	}
	ip := internalIP(n)
	if ip == "" {
		return errors.New("node has no InternalIP")
	}
	port := n.Status.DaemonEndpoints.KubeletEndpoint.Port
	if port == 0 {
		port = defaultKubeletPort
	}
	return k.get(ctx, k.kubelet, "https://"+net.JoinHostPort(ip, strconv.Itoa(port))+"/stats/summary", out)
}

func (k *Kube) get(ctx context.Context, client *http.Client, target string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	if token := k.bearer(); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
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
		return fmt.Errorf("GET %s: %d %s", req.URL.Path, res.StatusCode, strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(res.Body).Decode(out)
}
